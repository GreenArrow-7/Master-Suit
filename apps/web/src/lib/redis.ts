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
 * Deletes every key matching a pattern.
 *
 * ── The `publish` that used to be the last line ─────────────────────────────
 *
 * It announced each invalidation on a `cache:invalidate` channel that nothing
 * has ever subscribed to. That reads as a cross-replica invalidation bus — the
 * mechanism a second web replica would need if any cache lived in its memory —
 * and it is not one. Removed rather than given a subscriber, because there is
 * nothing for a subscriber to do: every cache in this application already lives
 * in Redis, which all replicas share, so deleting the key here *is* the
 * cross-replica invalidation.
 *
 * ── SCAN, and where it stops being adequate ─────────────────────────────────
 *
 * A `SCAN` sweep is O(keyspace) per call. That is fine for the entitlement cache
 * — one key per tenant per module, invalidated when somebody edits a
 * subscription — and it is why the permission cache in lib/auth/actorCache.ts
 * does *not* use this: at one key per signed-in user, sweeping to invalidate a
 * tenant is the wrong shape. That cache versions its values instead, so
 * invalidating is a single INCR. Prefer that pattern for anything that grows
 * with the user count rather than the tenant count.
 */
export async function invalidate(pattern: string) {
  const stream = redis.scanStream({ match: pattern, count: 200 });
  for await (const keys of stream) {
    if ((keys as string[]).length) await redis.del(...(keys as string[]));
  }
}
