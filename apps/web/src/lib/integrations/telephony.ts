import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '../logger';

// ─────────────────────────────────────────────────────────────────────────────
// Telephony provider abstraction
// ─────────────────────────────────────────────────────────────────────────────

export interface CallRequest {
  from: string;
  to: string;
  callbackUrl?: string;
  recordingEnabled?: boolean;
}

export interface CallResult {
  externalCallId: string;
  status: 'initiated' | 'ringing' | 'in_progress' | 'completed' | 'failed';
}

export interface CallWebhookPayload {
  externalCallId: string;
  status: string;
  duration?: number;
  recordingUrl?: string;
  timestamp: string;
}

export interface TelephonyProvider {
  name: string;
  initiateCall(request: CallRequest): Promise<CallResult>;
  endCall(externalCallId: string): Promise<void>;
  getRecordingUrl(externalCallId: string): Promise<string | null>;
  verifyWebhookSignature(payload: string, signature: string, timestamp: string): boolean;
  parseWebhook(payload: unknown): CallWebhookPayload;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock provider for development
// ─────────────────────────────────────────────────────────────────────────────

export class MockTelephonyProvider implements TelephonyProvider {
  name = 'mock';

  async initiateCall(request: CallRequest): Promise<CallResult> {
    const id = `mock_call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info({ provider: 'mock', action: 'initiateCall', to: request.to }, 'telephony mock');
    return { externalCallId: id, status: 'initiated' };
  }

  async endCall(externalCallId: string): Promise<void> {
    logger.info({ provider: 'mock', action: 'endCall', externalCallId }, 'telephony mock');
  }

  async getRecordingUrl(externalCallId: string): Promise<string | null> {
    return `https://recordings.example.com/${externalCallId}.wav`;
  }

  verifyWebhookSignature(): boolean {
    // Mock callbacks are generated inside tests; they are never trusted as HTTP
    // webhooks. Returning false prevents development defaults becoming a bypass.
    return false;
  }

  parseWebhook(payload: unknown): CallWebhookPayload {
    const p = payload as Record<string, unknown>;
    return {
      externalCallId: String(p.callId ?? ''),
      status: String(p.status ?? 'completed'),
      duration: Number(p.duration ?? 0),
      recordingUrl: p.recordingUrl as string | undefined,
      timestamp: String(p.timestamp ?? new Date().toISOString()),
    };
  }
}

/** Generic HMAC provider used by vendors that support signing the raw body. */
export class HmacTelephonyProvider implements TelephonyProvider {
  name: string;

  constructor(name: string, private readonly webhookSecret: string) {
    if (!name || !webhookSecret) throw new Error('Telephony provider and webhook secret are required.');
    this.name = name;
  }

  async initiateCall(): Promise<CallResult> {
    throw new Error(`${this.name} outbound calling is not configured.`);
  }

  async endCall(): Promise<void> {
    throw new Error(`${this.name} outbound calling is not configured.`);
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
    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${payload}`)
      .digest();
    const actual = Buffer.from(supplied, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  parseWebhook(payload: unknown): CallWebhookPayload {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid webhook body.');
    const p = payload as Record<string, unknown>;
    const externalCallId = String(p.callId ?? '').trim();
    const status = String(p.status ?? '').trim().toLowerCase();
    const timestamp = String(p.timestamp ?? '').trim();
    if (!externalCallId || !['initiated', 'ringing', 'in_progress', 'completed', 'failed'].includes(status)) {
      throw new Error('Invalid call identifier or status.');
    }
    if (!timestamp || Number.isNaN(Date.parse(timestamp))) throw new Error('Invalid event timestamp.');
    const duration = p.duration == null ? undefined : Number(p.duration);
    if (duration !== undefined && (!Number.isFinite(duration) || duration < 0)) {
      throw new Error('Invalid duration.');
    }
    const recordingUrl = p.recordingUrl == null ? undefined : String(p.recordingUrl);
    if (recordingUrl && !recordingUrl.startsWith('https://')) throw new Error('Invalid recording URL.');
    return { externalCallId, status, timestamp, duration, recordingUrl };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
//
// To add a real provider (Twilio, Vonage, etc.):
//   1. Implement TelephonyProvider
//   2. Add to the factory switch
//   3. Store credentials in IntegrationConnection
// ─────────────────────────────────────────────────────────────────────────────

export function getTelephonyProvider(provider: string, config: Record<string, string> = {}): TelephonyProvider {
  if (provider === 'mock') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Mock telephony is forbidden in production.');
    }
    return new MockTelephonyProvider();
  }
  if (!config.webhookSecret) throw new Error(`Webhook secret is missing for ${provider}.`);
  return new HmacTelephonyProvider(provider, config.webhookSecret);
}
