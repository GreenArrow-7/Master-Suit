import { logger } from '../logger';
import { withRetry, isTransient } from './retry';

/**
 * Hard ceiling on one provider round-trip. A hung provider must fail the one
 * feature that needed it, not hold a connection (and on the request path, a
 * request) open indefinitely — graceful degradation starts with a deadline.
 */
const TRANSCRIBE_TIMEOUT_MS = 300_000;

// ─────────────────────────────────────────────────────────────────────────────
// Transcription (speech-to-text) provider abstraction
//
// Closes the gap between "recording stored" and "Gemini analyses the call":
// nothing else in the pipeline turns audio into the Transcript row that
// AIAnalysis depends on.
// ─────────────────────────────────────────────────────────────────────────────

export interface TranscriptionRequest {
  audio: Buffer;
  mimeType: string;
  /** BCP-47, e.g. `en-IN`. Providers that auto-detect may return a different one. */
  language?: string;
}

export interface TranscriptionResult {
  text: string;
  /** 0–1 where the provider reports one. Whisper does not, so it stays undefined. */
  confidence?: number;
  language: string;
  provider: string;
}

export interface TranscriptionProvider {
  name: string;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

/** Providers reject audio above their request limit; fail before the upload, not after. */
const MAX_INLINE_BYTES = 10 * 1024 * 1024;

function assertSize(audio: Buffer, provider: string) {
  if (audio.length > MAX_INLINE_BYTES) {
    throw new Error(
      `Recording is ${Math.round(audio.length / 1024 / 1024)}MB, over the ${MAX_INLINE_BYTES / 1024 / 1024}MB inline limit for ${provider}.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock provider for development
// ─────────────────────────────────────────────────────────────────────────────

export class MockTranscriptionProvider implements TranscriptionProvider {
  name = 'mock';

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    logger.info({ provider: 'mock', bytes: request.audio.length }, 'transcription mock');
    return {
      text: '[mock transcript] Agent: Good morning, thanks for taking the call. Client: Send me the pricing.',
      confidence: 1,
      language: request.language ?? 'en',
      provider: 'mock',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Cloud Speech-to-Text
// ─────────────────────────────────────────────────────────────────────────────

const GOOGLE_ENCODING: Record<string, string> = {
  'audio/webm': 'WEBM_OPUS',
  'audio/ogg': 'OGG_OPUS',
  'audio/flac': 'FLAC',
  'audio/l16': 'LINEAR16',
  'audio/wav': 'LINEAR16',
  'audio/x-wav': 'LINEAR16',
  'audio/mpeg': 'MP3',
  'audio/mp3': 'MP3',
};

export class GoogleTranscriptionProvider implements TranscriptionProvider {
  name = 'google';

  constructor(private apiKey: string) {}

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    // ponytail: synchronous recognize, so calls are capped at ~60s of audio and
    // 10MB. Longer recordings need longrunningrecognize, which only reads from a
    // GCS bucket — that means mirroring recordings out of S3 first. Switch when
    // real call lengths justify the second storage hop.
    assertSize(request.audio, 'Google Speech-to-Text');

    const encoding = GOOGLE_ENCODING[request.mimeType.split(';')[0].trim().toLowerCase()];
    if (!encoding) throw new Error(`Google Speech-to-Text does not accept ${request.mimeType}.`);

    const language = request.language ?? 'en-US';

    const data = await withRetry(
      'google-stt',
      async () => {
        const res = await fetch(
          `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(this.apiKey)}`,
          {
            signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              config: {
                encoding,
                languageCode: language,
                enableAutomaticPunctuation: true,
                // Two-party sales call: the agent and the client.
                diarizationConfig: { enableSpeakerDiarization: true, minSpeakerCount: 2, maxSpeakerCount: 2 },
              },
              audio: { content: request.audio.toString('base64') },
            }),
          },
        );

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const err: any = new Error(`Google Speech-to-Text error: ${res.status} — ${body.slice(0, 200)}`);
          err.status = res.status;
          throw err;
        }
        return res.json();
      },
      { maxAttempts: 3, retryOn: isTransient },
    );

    type Alternative = { transcript?: string; confidence?: number };
    const results = (data.results ?? []) as { alternatives?: Alternative[] }[];

    const text = results
      .map((r) => r.alternatives?.[0]?.transcript ?? '')
      .join(' ')
      .trim();

    const scored = results
      .map((r) => r.alternatives?.[0]?.confidence)
      .filter((c): c is number => typeof c === 'number');

    return {
      text,
      confidence: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : undefined,
      language,
      provider: this.name,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deepgram
// ─────────────────────────────────────────────────────────────────────────────

export class DeepgramTranscriptionProvider implements TranscriptionProvider {
  name = 'deepgram';

  constructor(
    private apiKey: string,
    private model = 'nova-2-phonecall',
  ) {}

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const language = request.language ?? 'en';
    const query = new URLSearchParams({
      model: this.model,
      language,
      punctuate: 'true',
      diarize: 'true',
      smart_format: 'true',
    });

    const data = await withRetry(
      'deepgram',
      async () => {
        const res = await fetch(`https://api.deepgram.com/v1/listen?${query}`, {
          signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
          method: 'POST',
          headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': request.mimeType },
          body: new Uint8Array(request.audio),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const err: any = new Error(`Deepgram error: ${res.status} — ${body.slice(0, 200)}`);
          err.status = res.status;
          throw err;
        }
        return res.json();
      },
      { maxAttempts: 3, retryOn: isTransient },
    );

    const alternative = data.results?.channels?.[0]?.alternatives?.[0];

    return {
      text: String(alternative?.transcript ?? '').trim(),
      confidence: typeof alternative?.confidence === 'number' ? alternative.confidence : undefined,
      language,
      provider: this.name,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Whisper — self-hosted, OpenAI-compatible /v1/audio/transcriptions
//
// Audio never leaves the deployment's own network, which is the reason to pick
// this one over the hosted options.
// ─────────────────────────────────────────────────────────────────────────────

export class WhisperTranscriptionProvider implements TranscriptionProvider {
  name = 'whisper';

  constructor(
    private endpoint: string,
    private apiKey?: string,
    private model = 'whisper-1',
  ) {}

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const language = request.language ?? 'en';

    const data = await withRetry(
      'whisper',
      async () => {
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(request.audio)], { type: request.mimeType }), 'recording');
        form.append('model', this.model);
        form.append('language', language);

        const res = await fetch(`${this.endpoint.replace(/\/$/, '')}/v1/audio/transcriptions`, {
          signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
          method: 'POST',
          headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
          body: form,
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const err: any = new Error(`Whisper error: ${res.status} — ${body.slice(0, 200)}`);
          err.status = res.status;
          throw err;
        }
        return res.json();
      },
      { maxAttempts: 3, retryOn: isTransient },
    );

    // Whisper reports no confidence score; the field stays undefined rather than
    // inventing a number that reviewers would read as a quality signal.
    return { text: String(data.text ?? '').trim(), language, provider: this.name };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
//
// Credentials come from the tenant's IntegrationConnection (see
// `connectionCredentials`), so each customer picks their own provider.
// ─────────────────────────────────────────────────────────────────────────────

export function getTranscriptionProvider(provider: string, config: Record<string, string> = {}): TranscriptionProvider {
  switch (provider) {
    case 'google':
      if (!config.apiKey) throw new Error('Google Speech-to-Text requires an API key.');
      return new GoogleTranscriptionProvider(config.apiKey);

    case 'deepgram':
      if (!config.apiKey) throw new Error('Deepgram requires an API key.');
      return new DeepgramTranscriptionProvider(config.apiKey, config.model || undefined);

    case 'whisper':
      if (!config.endpoint) throw new Error('Whisper requires an endpoint URL.');
      return new WhisperTranscriptionProvider(config.endpoint, config.apiKey, config.model || undefined);

    case 'mock':
      // A mock transcript is worse than no transcript: it flows through Gemini
      // and lands in the CRM as if a real conversation had been read.
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Mock transcription is forbidden in production.');
      }
      return new MockTranscriptionProvider();

    default:
      throw new Error(`Unknown transcription provider: ${provider}`);
  }
}
