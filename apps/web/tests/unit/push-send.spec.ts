/**
 * The push sender, without Apple or Google.
 *
 * Three things here can break silently, and all three are the kind that are
 * only noticed when somebody's phone does not ring:
 *
 *   1 · the service-account JWT. It is signed by hand with node:crypto, so a
 *       mistake in the encoding is a 400 from Google and nothing else.
 *   2 · the routing. Android tokens must reach FCM and iOS tokens must not —
 *       an APNs token posted to FCM is accepted for delivery and dropped.
 *   3 · the stale verdict. Deleting a device on a transient failure is a phone
 *       that never rings again, and *not* deleting an uninstalled one is a
 *       rejected request paid for on every notification, forever.
 *
 * `fetch` is replaced rather than the module mocked, so the JWT is really built
 * and really signed on the way through — with a key generated here, because a
 * test that carries a private key in the repository is a test nobody can run
 * after the secret scanner finds it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

/** Load send.ts against a stubbed environment; `env` is parsed at import. */
async function loadSender(overrides: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  return import('@/lib/push/send');
}

const ANDROID = [{ token: 'fcm-token-aaaaaaaaaaaaaaaa', platform: 'android' }];
const CONFIGURED = {
  FCM_PROJECT_ID: 'demo-project',
  FCM_CLIENT_EMAIL: 'pusher@demo-project.iam.gserviceaccount.com',
  // Escaped exactly the way the JSON key holds it, which is the form the
  // application has to survive.
  FCM_PRIVATE_KEY: pem.replace(/\n/g, '\\n'),
};

let calls: { url: string; init: RequestInit }[] = [];

/** Answers the OAuth exchange, then whatever `send` is told to answer. */
function stubFetch(send: { ok: boolean; status?: number; body?: string }) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'access-123', expires_in: 3600 }), { status: 200 });
    }
    return new Response(send.body ?? '{}', { status: send.status ?? (send.ok ? 200 : 500) });
  });
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('sendPush', () => {
  it('sends nothing, and calls nothing, when no transport is configured', async () => {
    stubFetch({ ok: true });
    const { sendPush, pushConfigured } = await loadSender({
      FCM_PROJECT_ID: '',
      FCM_CLIENT_EMAIL: '',
      FCM_PRIVATE_KEY: '',
      APNS_KEY: '',
      APNS_KEY_ID: '',
      APNS_TEAM_ID: '',
      APNS_BUNDLE_ID: '',
    });

    expect(pushConfigured()).toBe(false);
    await expect(sendPush(ANDROID, { title: 'Overtime awaiting approval' })).resolves.toEqual({
      sent: 0,
      stale: [],
    });
    expect(calls).toHaveLength(0);
  });

  it('signs a verifiable RS256 assertion and posts the notification to FCM', async () => {
    stubFetch({ ok: true });
    const { sendPush } = await loadSender(CONFIGURED);

    const result = await sendPush(ANDROID, {
      title: 'Overtime awaiting approval',
      body: 'Two claims from the night shift.',
      url: '/acme/people/overtime',
    });

    expect(result).toEqual({ sent: 1, stale: [] });

    // 1 · the assertion Google would verify.
    const assertion = new URLSearchParams(calls[0]!.init.body as string).get('assertion')!;
    const [header, claims, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toMatchObject({ alg: 'RS256' });
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({
      iss: CONFIGURED.FCM_CLIENT_EMAIL,
      aud: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    });
    expect(verify('sha256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature!, 'base64url'))).toBe(
      true,
    );

    // 2 · the message, carrying the destination the tap handler reads.
    expect(calls[1]!.url).toBe('https://fcm.googleapis.com/v1/projects/demo-project/messages:send');
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe('Bearer access-123');
    expect(JSON.parse(calls[1]!.init.body as string).message).toMatchObject({
      token: ANDROID[0]!.token,
      notification: { title: 'Overtime awaiting approval' },
      data: { url: '/acme/people/overtime' },
    });
  });

  it('does not route an iOS token through FCM when only FCM is configured', async () => {
    stubFetch({ ok: true });
    const { sendPush } = await loadSender(CONFIGURED);

    const result = await sendPush([{ token: 'apns-token-bbbbbbbbbbbb', platform: 'ios' }], { title: 'Payslip ready' });

    expect(result).toEqual({ sent: 0, stale: [] });
    expect(calls).toHaveLength(0);
  });

  it('reports an uninstalled app as stale, and a server fault as neither', async () => {
    stubFetch({ ok: false, status: 404, body: '{"error":{"status":"UNREGISTERED"}}' });
    const uninstalled = await (await loadSender(CONFIGURED)).sendPush(ANDROID, { title: 'Leave decided' });
    expect(uninstalled).toEqual({ sent: 0, stale: [ANDROID[0]!.token] });

    stubFetch({ ok: false, status: 503, body: 'the service is currently unavailable' });
    const outage = await (await loadSender(CONFIGURED)).sendPush(ANDROID, { title: 'Leave decided' });
    // Kept: a device deleted because Google had a bad minute never rings again.
    expect(outage).toEqual({ sent: 0, stale: [] });
  });
});
