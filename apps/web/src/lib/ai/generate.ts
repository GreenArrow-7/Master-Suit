import { geminiCredential, geminiModel } from './gemini';
import { generateStructured } from './provider';
import { assertAiBudget, recordAiUsage } from './usage';
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
 *
 * The budget check and the meter are NOT the caller's job, and used to be
 * nobody's. `analysis`, `audit`, `liveCoach` and the assistant each called
 * `assertAiBudget` and `recordAiUsage` around their own fetch; the features on
 * this path — follow-up email drafting among them — called neither, so their
 * tokens were spent against the deployment key, counted by nothing, and absent
 * from the figure an administrator reads as "what the AI is costing us". Both
 * belong at the seam that issues the request, which is here.
 */
export interface GenerateRequest {
  /** Whose key to run on. Absent falls back to the deployment key. */
  tenantId?: string | null;
  /** Log/retry label, e.g. `gemini-followup-email`. */
  label: string;
  /** Metering label, e.g. `follow-up-email`. Defaults to `label`. */
  feature?: string;
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
  const credential = await geminiCredential(request.tenantId);
  if (!credential.key) return null;

  const model = await geminiModel(request.tenantId);
  const started = Date.now();
  const feature = request.feature ?? request.label;

  // Before the request that would be billed, which is the only useful place.
  await assertAiBudget(request.tenantId, credential);

  const response = await withRetry(
    request.label,
    () =>
      generateStructured({
        credential: { key: credential.key!, provider: credential.provider },
        model,
        prompt: request.prompt,
        schema: request.schema,
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens,
        timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }),
    { maxAttempts: 3, retryOn: isTransient },
  );

  // Recorded before the parse: the tokens were spent whether or not the model
  // returned JSON we can read, and a malformed answer is exactly the case where
  // a workspace burning its allowance most needs to show up in the ledger.
  await recordAiUsage(request.tenantId, credential, response.usage, { feature, model });

  return { result: JSON.parse(response.text) as T, modelId: model, processingMs: Date.now() - started };
}

/** Shorthand for the schema shapes below; Gemini wants the OpenAPI subset. */
export const str = { type: 'string' as const };
export const num = { type: 'number' as const };
export const strList = { type: 'array' as const, items: str };
