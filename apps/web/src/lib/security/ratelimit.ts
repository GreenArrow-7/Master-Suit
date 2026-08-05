import { redis } from '../redis';
import { TooManyRequests } from '../errors';

/**
 * Sliding-window counter in Redis. Four keying levels are checked per request and
 * the most restrictive wins — see docs/05-SECURITY.md §6.
 */
export interface Limit { key: string; max: number; windowSeconds: number }

export async function consume(limit: Limit): Promise<{ remaining: number; resetAt: number }> {
  const now = Date.now();
  const windowMs = limit.windowSeconds * 1000;
  const windowStart = now - windowMs;
  const redisKey = `rl:${limit.key}`;

  const pipeline = redis.multi();
  pipeline.zremrangebyscore(redisKey, 0, windowStart);
  pipeline.zadd(redisKey, now, `${now}-${Math.random().toString(36).slice(2, 8)}`);
  pipeline.zcard(redisKey);
  pipeline.pexpire(redisKey, windowMs);
  const results = await pipeline.exec();

  const count = Number(results?.[2]?.[1] ?? 0);
  const resetAt = now + windowMs;

  if (count > limit.max) {
    const err = TooManyRequests();
    (err as any).retryAfter = Math.ceil(windowMs / 1000);
    throw err;
  }
  return { remaining: Math.max(limit.max - count, 0), resetAt };
}

export const limits = {
  loginPerIp: (ip: string) => ({ key: `login:ip:${ip}`, max: 10, windowSeconds: 900 }),
  loginPerAccount: (email: string) => ({ key: `login:acct:${email.toLowerCase()}`, max: 5, windowSeconds: 900 }),
  apiKey: (id: string, max: number) => ({ key: `api:${id}`, max, windowSeconds: 60 }),
  sessionUser: (id: string) => ({ key: `user:${id}`, max: 1200, windowSeconds: 60 }),
  publicForm: (ip: string) => ({ key: `form:${ip}`, max: 5, windowSeconds: 60 }),
  exportCreate: (id: string) => ({ key: `export:${id}`, max: 10, windowSeconds: 3600 }),
  passwordReset: (email: string) => ({ key: `pwreset:${email.toLowerCase()}`, max: 3, windowSeconds: 3600 }),
};
