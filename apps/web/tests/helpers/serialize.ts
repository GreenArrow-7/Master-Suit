import pg from 'pg';

/**
 * Serialise spec files that share state the database cannot isolate for them.
 *
 * `PlatformSetting` carries no `tenantId` — it is in `GLOBAL_MODELS` — so two
 * spec files that touch the same key see each other's writes no matter how
 * their fixtures are tagged. Reading the same value the implementation reads
 * narrows the window; it does not close it. This closes it: a Postgres
 * advisory lock, session-scoped, on a dedicated connection.
 *
 * Why an advisory lock and not a vitest option: vitest has no cross-file mutex,
 * and `fileParallelism: false` would serialise all 160 files to protect two.
 * Why session-scoped on its own client: it is released by `pg_advisory_unlock`
 * in `afterAll`, and — if the worker dies before that — by the server when the
 * connection drops. Nothing is left held by a crashed test.
 *
 * Usage, in every file that reads or writes the shared thing:
 *
 *   let release: Release;
 *   beforeAll(async () => { release = await lockShared('platform-setting:uploadMaxMb'); });
 *   afterAll(async () => { await release(); });
 */
export type Release = () => Promise<void>;

export async function lockShared(key: string): Promise<Release> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  // hashtext gives a stable int4 for the key; the bigint overload accepts it.
  await client.query('SELECT pg_advisory_lock(hashtext($1)::bigint)', [key]);
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await client.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [key]).catch(() => {});
    await client.end().catch(() => {});
  };
}

/** The one key both upload-limit specs contend for. */
export const UPLOAD_LIMIT_LOCK = 'test:platform-setting:uploadMaxMb';
