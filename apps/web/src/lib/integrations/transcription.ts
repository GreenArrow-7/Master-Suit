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
  /**
   * Speaker-attributed segments, where the provider diarises. Empty otherwise —
   * absent rather than faked, because a talk-to-listen ratio derived from
   * invented speaker labels is a number a manager would act on.
   */
  segments?: DiarisedSegment[];
}

export interface DiarisedSegment {
  /** The vendor's own channel label: Deepgram numbers from 0, Google tags from 1. */
  speaker: string;
  text: string;
  startSec?: number;
}

/**
 * Collapses per-word speaker tags into per-turn segments.
 *
 * Both diarising vendors return one entry per word with a speaker on it, which
 * is unusable directly: a hundred single-word segments is not a conversation.
 * Consecutive words from the same speaker become one turn.
 */
function groupWords(words: readonly { word: string; speaker: string; startSec?: number }[]): DiarisedSegment[] {
  const segments: DiarisedSegment[] = [];
  for (const w of words) {
    const current = segments.at(-1);
    if (current && current.speaker === w.speaker) current.text += ` ${w.word}`;
    else segments.push({ speaker: w.speaker, text: w.word, startSec: w.startSec });
  }
  return segments.map((s) => ({ ...s, text: s.text.trim() }));
}

/** Google returns "1.400s"; Deepgram returns a number. Neither is required. */
const toSeconds = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

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
    /**
     * Shaped like a real two-party call, not one line of prose: the analysis,
     * the talk-to-listen ratio and the objection matcher all read speaker
     * attribution, and a mock that omits it exercises none of them.
     */
    const segments: DiarisedSegment[] = [
      { speaker: '0', text: 'Good morning, thanks for taking the call. Is now still a good time?', startSec: 0 },
      { speaker: '1', text: 'Yes, but only a few minutes. Go ahead.', startSec: 6 },
      {
        speaker: '0',
        text: 'Understood. May I ask what you are looking for, and roughly what budget you had in mind?',
        startSec: 9,
      },
      {
        speaker: '1',
        text: 'A two bedroom near the schools. Honestly though, it sounds too expensive for us.',
        startSec: 16,
      },
      {
        speaker: '0',
        text: 'That is a fair concern. The payment plan spreads it over three years, so the monthly figure is lower than the headline price suggests.',
        startSec: 24,
      },
      {
        speaker: '1',
        text: 'Alright, send me the payment plan and the floor plan and I will look this week.',
        startSec: 34,
      },
      { speaker: '0', text: 'I will email both this afternoon and follow up on Thursday.', startSec: 41 },
    ];

    return {
      text: segments.map((s) => `${s.speaker === '0' ? 'Agent' : 'Client'}: ${s.text}`).join('\n'),
      segments,
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

    type Word = { word?: string; speakerTag?: number; startTime?: string };
    type Alternative = { transcript?: string; confidence?: number; words?: Word[] };
    const results = (data.results ?? []) as { alternatives?: Alternative[] }[];

    const text = results
      .map((r) => r.alternatives?.[0]?.transcript ?? '')
      .join(' ')
      .trim();

    const scored = results
      .map((r) => r.alternatives?.[0]?.confidence)
      .filter((c): c is number => typeof c === 'number');

    /**
     * Google puts the full diarised word list on the LAST result element only;
     * the earlier ones repeat the transcript without speaker tags. Reading any
     * other element gives a partial conversation attributed to nobody.
     */
    const diarised = (results.at(-1)?.alternatives?.[0]?.words ?? [])
      .filter((w) => w.word && w.speakerTag != null)
      .map((w) => ({ word: w.word!, speaker: String(w.speakerTag), startSec: toSeconds(w.startTime) }));

    return {
      text,
      segments: groupWords(diarised),
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

    const diarised = ((alternative?.words ?? []) as { word?: string; speaker?: number; start?: number }[])
      .filter((w) => w.word && w.speaker != null)
      .map((w) => ({ word: w.word!, speaker: String(w.speaker), startSec: toSeconds(w.start) }));

    return {
      text: String(alternative?.transcript ?? '').trim(),
      segments: groupWords(diarised),
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

/**
 * Which provider a workspace's transcription runs on, or null when it has none.
 *
 * The one place the development fallback lives, so the worker and the HTTP
 * route cannot disagree about whether the module works on a fresh clone. In
 * development an unconnected workspace falls back to `mock`, which is what makes
 * upload → transcribe → analyse → draft runnable with nothing configured. In
 * every other environment it returns null and the caller reports the feature as
 * unavailable — `getTranscriptionProvider` refuses `mock` in production outright,
 * so this cannot become a way to ship fake transcripts to a customer.
 */
export function transcriptionProviderFor(credentials: Record<string, string> | null): string | null {
  if (credentials?.provider) return credentials.provider;
  return process.env.NODE_ENV === 'development' ? 'mock' : null;
}

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
