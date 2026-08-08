/**
 * Clears the rate-limit counters before the suite runs.
 *
 * These buckets are the one piece of state that outlives a run. `.env.test` sets
 * `TRUSTED_PROXY_CIDRS=none` — correct, because nothing sits in front of a test
 * process — so `clientIp` has no trustworthy source and returns null, and every
 * sign-in in the suite shares one bucket keyed `login:ip:unknown`, capped at ten
 * per fifteen minutes.
 *
 * Within a single run that ceiling is comfortable. Across runs it is not: the
 * window is fifteen minutes, so a second `npm test` inside it starts with the
 * budget already spent and the specs that actually sign in fail with 429 —
 * tests/security/mfa-enrolment.spec.ts first, because it logs in twice.
 *
 * That failure mode is worse than flakiness. A security assertion that never
 * ran because the request was refused upstream looks exactly like one that
 * passed, and the same collision can turn a genuine regression green. Resetting
 * the counters makes every run start from the same state.
 *
 * Only `rl:*` is touched, and only in the test database — these are ephemeral
 * counters with a TTL, not data.
 */
import Redis from 'ioredis';

export default async function setup() {
  const url = process.env.REDIS_URL;
  if (!url) return;

  const redis = new Redis(url, { maxRetriesPerRequest: 2 });
  try {
    const keys = await redis.keys('rl:*');
    if (keys.length) await redis.del(...keys);
  } catch {
    // Redis down is the suite's problem to report, not this hook's to mask.
  } finally {
    await redis.quit().catch(() => {});
  }
}
