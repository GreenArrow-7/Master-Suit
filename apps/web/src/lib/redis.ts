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

export async function invalidate(pattern: string) {
  const stream = redis.scanStream({ match: pattern, count: 200 });
  for await (const keys of stream) {
    if ((keys as string[]).length) await redis.del(...(keys as string[]));
  }
  await redis.publish('cache:invalidate', pattern);
}
