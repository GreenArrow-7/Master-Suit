import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HmacTelephonyProvider, MockTelephonyProvider } from '@/lib/integrations/telephony';

const secret = 'test-webhook-secret-with-enough-entropy';
const payload = JSON.stringify({
  callId: 'provider-call-42', status: 'completed', duration: 45,
  timestamp: '2026-08-03T08:00:00.000Z',
});

function sign(timestamp: string, body = payload) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

describe('telephony webhook authentication', () => {
  it('accepts a current correctly signed raw payload', () => {
    const timestamp = String(Date.now());
    const provider = new HmacTelephonyProvider('hmac', secret);
    expect(provider.verifyWebhookSignature(payload, sign(timestamp), timestamp)).toBe(true);
  });

  it('rejects missing, malformed and altered signatures without throwing', () => {
    const timestamp = String(Date.now());
    const provider = new HmacTelephonyProvider('hmac', secret);
    expect(provider.verifyWebhookSignature(payload, '', timestamp)).toBe(false);
    expect(provider.verifyWebhookSignature(payload, 'sha256=xyz', timestamp)).toBe(false);
    expect(provider.verifyWebhookSignature(`${payload} `, sign(timestamp), timestamp)).toBe(false);
  });

  it('rejects stale signed requests to limit replay', () => {
    const timestamp = String(Date.now() - 5 * 60_000 - 1);
    const provider = new HmacTelephonyProvider('hmac', secret);
    expect(provider.verifyWebhookSignature(payload, sign(timestamp), timestamp)).toBe(false);
  });

  it('never accepts HTTP signatures through the mock provider', () => {
    expect(new MockTelephonyProvider().verifyWebhookSignature()).toBe(false);
  });
});
