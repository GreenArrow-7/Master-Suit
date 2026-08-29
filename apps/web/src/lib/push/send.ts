/**
 * Native push, spoken directly to Apple and Google.
 *
 * ── Why two transports and no SDK ───────────────────────────────────────────
 *
 * `@capacitor/push-notifications` registers with APNs on iOS and with FCM on
 * Android, and hands back whichever token the platform minted. Putting iOS
 * behind Firebase too — the usual way to get one transport instead of two —
 * costs the Firebase iOS SDK, an AppDelegate that swizzles the APNs callbacks,
 * and a Mac to compile the result. Two protocols spoken from one file here is
 * the smaller thing to own, and it is the half that can be tested from a laptop.
 *
 * Neither needs a package. Both authenticate with a JWT this file signs using
 * `node:crypto` — RS256 from the Firebase service account, ES256 from Apple's
 * .p8 — and both accept an ordinary HTTPS POST after that. `firebase-admin`
 * pulls in gRPC to do the same thing.
 *
 * ── What it promises ────────────────────────────────────────────────────────
 *
 * Nothing, deliberately. `sendPush` never throws and never retries: a
 * notification row is already written and an email is already queued by the time
 * anything here runs, so a push is the third copy of a message that has arrived
 * twice already. It reports what it sent and which tokens the transport says are
 * dead, and the caller deletes those.
 *
 * ponytail: best-effort, no retry queue. A push lost to a five-second Apple
 * blip is simply lost. Give it its own BullMQ job with attempts>1 if a missed
 * push ever matters more than a duplicate one — which needs a delivery stamp
 * first, or retries will double-ring every phone that did receive it.
 */
import { createPrivateKey, sign } from 'node:crypto';
import http2 from 'node:http2';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

export interface PushMessage {
  title: string;
  body?: string;
  /** Workspace-absolute path the tap should open, e.g. `/acme/people/leave`. */
  url?: string;
}

export interface PushTarget {
  token: string;
  platform: string;
}

export interface PushResult {
  sent: number;
  /**
   * Tokens the transport rejected as belonging to an app that is gone. These are
   * the only failures worth acting on — everything else is transient, and
   * deleting a token because Apple had a bad minute means a phone that never
   * rings again.
   */
  stale: string[];
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** `{header}.{claims}` signed, in the compact JWS form both vendors expect. */
function jwt(header: object, claims: object, key: Parameters<typeof sign>[2]): string {
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  return `${input}.${sign('sha256', Buffer.from(input), key).toString('base64url')}`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

// ── Google: FCM HTTP v1 ─────────────────────────────────────────────────────

const fcmConfigured = () => Boolean(env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY);

let fcmAccess: { token: string; expiresAt: number } | null = null;

/**
 * An OAuth access token for the service account, cached until a minute before it
 * expires. Google issues these for an hour; minting one per notification would
 * add a round trip to Mountain View in front of every send.
 */
async function fcmAccessToken(): Promise<string | null> {
  if (fcmAccess && fcmAccess.expiresAt > nowSeconds() + 60) return fcmAccess.token;

  const issued = nowSeconds();
  const assertion = jwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: env.FCM_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: issued,
      exp: issued + 3600,
    },
    // The PEM arrives from the JSON key with its newlines escaped; a key with
    // literal `\n` in it fails to parse with a message that names neither.
    (env.FCM_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  );

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });

  if (!response.ok) {
    logger.error({ status: response.status, detail: await response.text() }, 'fcm token exchange failed');
    return null;
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) return null;
  fcmAccess = { token: payload.access_token, expiresAt: issued + (payload.expires_in ?? 3600) };
  return fcmAccess.token;
}

async function sendFcm(targets: PushTarget[], message: PushMessage): Promise<PushResult> {
  const access = await fcmAccessToken();
  if (!access) return { sent: 0, stale: [] };

  const endpoint = `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`;
  const stale: string[] = [];
  let sent = 0;

  // One request per token: the v1 API has no multicast and the batch endpoint is
  // retired. Recipients of a single event are a handful of approvers, so the
  // fan-out is small enough not to need a concurrency limit.
  await Promise.allSettled(
    targets.map(async (target) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: target.token,
            notification: { title: message.title, body: message.body || undefined },
            // Read by the tap handler in the app. FCM data values must be
            // strings, so an absent url is omitted rather than sent as null.
            data: message.url ? { url: message.url } : undefined,
            // Approvals are the thing people are waiting on; `high` is what lets
            // one through Doze on an idle handset.
            android: { priority: 'high', notification: { default_sound: true } },
          },
        }),
      });

      if (response.ok) {
        sent += 1;
        return;
      }

      const detail = await response.text();
      // UNREGISTERED is the app being uninstalled; INVALID_ARGUMENT on a send
      // whose only argument is the token means the token is malformed. Both are
      // permanent, and both are answered by forgetting the device.
      if (response.status === 404 || detail.includes('UNREGISTERED') || detail.includes('INVALID_ARGUMENT')) {
        stale.push(target.token);
        return;
      }
      logger.warn({ status: response.status, detail }, 'fcm send failed');
    }),
  );

  return { sent, stale };
}

// ── Apple: APNs over HTTP/2 ─────────────────────────────────────────────────

const apnsConfigured = () => Boolean(env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_BUNDLE_ID);

let apnsAuth: { token: string; issuedAt: number } | null = null;

/**
 * Apple rejects a provider token younger than 20 minutes on refresh and older
 * than 60 on use, so it is reused for 50 and then replaced.
 */
function apnsToken(): string {
  if (apnsAuth && nowSeconds() - apnsAuth.issuedAt < 50 * 60) return apnsAuth.token;

  const issuedAt = nowSeconds();
  const token = jwt(
    { alg: 'ES256', kid: env.APNS_KEY_ID, typ: 'JWT' },
    { iss: env.APNS_TEAM_ID, iat: issuedAt },
    {
      key: createPrivateKey((env.APNS_KEY ?? '').replace(/\\n/g, '\n')),
      // JWS wants the raw r‖s pair. Node signs EC as DER by default, and Apple
      // answers a DER signature with a 403 InvalidProviderToken that says nothing
      // about the encoding.
      dsaEncoding: 'ieee-p1363',
    },
  );

  apnsAuth = { token, issuedAt };
  return token;
}

async function sendApns(targets: PushTarget[], message: PushMessage): Promise<PushResult> {
  // HTTP/2 is not optional for APNs, and `fetch` does not speak it.
  const client = http2.connect(env.APNS_SANDBOX ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');
  const authorization = `bearer ${apnsToken()}`;
  const payload = JSON.stringify({
    aps: { alert: { title: message.title, body: message.body || undefined }, sound: 'default' },
    url: message.url,
  });

  const stale: string[] = [];
  let sent = 0;

  try {
    await Promise.allSettled(
      targets.map(
        (target) =>
          new Promise<void>((resolve) => {
            const request = client.request({
              ':method': 'POST',
              ':path': `/3/device/${target.token}`,
              authorization,
              'apns-topic': env.APNS_BUNDLE_ID,
              'apns-push-type': 'alert',
              'apns-priority': '10',
            });

            let status = 0;
            let body = '';
            request.on('response', (headers) => {
              status = Number(headers[':status'] ?? 0);
            });
            request.setEncoding('utf8');
            request.on('data', (chunk) => {
              body += chunk;
            });
            request.on('end', () => {
              if (status === 200) sent += 1;
              // 410 is Apple's "this app is gone"; a 400 naming the token is the
              // same verdict for a string that was never valid.
              else if (status === 410 || body.includes('BadDeviceToken') || body.includes('Unregistered')) {
                stale.push(target.token);
              } else logger.warn({ status, body }, 'apns send failed');
              resolve();
            });
            request.on('error', (err) => {
              logger.warn({ err }, 'apns request failed');
              resolve();
            });
            request.end(payload);
          }),
      ),
    );
  } finally {
    client.close();
  }

  return { sent, stale };
}

// ── The one entry point ─────────────────────────────────────────────────────

/**
 * Deliver to whichever transports are configured. Devices on a platform with no
 * credentials are skipped silently — a deployment that has shipped the Android
 * app and not the iOS one is the normal state for months, not an error.
 */
export async function sendPush(targets: PushTarget[], message: PushMessage): Promise<PushResult> {
  const android = targets.filter((target) => target.platform === 'android');
  const ios = targets.filter((target) => target.platform === 'ios');

  const results = await Promise.all([
    android.length && fcmConfigured() ? sendFcm(android, message) : Promise.resolve({ sent: 0, stale: [] }),
    ios.length && apnsConfigured() ? sendApns(ios, message) : Promise.resolve({ sent: 0, stale: [] }),
  ]);

  return {
    sent: results.reduce((total, result) => total + result.sent, 0),
    stale: results.flatMap((result) => result.stale),
  };
}

/** Whether any push transport is configured at all; the worker logs the reason once. */
export const pushConfigured = () => fcmConfigured() || apnsConfigured();
