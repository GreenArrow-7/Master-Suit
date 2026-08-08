import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { callbackSecrets, telephonyProvider } from '@/lib/integrations/telephony';
import type { WebhookRequest } from '@/lib/integrations/telephony/types';

/**
 * One signature scheme per vendor, because they genuinely have one each.
 *
 * The point under test is the thing a single generic validator would have got
 * wrong: Twilio signs the URL plus its sorted form parameters with SHA-1, Plivo
 * signs the URL plus a nonce with SHA-256 and ignores the body entirely, and the
 * two Indian vendors sign nothing at all — so for them the only credential is
 * the secret in the URL, and accepting a callback without it would be an open
 * endpoint that writes to the Call table.
 */

const WEBHOOK_KEY = '11111111-2222-3333-4444-555555555555';
const URL_BASE = 'https://app.example.com/api/v1/webhooks/telephony/' + WEBHOOK_KEY;

const request = (
  over: Partial<Omit<WebhookRequest, 'headers'>> & { headers: Record<string, string> },
): WebhookRequest => ({
  url: URL_BASE,
  rawBody: '',
  ...over,
  headers: new Headers(over.headers),
});

// ── Twilio ───────────────────────────────────────────────────────────────────
describe('Twilio callbacks', () => {
  const authToken = 'twilio-auth-token-under-test';
  const provider = telephonyProvider('twilio', { accountSid: 'ACtest', authToken }, WEBHOOK_KEY);
  const body = 'CallSid=CA123&CallStatus=completed&CallDuration=42&SequenceNumber=3';

  const sign = (url: string, rawBody: string) => {
    const params = new URLSearchParams(rawBody);
    let payload = url;
    for (const key of [...params.keys()].sort()) payload += key + params.getAll(key).join('');
    return createHmac('sha1', authToken).update(payload, 'utf8').digest('base64');
  };

  const headers = (url: string, rawBody: string) => ({
    'content-type': 'application/x-www-form-urlencoded',
    'x-twilio-signature': sign(url, rawBody),
  });

  it('accepts a correctly signed form callback', () => {
    expect(provider.validateWebhook(request({ rawBody: body, headers: headers(URL_BASE, body) }))).toBe(true);
  });

  it('rejects a body altered after signing', () => {
    const tampered = body.replace('CA123', 'CA999');
    expect(provider.validateWebhook(request({ rawBody: tampered, headers: headers(URL_BASE, body) }))).toBe(false);
  });

  it('rejects a signature minted for a different URL', () => {
    const other = `${URL_BASE.replace(WEBHOOK_KEY, 'aaaaaaaa-0000-0000-0000-000000000000')}`;
    expect(provider.validateWebhook(request({ rawBody: body, headers: headers(other, body) }))).toBe(false);
  });

  it('rejects a missing signature without throwing', () => {
    expect(provider.validateWebhook(request({ rawBody: body, headers: {} }))).toBe(false);
  });

  it('normalises the vendor status and keeps a per-call delivery identity', () => {
    const event = provider.parseWebhook(request({ rawBody: body, headers: headers(URL_BASE, body) }));
    expect(event).toMatchObject({ externalCallId: 'CA123', event: 'CALL_COMPLETED', durationSecs: 42 });
    expect(event.deliveryId).toBe('CA123:3');
  });

  it('reports a recording callback as its own event rather than a call status', () => {
    const recording =
      'CallSid=CA123&RecordingSid=RE9&RecordingStatus=completed&RecordingDuration=40' +
      '&RecordingUrl=https%3A%2F%2Fapi.twilio.com%2Frec%2FRE9';
    const event = provider.parseWebhook(request({ rawBody: recording, headers: headers(URL_BASE, recording) }));
    expect(event.event).toBe('RECORDING_AVAILABLE');
    expect(event.recordingUrl).toBe('https://api.twilio.com/rec/RE9.mp3');
    expect(event.deliveryId).toBe('RE9');
  });

  it('refuses a status vocabulary it does not recognise instead of guessing', () => {
    const odd = 'CallSid=CA123&CallStatus=teleported';
    expect(() => provider.parseWebhook(request({ rawBody: odd, headers: headers(URL_BASE, odd) }))).toThrow();
  });
});

// ── Plivo ────────────────────────────────────────────────────────────────────
describe('Plivo callbacks', () => {
  const authToken = 'plivo-auth-token-under-test';
  const provider = telephonyProvider('plivo', { authId: 'MAtest', authToken }, WEBHOOK_KEY);
  const body = 'RequestUUID=req-1&CallUUID=call-1&CallStatus=completed&Duration=30';
  const nonce = 'nonce-abc';

  const headers = (url: string, withNonce = nonce) => ({
    'content-type': 'application/x-www-form-urlencoded',
    'x-plivo-signature-v3': createHmac('sha256', authToken).update(`${url}${withNonce}`, 'utf8').digest('base64'),
    'x-plivo-signature-v3-nonce': withNonce,
  });

  it('accepts a correctly signed callback', () => {
    expect(provider.validateWebhook(request({ rawBody: body, headers: headers(URL_BASE) }))).toBe(true);
  });

  it('rejects a replayed signature under a different nonce', () => {
    const stale = headers(URL_BASE, 'nonce-abc');
    stale['x-plivo-signature-v3-nonce'] = 'nonce-xyz';
    expect(provider.validateWebhook(request({ rawBody: body, headers: stale }))).toBe(false);
  });

  it('accepts one valid signature among several during a key rotation', () => {
    const valid = headers(URL_BASE)['x-plivo-signature-v3'];
    expect(
      provider.validateWebhook(
        request({
          rawBody: body,
          headers: { ...headers(URL_BASE), 'x-plivo-signature-v3': `bogus-signature-value,${valid}` },
        }),
      ),
    ).toBe(true);
  });

  it('keys the call on RequestUUID, which is the only id the create call returns', () => {
    const event = provider.parseWebhook(request({ rawBody: body, headers: headers(URL_BASE) }));
    expect(event).toMatchObject({ externalCallId: 'req-1', event: 'CALL_COMPLETED', durationSecs: 30 });
  });
});

// ── Exotel and Knowlarity: unsigned, so the URL secret is the credential ──────
describe('unsigned vendors authenticate on the URL token', () => {
  const { urlToken } = callbackSecrets(WEBHOOK_KEY);
  const exotel = telephonyProvider(
    'exotel',
    { accountSid: 'sid', apiKey: 'k', apiToken: 't', subdomain: 'api.exotel.com' },
    WEBHOOK_KEY,
  );
  const knowlarity = telephonyProvider('knowlarity', { srNumber: '+911234', apiKey: 'k', authToken: 't' }, WEBHOOK_KEY);

  it('derives a token that is not the webhook key itself', () => {
    expect(urlToken).not.toContain(WEBHOOK_KEY);
    expect(urlToken.length).toBeGreaterThan(20);
    // Domain separation: the HMAC secret a signing vendor would use must not
    // double as a bearer token that authenticates on its own.
    expect(callbackSecrets(WEBHOOK_KEY).hmacSecret).not.toBe(urlToken);
  });

  it('accepts a callback carrying the token and refuses one without it', () => {
    const withToken = request({ url: `${URL_BASE}?token=${urlToken}`, headers: {} });
    const without = request({ url: URL_BASE, headers: {} });
    const wrong = request({ url: `${URL_BASE}?token=${'x'.repeat(urlToken.length)}`, headers: {} });

    for (const provider of [exotel, knowlarity]) {
      expect(provider.validateWebhook(withToken)).toBe(true);
      expect(provider.validateWebhook(without)).toBe(false);
      expect(provider.validateWebhook(wrong)).toBe(false);
    }
  });

  it('reads Exotel status callbacks in either encoding', () => {
    const form = 'CallSid=EX1&Status=completed&ConversationDuration=25';
    const json = JSON.stringify({ CallSid: 'EX1', Status: 'completed', ConversationDuration: 25 });

    const fromForm = exotel.parseWebhook(
      request({
        url: `${URL_BASE}?token=${urlToken}`,
        rawBody: form,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
    );
    const fromJson = exotel.parseWebhook(
      request({ url: `${URL_BASE}?token=${urlToken}`, rawBody: json, headers: { 'content-type': 'application/json' } }),
    );

    expect(fromForm.event).toBe('CALL_COMPLETED');
    expect(fromJson.event).toBe('CALL_COMPLETED');
    expect(fromJson.talkSecs).toBe(25);
    expect(fromForm.deliveryId).toBe(fromJson.deliveryId);
  });

  it('maps Knowlarity dispatch_status, which shares no vocabulary with the others', () => {
    const event = knowlarity.parseWebhook(
      request({
        url: `${URL_BASE}?token=${urlToken}`,
        rawBody: JSON.stringify({ call_id: 77, dispatch_status: 'not_answered', call_duration: 0 }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(event).toMatchObject({ externalCallId: '77', event: 'CALL_NO_ANSWER' });
  });
});

// ── Capability honesty ───────────────────────────────────────────────────────
describe('capabilities describe what the vendor can actually do', () => {
  it('does not claim hang-up or status polling for the vendors that cannot', () => {
    const plivo = telephonyProvider('plivo', { authId: 'a', authToken: 'b' }, WEBHOOK_KEY);
    expect(plivo.capabilities).not.toContain('END_CALL');
    expect(plivo.capabilities).not.toContain('CALL_STATUS');
    // And the method refuses rather than pretending to have worked.
    return expect(plivo.endCall('x')).rejects.toThrow();
  });

  it('claims signed webhooks only for the vendors that sign', () => {
    const signed = ['twilio', 'plivo'];
    const unsigned = ['exotel', 'knowlarity'];
    const build = (v: string) =>
      telephonyProvider(
        v,
        { accountSid: 'a', authToken: 'b', apiKey: 'c', apiToken: 'd', authId: 'e', srNumber: 'f' },
        WEBHOOK_KEY,
      );

    for (const v of signed) expect(build(v).capabilities).toContain('SIGNED_WEBHOOK');
    for (const v of unsigned) expect(build(v).capabilities).not.toContain('SIGNED_WEBHOOK');
  });
});
