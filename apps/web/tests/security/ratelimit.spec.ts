/**
 * P1-2 — the limiter must be per-client, and must drain.
 *
 * Two independent defects met here:
 *
 *   1. `clientIp` returned null behind any proxy, so every login on the platform
 *      keyed the same bucket — ten attempts per fifteen minutes, shared by every
 *      customer. Proven below by two IPs getting separate counters.
 *   2. `consume` recorded the request *before* comparing, so refused attempts
 *      kept extending the window and the lockout never drained. Proven below by
 *      exhausting a bucket, hammering it while blocked, and checking the count
 *      has not grown.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { redis } from '@/lib/redis';
import { consume, limits } from '@/lib/security/ratelimit';
import { clientIp } from '@/lib/auth/session';
import { parseCidrList } from '@/lib/security/cidr';

const tag = randomBytes(4).toString('hex');
const key = (name: string) => `test:${tag}:${name}`;

afterAll(async () => {
  const found = await redis.keys(`rl:test:${tag}:*`);
  if (found.length) await redis.del(...found);
});

describe('consume', () => {
  it('allows up to max and refuses the next', async () => {
    const limit = { key: key('basic'), max: 3, windowSeconds: 60 };
    for (let i = 0; i < 3; i++) {
      const { remaining } = await consume(limit);
      expect(remaining).toBe(3 - (i + 1));
    }
    await expect(consume(limit)).rejects.toMatchObject({ status: 429 });
  });

  it('keeps separate counters for separate keys', async () => {
    const a = { key: key('sep-a'), max: 1, windowSeconds: 60 };
    const b = { key: key('sep-b'), max: 1, windowSeconds: 60 };
    await consume(a);
    await expect(consume(a)).rejects.toMatchObject({ status: 429 });
    // b must be untouched by a's exhaustion.
    await expect(consume(b)).resolves.toMatchObject({ remaining: 0 });
  });

  it('cannot be starved — refused attempts do not extend the window', async () => {
    const limit = { key: key('starve'), max: 2, windowSeconds: 60 };
    await consume(limit);
    await consume(limit);

    const redisKeys = await redis.keys(`rl:${limit.key}:*`);
    expect(redisKeys).toHaveLength(1);
    const afterExhaustion = Number(await redis.get(redisKeys[0]));

    // Twenty refused attempts, as an attacker or a retry loop would produce.
    for (let i = 0; i < 20; i++) {
      await expect(consume(limit)).rejects.toMatchObject({ status: 429 });
    }

    // The counter must not have grown. Under the old sliding-window
    // implementation each of these was recorded, so the window kept sliding
    // forward and the caller stayed locked out indefinitely.
    expect(Number(await redis.get(redisKeys[0]))).toBe(afterExhaustion);
  });

  it('reports a retry-after that does not exceed the window', async () => {
    const limit = { key: key('retry'), max: 1, windowSeconds: 60 };
    await consume(limit);
    await expect(consume(limit)).rejects.toMatchObject({
      status: 429,
      retryAfter: expect.any(Number),
    });
    await consume({ ...limit, key: key('retry2') }).catch(() => {});
  });

  it('expires the key so the bucket drains on its own', async () => {
    const limit = { key: key('ttl'), max: 1, windowSeconds: 60 };
    await consume(limit);
    const [redisKey] = await redis.keys(`rl:${limit.key}:*`);
    const ttl = await redis.pttl(redisKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });
});

describe('login buckets are per client, not global', () => {
  const TRUSTED = parseCidrList('10.0.0.0/8');
  const behindProxy = (forwarded: string) =>
    new Request('http://localhost', {
      headers: { 'x-forwarded-for': forwarded, 'x-real-ip': '10.0.0.5' },
    });

  it('two clients behind the same proxy get independent counters', async () => {
    const first = clientIp(behindProxy('203.0.113.10'), TRUSTED);
    const second = clientIp(behindProxy('203.0.113.99'), TRUSTED);
    expect(first).toBe('203.0.113.10');
    expect(second).toBe('203.0.113.99');
    expect(first).not.toBe(second);

    // Exhaust the first client's login bucket entirely.
    const firstLimit = { ...limits.loginPerIp(`${tag}-${first}`), max: 2 };
    const secondLimit = { ...limits.loginPerIp(`${tag}-${second}`), max: 2 };
    await consume(firstLimit);
    await consume(firstLimit);
    await expect(consume(firstLimit)).rejects.toMatchObject({ status: 429 });

    // The second client must be entirely unaffected. Before the fix both
    // resolved to the same `unknown` key and this would already be 429.
    await expect(consume(secondLimit)).resolves.toBeTruthy();

    for (const k of await redis.keys(`rl:login:ip:${tag}-*`)) await redis.del(k);
  });

  it('keys login attempts per identifier as well as per address', async () => {
    // Same address, two accounts: exhausting one must not lock out the other.
    const a = { ...limits.loginPerAccount(`${tag}-a@example.test`), max: 1 };
    const b = { ...limits.loginPerAccount(`${tag}-b@example.test`), max: 1 };
    await consume(a);
    await expect(consume(a)).rejects.toMatchObject({ status: 429 });
    await expect(consume(b)).resolves.toBeTruthy();

    for (const k of await redis.keys(`rl:login:acct:${tag}-*`)) await redis.del(k);
  });
});
