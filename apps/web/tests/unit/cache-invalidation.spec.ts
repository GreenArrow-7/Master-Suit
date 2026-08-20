/**
 * Invalidation still works after the keyspace sweep was removed.
 *
 * `invalidateEntitlements` and the sign-in throttle reset both used to call
 * `invalidate(pattern)`, which ran a `SCAN MATCH` over the whole database to
 * find a handful of keys. Both now name their keys instead.
 *
 * The property that matters is unchanged and is what these assert: a revoked
 * module stops working *now* rather than at the end of a TTL, and an unlocked
 * account can sign in again immediately. Getting that wrong is not a
 * performance regression — it is a cancelled subscription that keeps working,
 * or an administrator who unlocks an account that stays locked.
 *
 * Against a real Redis, because the thing under test is which keys exist in it.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { redis } from '@/lib/redis';
import { clear as clearLimit, consume } from '@/lib/security/ratelimit';
import { invalidateEntitlements } from '@/lib/security/entitlements';

const suffix = randomBytes(6).toString('hex');
const tenantId = `cache-inv-${suffix}`;

afterAll(async () => {
  const keys = await redis.keys(`*${suffix}*`);
  if (keys.length) await redis.del(...keys);
});

describe('entitlement invalidation', () => {
  it('drops every module the tenant could have cached, not just one', async () => {
    // Written directly rather than through assertModuleEntitlement, which would
    // need a real workspace: the unit under test is which keys get deleted.
    await redis.set(`t:${tenantId}:ent:HRMS`, '{"state":"ACTIVE","endsAt":null}');
    await redis.set(`t:${tenantId}:ent:SALES`, '{"state":"ACTIVE","endsAt":null}');

    await invalidateEntitlements(tenantId);

    expect(await redis.get(`t:${tenantId}:ent:HRMS`)).toBeNull();
    expect(await redis.get(`t:${tenantId}:ent:SALES`)).toBeNull();
  });

  it('leaves another tenant’s cache alone', async () => {
    const other = `${tenantId}-other`;
    await redis.set(`t:${other}:ent:SALES`, '{"state":"ACTIVE","endsAt":null}');

    await invalidateEntitlements(tenantId);

    expect(await redis.get(`t:${other}:ent:SALES`)).not.toBeNull();
  });

  it('is not upset by a tenant that has nothing cached', async () => {
    // `redis.del` of absent keys is a no-op returning 0; the old sweep simply
    // found nothing. Neither should throw, because this runs on every
    // subscription write whether or not anybody has hit that workspace yet.
    await expect(invalidateEntitlements(`${tenantId}-cold`)).resolves.toBeUndefined();
  });
});

describe('rate-limit reset', () => {
  it('lets a throttled key through again immediately', async () => {
    const limit = { key: `test:${suffix}`, max: 2, windowSeconds: 900 };

    await consume(limit);
    await consume(limit);
    await expect(consume(limit)).rejects.toThrow();

    await clearLimit(limit);

    // The whole point of the unlock path: not "in fifteen minutes".
    await expect(consume(limit)).resolves.toMatchObject({ remaining: 1 });
  });

  it('clears the previous window too, so a straddled unlock is not still throttled', async () => {
    const limit = { key: `test-prev:${suffix}`, max: 1, windowSeconds: 900 };
    const windowMs = limit.windowSeconds * 1000;
    const previous = Math.floor(Date.now() / windowMs) - 1;

    // A counter left over from the window the account was throttled in. The
    // fixed window means it is still present until its TTL expires, and it is
    // the one a caller crossing the boundary is about to be counted against.
    await redis.set(`rl:${limit.key}:${previous}`, '99');

    await clearLimit(limit);

    expect(await redis.get(`rl:${limit.key}:${previous}`)).toBeNull();
  });
});
