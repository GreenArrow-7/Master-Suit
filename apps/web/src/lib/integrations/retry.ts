import { AsyncLocalStorage } from 'node:async_hooks';

import { logger } from '../logger';

/**
 * How many times the call inside the current integration-event scope has been
 * tried.
 *
 * Ambient rather than threaded because the count is produced five layers below
 * where it is recorded: `withIntegrationEvent` wraps a provider method, that
 * calls `vendorFetch`, which decides for itself whether to retry. Passing a
 * counter down would mean an extra parameter on the provider interface, on every
 * one of its four implementations, and on the fetch helper — four files changed
 * so one number can travel up.
 *
 * Outside a scope this is `undefined` and every function here is a no-op, so
 * nothing depends on the store existing.
 */
const attemptScope = new AsyncLocalStorage<{ count: number }>();

/**
 * Runs `fn` with a fresh attempt counter and hands it a way to read the count.
 *
 * The reader is passed in rather than exposed as a module function so the
 * failure path can use it too. A `catch` placed outside the `run` call has
 * already left the scope, and would have read zero on exactly the calls whose
 * retry count is worth having.
 */
export function withAttemptCount<T>(fn: (attempts: () => number) => Promise<T>): Promise<T> {
  const store = { count: 0 };
  // A call that never reached `withRetry` was still one attempt.
  return attemptScope.run(store, () => fn(() => Math.max(store.count, 1)));
}

const countAttempt = () => {
  const store = attemptScope.getStore();
  if (store) store.count += 1;
};

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (error: unknown) => boolean;
}

const DEFAULTS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  retryOn: () => true,
};

export async function withRetry<T>(label: string, fn: () => Promise<T>, opts?: RetryOptions): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, retryOn } = { ...DEFAULTS, ...opts };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      countAttempt();
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts || !retryOn(err)) throw err;

      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const jitter = delay * (0.5 + Math.random() * 0.5);
      logger.warn({ label, attempt, maxAttempts, nextRetryMs: Math.round(jitter) }, 'retrying');
      await new Promise((r) => setTimeout(r, jitter));
    }
  }

  throw new Error('unreachable');
}

export function isTransient(err: unknown): boolean {
  if (err instanceof Error) {
    if ('status' in err) {
      const s = (err as any).status;
      return s === 429 || s === 502 || s === 503 || s === 504;
    }
    if (
      err.message.includes('ECONNRESET') ||
      err.message.includes('ETIMEDOUT') ||
      err.message.includes('fetch failed')
    ) {
      return true;
    }
  }
  return false;
}
