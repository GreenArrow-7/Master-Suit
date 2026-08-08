import { redis } from '../redis';
import { TooManyRequests } from '../errors';

/**
 * Sliding-window counter in Redis. Four keying levels are checked per request and
 * the most restrictive wins — see docs/05-SECURITY.md §6.
 */
export interface Limit {
  key: string;
  max: number;
  windowSeconds: number;
}

/**
 * Fixed-window counter. Two commands, and a refused request is not kept.
 *
 * The previous sliding-window version added the request to the set and only
 * then compared, so a caller already over the limit extended their own window
 * with every rejected attempt. An attacker — or just a client retrying on a
 * timer — could hold a bucket locked open indefinitely, and the lockout never
 * drained. Rolling the refused increment back means the window always expires
 * on schedule.
 *
 * Fixed windows admit up to 2x the nominal rate across a boundary. That is the
 * accepted trade for a limiter that cannot be starved.
 */
export async function consume(limit: Limit): Promise<{ remaining: number; resetAt: number }> {
  const windowMs = limit.windowSeconds * 1000;
  const window = Math.floor(Date.now() / windowMs);
  const redisKey = `rl:${limit.key}:${window}`;
  const resetAt = (window + 1) * windowMs;

  const results = await redis.multi().incr(redisKey).pexpire(redisKey, windowMs).exec();
  const count = Number(results?.[0]?.[1] ?? 0);

  if (count > limit.max) {
    await redis.decr(redisKey);
    const err = TooManyRequests();
    (err as any).retryAfter = Math.max(Math.ceil((resetAt - Date.now()) / 1000), 1);
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
  /** Confirming an authenticator code: brute-forcing six digits must not be free. */
  mfaConfirm: (userId: string) => ({ key: `mfa:confirm:${userId}`, max: 10, windowSeconds: 300 }),
  /** Per-client, so one host cannot work through a list of addresses. */
  /** Redeeming or previewing an invitation: the token is the only credential. */
  inviteLookup: (ip: string) => ({ key: `invite:${ip}`, max: 30, windowSeconds: 600 }),
  passwordResetPerIp: (ip: string) => ({ key: `pwreset:ip:${ip}`, max: 20, windowSeconds: 3600 }),
  passwordReset: (email: string) => ({ key: `pwreset:${email.toLowerCase()}`, max: 3, windowSeconds: 3600 }),
  /**
   * Inbound webhooks. Unauthenticated at the point of arrival — the signature is
   * only checkable after a database lookup of the integration — so without this
   * anyone who learns an endpoint can drive two queries per request, forever.
   *
   * Keyed by the claimed integration key rather than by IP: a provider delivers
   * from a rotating pool of addresses, and per-IP limiting would either be
   * useless or would refuse legitimate traffic.
   */
  webhook: (integrationKey: string) => ({ key: `webhook:${integrationKey}`, max: 600, windowSeconds: 60 }),
};
