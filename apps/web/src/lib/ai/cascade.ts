import { logger } from '../logger';
import { isTransient, withRetry } from '../integrations/retry';
import { geminiModel } from './gemini';

/**
 * Cascading models (§19): the workspace's primary model first, then a cheaper
 * fallback when the primary keeps failing transiently — timeouts, 429s, 5xx,
 * "overloaded". Anything that is not transient (a bad key, a malformed request)
 * fails at once, because the fallback would fail the same way and would cost a
 * second round of retries to prove it. What comes after the last model is the
 * caller's business: every feature already degrades to labelled heuristics.
 *
 * The fallback is configured, never guessed: `GEMINI_FALLBACK_MODEL` on the
 * deployment. Absent, the cascade is the primary model alone.
 */
export async function modelCascade(tenantId?: string | null): Promise<string[]> {
  const primary = await geminiModel(tenantId);
  const fallback = process.env.GEMINI_FALLBACK_MODEL?.trim();
  return fallback && fallback !== primary ? [primary, fallback] : [primary];
}

export interface CascadeResult<T> {
  value: T;
  /** The model that actually answered, for usage attribution. */
  model: string;
}

export async function runCascade<T>(
  label: string,
  models: string[],
  run: (model: string) => Promise<T>,
  opts: { maxAttempts?: number } = {},
): Promise<CascadeResult<T>> {
  let lastError: unknown;
  for (const [index, model] of models.entries()) {
    try {
      const value = await withRetry(`${label}:${model}`, () => run(model), {
        maxAttempts: opts.maxAttempts ?? 3,
        retryOn: isTransient,
      });
      if (index > 0) logger.warn({ label, model, primary: models[0] }, 'ai answered on the fallback model');
      return { value, model };
    } catch (err) {
      lastError = err;
      if (!isTransient(err) || index === models.length - 1) throw err;
      logger.warn(
        { label, model, next: models[index + 1], err: (err as Error).message },
        'ai model failed transiently, cascading',
      );
    }
  }
  throw lastError;
}
