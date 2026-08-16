import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MetaWhatsAppProvider } from '@/lib/integrations/whatsapp';

const appSecret = 'meta-app-secret-with-enough-entropy';
const verifyToken = 'a-different-string-entirely';
const payload = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp' } }] }],
});

const provider = () =>
  new MetaWhatsAppProvider({ accessToken: 'tok', phoneNumberId: '123', appSecret, webhookVerifyToken: verifyToken });

const sign = (body = payload, key = appSecret) => `sha256=${createHmac('sha256', key).update(body).digest('hex')}`;

describe('Meta webhook authentication', () => {
  it('accepts a payload signed with the app secret', () => {
    expect(provider().verifyWebhookSignature(payload, sign())).toBe(true);
  });

  /**
   * The regression this file exists for. Signing was keyed with the verify
   * token, so every genuine Meta callback was rejected — and an operator who
   * "fixed" delivery by pasting the app secret into the verify-token field
   * would have had it echoed back in a handshake query string.
   */
  it('rejects a payload signed with the verify token', () => {
    expect(provider().verifyWebhookSignature(payload, sign(payload, verifyToken))).toBe(false);
  });

  it('rejects missing, malformed and altered payloads without throwing', () => {
    expect(provider().verifyWebhookSignature(payload, '')).toBe(false);
    expect(provider().verifyWebhookSignature(payload, 'sha256=xyz')).toBe(false);
    expect(provider().verifyWebhookSignature(`${payload} `, sign())).toBe(false);
  });

  it('fails closed when no app secret is configured', () => {
    const unconfigured = new MetaWhatsAppProvider({ accessToken: 'tok', phoneNumberId: '123' });
    expect(unconfigured.verifyWebhookSignature(payload, sign())).toBe(false);
  });

  it('answers the subscription handshake from the verify token, not the app secret', () => {
    expect(provider().verifySubscription(verifyToken)).toBe(true);
    expect(provider().verifySubscription(appSecret)).toBe(false);
    expect(provider().verifySubscription('')).toBe(false);
  });
});
