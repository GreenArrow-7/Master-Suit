/**
 * The telephony factory.
 *
 * This is the only file in the application permitted to know that Twilio exists.
 * Callers ask `resolveTelephony(tenantId)` (in ./resolve) for a provider and use
 * the interface; a `provider === 'twilio'` branch anywhere else is a review
 * blocker — §1 and §35 of the engagement spec.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { ExotelProvider } from './exotel';
import { KnowlarityProvider } from './knowlarity';
import { PlivoProvider } from './plivo';
import { TwilioProvider } from './twilio';
import { TelephonyConfigError, isTelephonyVendor } from './types';
import type {
  CallEvent,
  CallRequest,
  CallResult,
  Capability,
  TelephonyProvider,
  TelephonyVendor,
  WebhookRequest,
} from './types';

export * from './types';
export { TelephonyApiError } from './http';

/**
 * The two callback secrets derived from a connection's `webhookKey`.
 *
 * Derived rather than stored, so rotating WEBHOOK_SIGNING_PEPPER invalidates
 * every callback credential at once and no secret column has to be migrated.
 * Domain-separated from each other: the HMAC secret a vendor signs with must not
 * also be a bearer token that authenticates on its own.
 */
export function callbackSecrets(webhookKey: string) {
  const derive = (domain: string) =>
    createHmac('sha256', env.WEBHOOK_SIGNING_PEPPER).update(`${domain}:${webhookKey}`).digest('base64url');
  return { hmacSecret: derive('telephony'), urlToken: derive('telephony-callback') };
}

/**
 * Builds a provider from a vendor name and its decrypted credentials.
 *
 * Pure: no database, no environment beyond the pepper. `resolveTelephony` is the
 * one that reads a tenant's configuration and calls this.
 */
export function telephonyProvider(
  vendor: string,
  credentials: Record<string, string>,
  webhookKey: string,
): TelephonyProvider {
  const { hmacSecret, urlToken } = callbackSecrets(webhookKey);

  switch (vendor) {
    case 'twilio':
      return new TwilioProvider(credentials.accountSid, credentials.authToken);
    case 'plivo':
      return new PlivoProvider(credentials.authId, credentials.authToken);
    case 'exotel':
      return new ExotelProvider(
        credentials.accountSid,
        credentials.apiKey,
        credentials.apiToken,
        credentials.subdomain ?? 'api.exotel.com',
        urlToken,
      );
    case 'knowlarity':
      return new KnowlarityProvider(credentials.srNumber, credentials.apiKey, credentials.authToken, urlToken);
    case 'mock':
      // The only guard telephony needs, and it belongs here rather than in the
      // startup check: which vendor a tenant calls with is a per-tenant choice
      // recorded in organizationSetting.telephonyProvider, so no process-wide
      // setting can decide it and no boot-time check can see it. A tenant that
      // configures the mock is refused at the moment it would place a call.
      if (env.NODE_ENV === 'production') throw new TelephonyConfigError('Mock telephony is forbidden in production.');
      return new MockTelephonyProvider();
    default:
      // The pre-vendor generic. Kept because it is what the documented
      // header-signed webhook contract speaks, and removing it would break any
      // deployment already pointing a bespoke gateway at it.
      if (!hmacSecret) throw new TelephonyConfigError(`Webhook secret is missing for ${vendor}.`);
      return new HmacTelephonyProvider(vendor, hmacSecret);
  }
}

export function vendorCapabilities(vendor: string): readonly Capability[] {
  if (!isTelephonyVendor(vendor)) return [];
  // Capabilities are a property of the vendor, not of a configured connection,
  // so the UI can render them before any credentials exist.
  const stub: Record<TelephonyVendor, readonly Capability[]> = {
    twilio: new TwilioProvider('AC', 'x').capabilities,
    plivo: new PlivoProvider('MA', 'x').capabilities,
    exotel: new ExotelProvider('sid', 'k', 't', 'api.exotel.com', 'x').capabilities,
    knowlarity: new KnowlarityProvider('n', 'k', 't', 'x').capabilities,
  };
  return stub[vendor];
}

// ─────────────────────────────────────────────────────────────────────────────
// Development mock
// ─────────────────────────────────────────────────────────────────────────────

export class MockTelephonyProvider implements TelephonyProvider {
  readonly name = 'mock';
  readonly capabilities: readonly Capability[] = ['OUTBOUND_CALL', 'CLICK_TO_CALL', 'CALL_STATUS', 'END_CALL'];

  async initiateCall(request: CallRequest): Promise<CallResult> {
    const id = `mock_call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info({ provider: 'mock', action: 'initiateCall', to: request.to }, 'telephony mock');
    return { externalCallId: id, event: 'CALL_INITIATED' };
  }

  async endCall(externalCallId: string): Promise<void> {
    logger.info({ provider: 'mock', action: 'endCall', externalCallId }, 'telephony mock');
  }

  async getCallStatus(): Promise<CallEvent | null> {
    return null;
  }

  async getRecordingUrl(externalCallId: string): Promise<string | null> {
    return `https://recordings.example.com/${externalCallId}.wav`;
  }

  /**
   * Mock callbacks are generated inside tests; they are never trusted as HTTP
   * webhooks. Returning false prevents development defaults becoming a bypass.
   */
  verifyWebhookSignature(): boolean {
    return false;
  }

  validateWebhook(): boolean {
    return false;
  }

  parseWebhook(): CallEvent {
    throw new Error('The mock provider does not accept webhooks.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic HMAC vendor
// ─────────────────────────────────────────────────────────────────────────────

/** For gateways that can sign the raw body with a shared secret. */
export class HmacTelephonyProvider implements TelephonyProvider {
  readonly name: string;
  readonly capabilities: readonly Capability[] = ['SIGNED_WEBHOOK'];

  constructor(
    name: string,
    private readonly webhookSecret: string,
  ) {
    if (!name || !webhookSecret) throw new Error('Telephony provider and webhook secret are required.');
    this.name = name;
  }

  async initiateCall(): Promise<CallResult> {
    throw new TelephonyConfigError(`${this.name} outbound calling is not configured.`);
  }

  async endCall(): Promise<void> {
    throw new TelephonyConfigError(`${this.name} outbound calling is not configured.`);
  }

  async getCallStatus(): Promise<CallEvent | null> {
    return null;
  }

  async getRecordingUrl(): Promise<string | null> {
    return null;
  }

  verifyWebhookSignature(payload: string, signature: string, timestamp: string): boolean {
    if (!/^\d{10,13}$/.test(timestamp)) return false;
    const numeric = Number(timestamp);
    const timestampMs = timestamp.length === 10 ? numeric * 1000 : numeric;
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) return false;

    const supplied = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    if (!/^[a-f\d]{64}$/i.test(supplied)) return false;
    const expected = createHmac('sha256', this.webhookSecret).update(`${timestamp}.${payload}`).digest();
    const actual = Buffer.from(supplied, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  validateWebhook(request: WebhookRequest): boolean {
    return this.verifyWebhookSignature(
      request.rawBody,
      request.headers.get('x-webhook-signature') ?? '',
      request.headers.get('x-webhook-timestamp') ?? '',
    );
  }

  parseWebhook(request: WebhookRequest): CallEvent {
    let payload: unknown;
    try {
      payload = JSON.parse(request.rawBody);
    } catch {
      throw new Error('Invalid webhook body.');
    }
    if (!payload || typeof payload !== 'object') throw new Error('Invalid webhook body.');
    const p = payload as Record<string, unknown>;

    const externalCallId = String(p.callId ?? '').trim();
    const status = String(p.status ?? '')
      .trim()
      .toLowerCase();
    const timestamp = String(p.timestamp ?? '').trim();

    const map: Record<string, CallEvent['event']> = {
      initiated: 'CALL_INITIATED',
      ringing: 'CALL_RINGING',
      in_progress: 'CALL_CONNECTED',
      completed: 'CALL_COMPLETED',
      failed: 'CALL_FAILED',
    };
    const event = map[status];
    if (!externalCallId || !event) throw new Error('Invalid call identifier or status.');
    if (!timestamp || Number.isNaN(Date.parse(timestamp))) throw new Error('Invalid event timestamp.');

    const duration = p.duration == null ? undefined : Number(p.duration);
    if (duration !== undefined && (!Number.isFinite(duration) || duration < 0)) throw new Error('Invalid duration.');

    const recordingUrl = p.recordingUrl == null ? undefined : String(p.recordingUrl);
    if (recordingUrl && !recordingUrl.startsWith('https://')) throw new Error('Invalid recording URL.');

    return {
      externalCallId,
      event,
      occurredAt: new Date(timestamp),
      durationSecs: duration,
      recordingUrl,
      deliveryId: request.headers.get('x-webhook-id') ?? `${externalCallId}:${status}`,
    };
  }
}
