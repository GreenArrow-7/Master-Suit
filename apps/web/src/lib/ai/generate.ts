import { logger } from '../logger';
import { geminiKey, geminiModel } from './gemini';
import { withRetry, isTransient } from '../integrations/retry';

/**
 * One structured model call.
 *
 * `analysis.ts`, `audit.ts`, `liveCoach.ts` and `assistant/service.ts` each grew
 * their own copy of this fetch — same URL shape, same retry, same timeout, same
 * four levels of optional chaining to reach the text. The features added here
 * needed a fifth, sixth and seventh, so it is one function now.
 *
 * Returns **null** when the workspace has no key, rather than throwing or
 * quietly substituting anything. Every caller pairs it with a deterministic
 * fallback that stamps itself as a simulation, which is the rule the rest of
 * this directory already follows: a demo must still work end to end, and it must
 * never be mistakable for a model's verdict.
 *
 * Redaction is the caller's job. Whether a prompt carries personal data depends
 * entirely on what went into it — a transcript does, a rubric does not — and a
 * blanket `redact()` here would corrupt the prompts that do not.
 */
export interface GenerateRequest {
  /** Whose key to run on. Absent falls back to the deployment key. */
  tenantId?: string | null;
  /** Log/retry label, e.g. `gemini-followup-email`. */
  label: string;
  prompt: string;
  /** Gemini `responseSchema` (the OpenAPI subset). */
  schema: object;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface GenerateResult<T> {
  result: T;
  modelId: string;
  processingMs: number;
}

/** Hard ceiling on one round-trip; a hung provider fails its one feature. */
const DEFAULT_TIMEOUT_MS = 60_000;

export async function generateJson<T>(request: GenerateRequest): Promise<GenerateResult<T> | null> {
  const apiKey = await geminiKey(request.tenantId);
  if (!apiKey) return null;

  const model = await geminiModel(request.tenantId);
  const started = Date.now();

  const data = await withRetry(
    request.label,
    async () => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: request.prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: request.schema,
              temperature: request.temperature ?? 0.3,
              maxOutputTokens: request.maxOutputTokens ?? 2048,
            },
          }),
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        logger.error({ status: res.status, model, label: request.label }, 'Gemini API error');
        const err: Error & { status?: number } = new Error(`Gemini API error: ${res.status} — ${body.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    { maxAttempts: 3, retryOn: isTransient },
  );

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`Empty response from Gemini (${request.label})`);

  return { result: JSON.parse(text) as T, modelId: model, processingMs: Date.now() - started };
}

/** Shorthand for the schema shapes below; Gemini wants the OpenAPI subset. */
export const str = { type: 'string' as const };
export const num = { type: 'number' as const };
export const strList = { type: 'array' as const, items: str };
