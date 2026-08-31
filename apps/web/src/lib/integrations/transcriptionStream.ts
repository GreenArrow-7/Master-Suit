/**
 * Streaming speech-to-text: Deepgram's live WebSocket, one connection per
 * audio track. The batch providers in transcription.ts wait for a finished
 * file; this one turns frames into text while the call is still happening.
 *
 * Deepgram only, deliberately: it is the one connected-provider option with a
 * production WebSocket API, and the workspace chooses its provider per tenant —
 * a workspace on Google batch transcription simply has no live engine until a
 * Deepgram key is connected, and the engine says so rather than pretending.
 *
 * Like lib/ai/provider.ts, the endpoint is overridable outside production so
 * the protocol can be tested against a local server speaking it; in production
 * the constant is the only answer.
 */
import WebSocket from 'ws';
import { logger } from '@/lib/logger';

const DEEPGRAM_LIVE = 'wss://api.deepgram.com/v1/listen';

export const liveSttEndpoint = () =>
  process.env.NODE_ENV === 'production' ? DEEPGRAM_LIVE : process.env.DEEPGRAM_LIVE_URL || DEEPGRAM_LIVE;

export interface LiveSttOptions {
  apiKey: string;
  /** Twilio media streams are 8kHz mulaw. */
  encoding?: string;
  sampleRate?: number;
  language?: string;
  /** Called with each FINAL transcript piece (interims are not surfaced). */
  onTranscript: (text: string) => void;
  onError?: (err: Error) => void;
}

export interface LiveSttConnection {
  sendAudio(frame: Buffer): void;
  close(): Promise<void>;
}

export type LiveSttFactory = (options: LiveSttOptions) => LiveSttConnection;

export const openLiveStt: LiveSttFactory = (options) => {
  const query = new URLSearchParams({
    encoding: options.encoding ?? 'mulaw',
    sample_rate: String(options.sampleRate ?? 8000),
    channels: '1',
    model: 'nova-2',
    smart_format: 'true',
    interim_results: 'false',
    ...(options.language ? { language: options.language } : {}),
  });

  const socket = new WebSocket(`${liveSttEndpoint()}?${query}`, {
    headers: { Authorization: `Token ${options.apiKey}` },
  });

  /** Frames that arrive before the socket opens are held, not dropped — the
   *  first seconds of a call are the greeting the coach needs. */
  const backlog: Buffer[] = [];
  let open = false;

  socket.on('open', () => {
    open = true;
    for (const frame of backlog.splice(0)) socket.send(frame);
  });

  socket.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as {
        type?: string;
        is_final?: boolean;
        channel?: { alternatives?: { transcript?: string }[] };
      };
      if (msg.type !== 'Results' || !msg.is_final) return;
      const text = msg.channel?.alternatives?.[0]?.transcript?.trim();
      if (text) options.onTranscript(text);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'unparseable live STT message');
    }
  });

  socket.on('error', (err) => options.onError?.(err));

  return {
    sendAudio(frame: Buffer) {
      if (open) socket.send(frame);
      else if (backlog.length < 500) backlog.push(frame);
    },
    close() {
      return new Promise<void>((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) return resolve();
        socket.once('close', () => resolve());
        try {
          // Deepgram flushes remaining audio on the close frame.
          socket.send(JSON.stringify({ type: 'CloseStream' }));
          socket.close();
        } catch {
          resolve();
        }
        // A provider that never answers the close must not hold the call open.
        setTimeout(resolve, 3000).unref();
      });
    },
  };
};
