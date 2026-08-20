/**
 * No cache invalidation walks the keyspace.
 *
 * `invalidate(pattern)` in lib/redis.ts ran a `SCAN MATCH`, and the cost of that
 * is O(*whole keyspace*) rather than O(matching keys) — Redis walks every key in
 * the database to find the ones that match. Its two callers wanted two keys and
 * one key respectively, so each sweep visited every cached actor, every live
 * rate-limit window and all of BullMQ's bookkeeping on the way past.
 *
 * That is invisible until it is not: nothing fails, the sweep just takes longer
 * every month as the keyspace grows, on a path that runs whenever an
 * administrator edits a subscription or unlocks an account.
 *
 * There are two shapes that do not have this problem, and one of them always
 * applies:
 *
 *   - the keys can be named, so delete them by name — a closed module list, or
 *     a window and its predecessor;
 *   - the keys cannot be enumerated (one per signed-in user), so version the
 *     values and invalidate with a single `INCR`, as lib/auth/actorCache.ts does.
 *
 * This reads the source because the alternative is noticing in production.
 */
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '..', '..', 'src');

/** `KEYS` is worse than `SCAN` — it blocks the server for the whole walk. */
const SWEEPS = [
  { pattern: /\.scanStream\s*\(/, name: 'redis.scanStream()' },
  { pattern: /\bredis\s*\.\s*keys\s*\(/, name: 'redis.keys()' },
  { pattern: /\.sendCommand\s*\(\s*new\s+Command\s*\(\s*['"]scan['"]/i, name: 'a raw SCAN command' },
];

describe('cache invalidation', () => {
  const files = globSync('**/*.ts', { cwd: SRC });

  it('reads more than nothing', () => {
    // A glob that silently matches no files would make every assertion below
    // pass without checking anything.
    expect(files.length).toBeGreaterThan(100);
  });

  for (const sweep of SWEEPS) {
    it(`never uses ${sweep.name}`, () => {
      const offenders = files.filter((file) => sweep.pattern.test(readFileSync(join(SRC, file), 'utf8')));
      expect(
        offenders,
        `${sweep.name} walks the whole keyspace. Delete the keys by name, or version the values as lib/auth/actorCache.ts does.`,
      ).toEqual([]);
    });
  }
});
