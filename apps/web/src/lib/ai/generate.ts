import { geminiCredential } from './gemini';
import { generateStructured } from './provider';
import { assertAiBudget, recordAiUsage } from './usage';
import { modelCascade, runCascade } from './cascade';
import { routeFor } from './routing';
import { applyGuardrails } from './guardrails';
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

  /**
   * Before the request that would be billed, which is the only useful place.
   *
   * Every ceiling — platform, provider, plan, workspace, person, feature — is
   * checked inside `assertAiBudget`, because that is the function all ten AI
   * features call and this one is reached by four of them. It refuses by
   * throwing; what comes back is only whether a ceiling asked for a cheaper
   * model rather than a refusal.
   */
  let cheaper = false;
  try {
    ({ downgrade: cheaper } = await assertAiBudget(request.tenantId, credential, feature, request.userId));
  } catch (err) {
    await recordAiEvent({ ...base, kind: 'BUDGET_BLOCK', outcome: 'BLOCKED', reason: 'BUDGET_EXCEEDED' });
    throw err;
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

  /**
   * The chain to try, narrowed to what this credential can actually speak.
   *
   * A stored route is a platform decision about the deployment's own spend, so
   * it governs the deployment key only. A workspace paying its own provider
   * keeps the model it configured: overriding that would send their money to a
   * model they never chose.
   *
   * When a route names no step this credential can run, the answer is the
   * deployment's own cascade — never the route's first step. Posting an
   * OpenRouter model id to Google's endpoint is a 400, every feature would read
   * that as "the provider refused" and degrade to a simulated answer, and the
   * console would blame the model.
   */
  const route = credential.source === 'deployment' ? await routeFor(feature, request.tenantId) : null;
  const usable = route?.steps.filter((s) => s.provider === credential.provider) ?? [];
  const chain: { provider: string; model: string; timeoutMs?: number; retries?: number }[] = usable.length
    ? usable
    : (await modelCascade(request.tenantId)).map((model) => ({ provider: credential.provider, model }));
  // "Use a cheaper model" means start further down the chain, which is ordered
  // best first. With a single-step chain there is nothing cheaper to drop to and
  // the request runs as it would have — the ceiling was set to degrade, not to
  // refuse, so refusing here would be the wrong reading of it.
  const steps = cheaper && chain.length > 1 ? chain.slice(1) : chain;
  const models = steps.map((s) => s.model);

  let attempts = 0;
  try {
    const { value: response, model } = await runCascade(request.label, models, (m) => {
      attempts += 1;
      const step = steps.find((s) => s.model === m);
      return generateStructured({
        credential: { key: credential.key!, provider: credential.provider },
        model: m,
        // Already guarded above, and deliberately not named here: passing the
        // feature would run the rules a second time, double the rate-limit
        // counter and redact an already-redacted span.
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
    // `recordAiUsage` writes the per-attempt row as well as the monthly counters,
    // so every feature is recorded at one seam rather than four.
    const fellBack = model !== models[0];
    await recordAiUsage(request.tenantId, credential, response.usage, {
      feature,
      model,
      userId: request.userId,
      latencyMs: Date.now() - started,
      fellBackFrom: fellBack ? (models[0] ?? null) : null,
      metadata: {
        redacted: guard.redacted,
        detected: guard.detected,
        routed: Boolean(route?.configured && usable.length),
        cheaper,
      },
    });

    return { result: JSON.parse(response.text) as T, modelId: model, processingMs: Date.now() - started };
  } catch (err) {
    await recordAiEvent({
      ...base,
      // Only a model that was actually tried. With `attempts` still 0 nothing
      // reached a provider, and naming the first model would blame a model that
      // never saw the request for a failure that happened before it.
      model: attempts > 0 ? (models[Math.min(attempts, models.length) - 1] ?? null) : null,
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
