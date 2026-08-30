/**
 * The two functions that stand between the open internet and a tenant's call:
 * the per-call stream token and the vendor message parser. Pure, no sockets.
 */
import { describe, it, expect } from 'vitest';
import { streamToken, verifyStreamToken, parseStreamMessage } from '@/lib/integrations/telephony/stream';

describe('stream token', () => {
  it('round-trips for the call it was minted for and nothing else', () => {
    const token = streamToken('tenant1', 'call1');
    expect(verifyStreamToken('tenant1', 'call1', token)).toBe(true);
    expect(verifyStreamToken('tenant1', 'call2', token)).toBe(false);
    expect(verifyStreamToken('tenant2', 'call1', token)).toBe(false);
    expect(verifyStreamToken('tenant1', 'call1', 'forged')).toBe(false);
    expect(verifyStreamToken('tenant1', 'call1', '')).toBe(false);
  });
});

describe('parseStreamMessage', () => {
  it('reads a Twilio start event with custom parameters', () => {
    const msg = parseStreamMessage(
      JSON.stringify({
        event: 'start',
        start: {
          streamSid: 'MZ123',
          callSid: 'CA123',
          tracks: ['inbound', 'outbound'],
          customParameters: { tenantId: 't1', callId: 'c1', token: 'tok' },
          mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
        },
      }),
    );
    expect(msg).toMatchObject({ event: 'start', tenantId: 't1', callId: 'c1', token: 'tok', callSid: 'CA123' });
  });

  it('decodes media payloads per track and ignores unknown tracks', () => {
    const media = parseStreamMessage(
      JSON.stringify({ event: 'media', media: { track: 'outbound', payload: Buffer.from('hi').toString('base64') } }),
    );
    expect(media).toMatchObject({ event: 'media', track: 'outbound' });
    expect((media as { payload: Buffer }).payload.toString()).toBe('hi');

    expect(parseStreamMessage(JSON.stringify({ event: 'media', media: { track: 'weird', payload: '' } }))).toEqual({
      event: 'ignored',
    });
  });

  it('treats marks and future events as ignorable, not errors', () => {
    expect(parseStreamMessage(JSON.stringify({ event: 'mark', mark: { name: 'x' } }))).toEqual({ event: 'ignored' });
    expect(parseStreamMessage(JSON.stringify({ event: 'stop' }))).toEqual({ event: 'stop' });
  });
});
