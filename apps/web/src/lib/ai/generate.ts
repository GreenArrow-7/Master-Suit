import { geminiCredential } from './gemini';
import { generateStructured } from './provider';
import { assertAiBudget, recordAiUsage } from './usage';
import { runCascade } from './cascade';
import { routeFor } from './routing';
import { applyGuardrails } from './guardrails';
import { checkBudget } from './budgets';
import { recordAiEvent, reasonFor } from './events';
import { Forbidden } from '../errors';

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
 * This is also the one seam every billed request crosses, so the AI Control
 * Center attaches here rather than in each feature: the guardrails that may
 * rewrite or refuse the prompt, the budget ceilings, the per-feature model
 * chain, and the per-attempt record the portal reads. A feature that called
 * `generateJson` yesterday is governed today without being touched.
 *
 * Redaction is still the caller's job for the prompts it builds — whether a
 * prompt carries personal data depends entirely on what went into it. The
 * `pii_redaction` guardrail is the backstop, not the substitute.
 */
export interface GenerateRequest {
  /** Whose key to run on. Absent falls back to the deployment key. */
  tenantId?: string | null;
  /** Log/retry label, e.g. `gemini-followup-email`. */
  label: string;
  /** Metering label, e.g. `follow-up-email`. Defaults to `label`. */
  feature?: string;
  /** The person asking, when there is one; enables the per-user ceiling and attribution. */
  userId?: string | null;
  prompt: string;
  /**
   * The portion of the prompt that came from a customer — a transcript, an
   * email body, a note. Only this is searched for instructions aimed at the
   * model; the prompt this codebase wrote around it legitimately contains them.
   */
  untrusted?: string | null;
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

  const started = Date.now();
  const feature = request.feature ?? request.label;
  const base = {
    tenantId: request.tenantId,
    userId: request.userId,
    feature,
    provider: credential.provider as string,
  };

  // Before the request that would be billed, which is the only useful place.
  await assertAiBudget(request.tenantId, credential, feature, request.userId);

  // A workspace on its own key spends its own money; the platform's ceilings
  // are about the deployment's bill, so they apply to the deployment key only.
  if (credential.source === 'deployment') {
    const verdict = await checkBudget({
      tenantId: request.tenantId,
      provider: credential.provider,
      feature,
      userId: request.userId,
    });
    if (!verdict.allowed) {
      await recordAiEvent({ ...base, kind: 'BUDGET_BLOCK', outcome: 'BLOCKED', reason: 'BUDGET_EXCEEDED' });
      throw Forbidden(verdict.message ?? 'This workspace has reached its AI budget.');
    }
  }

  const guard = await applyGuardrails({
    prompt: request.prompt,
    untrusted: request.untrusted,
    tenantId: request.tenantId,
    feature,
  });
  if (!guard.allowed) {
    await recordAiEvent({ ...base, kind: 'GUARDRAIL_BLOCK', outcome: 'BLOCKED', reason: guard.reason });
    throw Forbidden(guard.message ?? 'This request was refused by an AI safety rule.');
  }

  // Cross-provider routing needs a credential per provider, which the key store
  // does not yet hold, so a chain is narrowed to the steps this credential can
  // actually run. Attributing a step to a provider that never saw it would put
  // a wrong price on the row and a wrong name in the portal.
  const route = await routeFor(feature, request.tenantId);
  const usable = route.steps.filter((s) => s.provider === credential.provider);
  const steps = usable.length ? usable : route.steps.slice(0, 1);
  const models = steps.map((s) => s.model);

  let attempts = 0;
  try {
    const { value: response, model } = await runCascade(request.label, models, (m) => {
      attempts += 1;
      const step = steps.find((s) => s.model === m);
      return generateStructured({
        credential: { key: credential.key!, provider: credential.provider },
        model: m,
        prompt: guard.prompt,
        schema: request.schema,
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens,
        timeoutMs: step?.timeoutMs ?? request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
    });

    // Recorded before the parse: the tokens were spent whether or not the model
    // returned JSON we can read, and a malformed answer is exactly the case where
    // a workspace burning its allowance most needs to show up in the ledger.
    await recordAiUsage(request.tenantId, credential, response.usage, { feature, model, userId: request.userId });
    const fellBack = model !== models[0];
    await recordAiEvent({
      ...base,
      model,
      kind: fellBack ? 'FALLBACK' : 'REQUEST',
      outcome: fellBack ? 'FELL_BACK' : 'OK',
      attempt: attempts,
      fellBackFrom: fellBack ? (models[0] ?? null) : null,
      inputTokens: response.usage.promptTokens,
      outputTokens: response.usage.completionTokens,
      latencyMs: Date.now() - started,
      metadata: { redacted: guard.redacted, detected: guard.detected, routed: route.configured },
    });

    return { result: JSON.parse(response.text) as T, modelId: model, processingMs: Date.now() - started };
  } catch (err) {
    await recordAiEvent({
      ...base,
      model: models[Math.min(attempts, models.length) - 1] ?? null,
      kind: 'PROVIDER_ERROR',
      outcome: 'FAILED',
      reason: reasonFor(err),
      attempt: attempts,
      latencyMs: Date.now() - started,
    });
    throw err;
  }
}

/** Shorthand for the schema shapes below; Gemini wants the OpenAPI subset. */
export const str = { type: 'string' as const };
export const num = { type: 'number' as const };
export const strList = { type: 'array' as const, items: str };
