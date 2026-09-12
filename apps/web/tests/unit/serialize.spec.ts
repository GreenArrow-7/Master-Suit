/**
 * The cross-file lock excludes, and lets go.
 *
 * `lockShared` is what stops `platform-admin-crud.spec.ts` and
 * `p2-regressions.spec.ts` observing each other's `PlatformSetting` writes.
 * A lock that is held is only worth anything if a second holder is actually
 * refused, so this asks Postgres directly with `pg_try_advisory_lock` from a
 * separate session: false while held, true once released, and released again
 * for real by the time the test ends.
 */
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { lockShared } from '../helpers/serialize';

const KEY = 'test:serialize-spec-probe';

async function tryFromAnotherSession(): Promise<boolean> {
  const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await other.connect();
  try {
    const { rows } = await other.query<{ got: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS got', [
      KEY,
    ]);
    if (rows[0].got) await other.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [KEY]);
    return rows[0].got;
  } finally {
    await other.end();
  }
}

describe('lockShared', () => {
  it('refuses a second session while held, and admits it once released', async () => {
    const release = await lockShared(KEY);
    expect(await tryFromAnotherSession(), 'held: another session must be refused').toBe(false);
    await release();
    expect(await tryFromAnotherSession(), 'released: another session must get it').toBe(true);
    // Releasing twice is harmless, so an afterAll that runs after a failed
    // beforeAll cannot throw on top of the real failure.
    await release();
  });
});
