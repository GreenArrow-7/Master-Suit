/**
 * A database of its own, for a suite that destroys what it is testing.
 *
 * ── Why this exists (SPEC-0007 / CONV-015) ──────────────────────────────────
 *
 * `tests/hr/demo-reset.spec.ts` proves that the demo reset rebuilds the
 * workspace, and the only way to prove it is to destroy the workspace first. It
 * drops leave, rewrites attendance, deletes leads and then re-seeds — four
 * times over the file. Everything else that reads the demo workspace
 * (`tests/security/demo-personas.spec.ts` above all, which signs in as those
 * accounts and holds their sessions) shares the same database, and Vitest runs
 * files in parallel by default.
 *
 * So the persona suite would authenticate, the reset suite would delete and
 * recreate the users underneath it with new ids, and the persona suite's next
 * request would 401. Roughly one full run in three, in the file that asserts
 * tenant isolation and platform-admin denial — the worst place to have a
 * failure that everyone learns to re-run.
 *
 * The file header used to answer this with an instruction to pass
 * `--no-file-parallelism`. That is a note, not a control: `npm test` does not
 * pass it, CI does not pass it, and a test whose correctness depends on
 * remembering a flag is a test that is wrong by default.
 *
 * ── What was rejected ───────────────────────────────────────────────────────
 *
 * *Retries, waits, or a longer poll.* They convert a deterministic conflict
 * into a slower deterministic conflict, and they make a genuine 401 regression
 * indistinguishable from the race.
 *
 * *Turning off file parallelism globally.* It fixes this collision by making
 * every unrelated file slower, and it leaves the actual defect — two suites
 * owning one fixture — in place for the next pair to rediscover.
 *
 * *Making the reset non-destructive.* The destruction is the product behaviour
 * under test. Weakening it to suit the harness would be the harness winning an
 * argument it should not be in.
 *
 * ── What this does instead ──────────────────────────────────────────────────
 *
 * Gives the destructive suite its own database, derived from the ambient one by
 * name, created if absent and migrated on every run. Both suites then run at
 * full parallelism and neither can see the other's writes, because they are not
 * writing to the same place.
 *
 * Migrating every time is deliberate rather than wasteful. `migrate deploy` is
 * a no-op against an up-to-date database, and the failure it prevents is the
 * one `scripts/prepare-test-db.mjs` was written for: a test database that sat a
 * migration behind for weeks while `check:drift` reported the schema clean.
 * A second database is a second chance to make that mistake.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Client } from 'pg';

const PRISMA_CLI = 'node_modules/prisma/build/index.js';

/** The ambient migration connection, which is what a new database is cloned from. */
function baseUrl(): string | null {
  return process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || null;
}

function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

/**
 * `<ambient database>_<suffix>`, carrying the ambient credentials and options.
 *
 * Derived rather than configured. A second environment variable would be a
 * second thing to set, and the failure mode of forgetting it is a suite that
 * silently shares the database it was supposed to leave alone.
 */
export function isolatedDatabaseUrl(suffix: string): string | null {
  const base = baseUrl();
  if (!base) return null;
  const url = new URL(base);
  url.pathname = `/${databaseName(url)}_${suffix}`;
  return url.toString();
}

/**
 * Create the database if it is absent, then bring it to the current migration.
 *
 * Idempotent, and safe to call from several files: `CREATE DATABASE` races
 * resolve to `42P04`, which means the database exists, which is the outcome
 * being asked for.
 */
export async function ensureIsolatedDatabase(target: string): Promise<void> {
  const url = new URL(target);
  const name = databaseName(url);

  // `postgres`, not the target: a database cannot be created from inside
  // itself. `search` is dropped because Prisma URLs carry `?schema=`, which the
  // maintenance connection has no use for.
  const admin = new URL(target);
  admin.pathname = '/postgres';
  admin.search = '';

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (existing.rowCount === 0) {
      // The name is derived from the connection string this process was already
      // given, not from anything a test supplies, and it is quoted. There is no
      // parameter form for CREATE DATABASE.
      await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    }
  } catch (error) {
    // 42P04: another worker created it between the check and the create.
    if ((error as { code?: string })?.code !== '42P04') throw error;
  } finally {
    await client.end();
  }

  if (!existsSync(PRISMA_CLI)) {
    throw new Error('the Prisma CLI is not installed; run `npm install` before the suite');
  }

  // Both names are set. `prisma.config.ts` reads MIGRATION_DATABASE_URL first
  // and falls back to DATABASE_URL, and leaving the ambient value visible in
  // either would migrate the shared database instead of this one.
  execFileSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: target, MIGRATION_DATABASE_URL: target },
  });
}
