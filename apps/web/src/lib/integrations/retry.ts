import { logger } from '../logger';

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
