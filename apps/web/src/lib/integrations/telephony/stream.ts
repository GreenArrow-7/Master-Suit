/**
 * The live media-stream contract: how a vendor's forked call audio proves what
 * call it belongs to, and how Twilio's stream messages are read.
 *
 * Kept apart from the WebSocket server so the token and the parser — the two
 * parts that decide whether unauthenticated bytes from the internet get to
 * write into a tenant's call — are pure functions with tests.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Authenticates a stream to one call of one tenant. The dial route mints it
 * into the TwiML's <Parameter>s; the vendor echoes it in the start event. An
 * attacker who can reach the WS port can therefore open sockets, but cannot
 * attach audio to any call without the per-call secret.
 */
/** The redis pub/sub channel one live call's events travel on: engine → SSE. */
export const liveChannel = (callId: string) => `live-call:${callId}`;

export function streamToken(tenantId: string, callId: string): string {
  return createHmac('sha256', env.WEBHOOK_SIGNING_PEPPER).update(`live-stream:${tenantId}:${callId}`).digest('hex');
}

export function verifyStreamToken(tenantId: string, callId: string, token: string): boolean {
  const expected = Buffer.from(streamToken(tenantId, callId));
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Twilio Media Streams messages, reduced to what the engine consumes. */
export type StreamMessage =
  | { event: 'connected' }
  | {
      event: 'start';
      streamSid: string;
      callSid: string;
      tenantId: string;
      callId: string;
      token: string;
      /** 'inbound' is the agent leg's own audio; 'outbound' is what they hear — the customer. */
      tracks: string[];
      mediaFormat: { encoding: string; sampleRate: number; channels: number };
    }
  | { event: 'media'; track: 'inbound' | 'outbound'; payload: Buffer }
  | { event: 'stop' }
  | { event: 'ignored' };

export function parseStreamMessage(raw: string): StreamMessage {
  const msg = JSON.parse(raw) as Record<string, unknown>;
  switch (msg.event) {
    case 'connected':
      return { event: 'connected' };
    case 'start': {
      const start = (msg.start ?? {}) as {
        streamSid?: string;
        callSid?: string;
        tracks?: string[];
        customParameters?: Record<string, string>;
        mediaFormat?: { encoding?: string; sampleRate?: number; channels?: number };
      };
      const params = start.customParameters ?? {};
      return {
        event: 'start',
        streamSid: start.streamSid ?? String(msg.streamSid ?? ''),
        callSid: start.callSid ?? '',
        tenantId: params.tenantId ?? '',
        callId: params.callId ?? '',
        token: params.token ?? '',
        tracks: start.tracks ?? [],
        mediaFormat: {
          encoding: start.mediaFormat?.encoding ?? 'audio/x-mulaw',
          sampleRate: start.mediaFormat?.sampleRate ?? 8000,
          channels: start.mediaFormat?.channels ?? 1,
        },
      };
    }
    case 'media': {
      const media = (msg.media ?? {}) as { track?: string; payload?: string };
      if (media.track !== 'inbound' && media.track !== 'outbound') return { event: 'ignored' };
      return { event: 'media', track: media.track, payload: Buffer.from(media.payload ?? '', 'base64') };
    }
    case 'stop':
      return { event: 'stop' };
    default:
      // 'mark' and future events: not ours to reject the socket over.
      return { event: 'ignored' };
  }
}
