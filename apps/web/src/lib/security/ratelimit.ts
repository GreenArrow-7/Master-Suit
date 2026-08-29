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
const windowKey = (limit: Limit, window: number) => `rl:${limit.key}:${window}`;

/**
 * Drops a limit's counters, by name.
 *
 * Two keys, because a fixed window means at most the current one and its
 * predecessor exist at any moment — the older one is still there until its TTL
 * runs out, and leaving it behind would let a just-unlocked account be refused
 * by a window it was throttled in.
 *
 * By name rather than by pattern on purpose. The `SCAN` sweep this replaced was
 * O(*whole keyspace*) — not O(matching keys) — because SCAN has to walk every
 * key in the database to find the two it wants. On a deployment holding a
 * cached actor per signed-in user, a rate-limit counter per active user and
 * BullMQ's own bookkeeping, that is hundreds of thousands of keys visited to
 * delete two.
 */
export async function clear(limit: Limit): Promise<void> {
  const windowMs = limit.windowSeconds * 1000;
  const window = Math.floor(Date.now() / windowMs);
  await redis.del(windowKey(limit, window), windowKey(limit, window - 1));
}

export async function consume(limit: Limit): Promise<{ remaining: number; resetAt: number }> {
  const windowMs = limit.windowSeconds * 1000;
  const window = Math.floor(Date.now() / windowMs);
  const redisKey = windowKey(limit, window);
  const resetAt = (window + 1) * windowMs;

  const results = await redis.multi().incr(redisKey).pexpire(redisKey, windowMs).exec();
  const count = Number(results?.[0]?.[1] ?? 0);

  if (count > limit.max) {
    await redis.decr(redisKey);
    // Carried on the error so the route kernel can set Retry-After. Declared
    // rather than cast, so the kernel's read of the same field is checked.
    const err: Error & { retryAfter?: number } = TooManyRequests();
    err.retryAfter = Math.max(Math.ceil((resetAt - Date.now()) / 1000), 1);
    throw err;
  }
  return { remaining: Math.max(limit.max - count, 0), resetAt };
}

export const limits = {
  /**
   * Sign-in, per address and per account.
   *
   * A five-minute window rather than the fifteen it was: fifteen minutes is a
   * long time to be locked out of your own console for fat-fingering a password,
   * and the counts — 10 and 5 — are what actually bound a guessing attack. The
   * window only decides how long a legitimate person waits and how fast an
   * attacker may retry, and this trades the second for the first: the sustained
   * rate an attacker can hold rises threefold, from 10 to 30 attempts an hour
   * per address, which against a password policy of twelve characters is still
   * nowhere near a guessing budget.
   *
   * Note what the per-IP one really is when `TRUSTED_PROXY_CIDRS` is unset or
   * `none`: `clientIp()` returns null, the login route falls back to the literal
   * string `unknown`, and every caller shares one bucket. Ten sign-ins per five
   * minutes for the whole deployment, not per person. Configure the CIDRs to get
   * per-address limiting back — see lib/auth/session.ts.
   */
  loginPerIp: (ip: string) => ({ key: `login:ip:${ip}`, max: 10, windowSeconds: 300 }),
  loginPerAccount: (email: string) => ({ key: `login:acct:${email.toLowerCase()}`, max: 5, windowSeconds: 300 }),
  /**
   * Interactive sign-in to a service identity, keyed by username.
   *
   * Its own bucket rather than `loginPerAccount`, because the identifier is a
   * username and the account is not a person.
   *
   * **Ten, not three.** Three was chosen on the reasoning that nobody mistypes a
   * password held in a secret manager — which is true and was the wrong number
   * anyway, because it counted requests rather than sign-ins. The flow is two
   * POSTs: password, then password plus the code the server just asked for. One
   * successful sign-in therefore spent two thirds of the allowance, and the
   * second sign-in inside fifteen minutes was refused with "too many attempts"
   * having never got a single credential wrong.
   *
   * The route also clears this bucket on success, so a legitimate operator never
   * accumulates toward it. What remains counted is failure, which is what the
   * limit is for. Ten per fifteen minutes is still tighter than the human
   * route's sustained rate.
   */
  serviceLogin: (username: string) => ({ key: `svclogin:${username.toLowerCase()}`, max: 10, windowSeconds: 900 }),
  apiKey: (id: string, max: number) => ({ key: `api:${id}`, max, windowSeconds: 60 }),
  /**
   * A platform service credential, keyed per credential rather than per
   * identity: rotating a credential should not inherit the old one's spent
   * budget, and two credentials for one identity are two jobs with two
   * appetites.
   *
   * This is also the cross-tenant read ceiling. A machine that can read every
   * workspace is the caller whose runaway loop is most expensive, so the
   * per-credential default (120/min) is a fifth of what an API key gets.
   */
  platformService: (id: string, max: number) => ({ key: `svc:${id}`, max, windowSeconds: 60 }),
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
