import Redis from 'ioredis';
import { env } from './env';

const globalForRedis = globalThis as unknown as { __redis?: Redis };

export const redis =
  globalForRedis.__redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    // Importing a route during `next build` must not open infrastructure
    // connections. The first real Redis operation connects on demand.
    lazyConnect: true,
  });

redis.on('error', () => {
  // Call sites log operational failures with their request/job context. Keeping
  // an error listener here prevents ioredis from emitting process-level noise.
});

if (env.NODE_ENV !== 'production') globalForRedis.__redis = redis;

/** Config-only cache. Record data is never cached — see docs/00-ARCHITECTURE.md §6. */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit) as T;
  const value = await load();
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  return value;
}

/**
 * There is no pattern-based invalidation here, deliberately.
 *
 * There used to be: an `invalidate(pattern)` that ran a `SCAN`. Two things were
 * wrong with it. It also `publish`ed each invalidation on a `cache:invalidate`
 * channel nothing had ever subscribed to, which read as a cross-replica
 * invalidation bus and was not one — every cache in this application lives in
 * Redis, which all replicas share, so deleting the key here *is* the
 * cross-replica invalidation.
 *
 * And the sweep itself was the wrong shape at any size. A `SCAN MATCH` costs
 * O(*whole keyspace*) rather than O(matching keys), because Redis walks every
 * key to find the ones that match — so deleting a tenant's two entitlement keys
 * visited every cached actor, every live rate-limit window and all of BullMQ's
 * bookkeeping on the way.
 *
 * Both callers could name their keys instead, and now do:
 * `invalidateEntitlements` over a closed module list, and `ratelimit.clear`
 * over a window and its predecessor. `lib/auth/actorCache.ts` covers the case
 * where keys genuinely cannot be enumerated — one per signed-in user — by
 * versioning the values, so invalidation is a single `INCR`.
 *
 * Prefer one of those two shapes. `tests/unit/no-keyspace-sweep.spec.ts` fails
 * the build if a `SCAN` comes back.
 */
