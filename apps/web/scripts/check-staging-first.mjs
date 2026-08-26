/**
 * Refuses to apply a migration to production that has not already succeeded in
 * staging, with the same bytes.
 *
 * ── Why this is a gate and not a runbook step ───────────────────────────────
 *
 * docs/ENVIRONMENTS.md has said "staging first, then production" since it was
 * written. It was a sentence in a document, and until docker-compose.staging.yml
 * there was no staging to go first — so every migration's first contact with
 * production-shaped data was production. A rule with nothing enforcing it
 * survives exactly as long as nobody is in a hurry, and the moment somebody is
 * in a hurry is the moment it was written for.
 *
 * `prisma migrate deploy` has no down-path. A migration that locks a large table,
 * drops a column something still reads, or fails halfway leaves a production
 * database that has to be repaired forward, live. The cheapest possible place to
 * discover that is a rehearsal against a restored snapshot.
 *
 * ── What it compares ────────────────────────────────────────────────────────
 *
 * Three ledgers:
 *
 *   repo        prisma/migrations/<name>/migration.sql, and its sha256 — which
 *               is exactly what Prisma stores as `checksum`.
 *   production  _prisma_migrations in the database about to be migrated.
 *   staging     _prisma_migrations in the staging database.
 *
 * Anything in the repo that production has not finished is *pending*. Every
 * pending migration must appear in staging, finished, not rolled back, and with
 * a checksum matching the file on disk right now. That last clause is the one
 * that catches the subtler accident: a migration rehearsed in staging, then
 * edited before the production rollout. Prisma would apply the edited file
 * happily — the checksum it compares against is production's own ledger, which
 * has no row for it yet — and what production runs would be SQL nothing has ever
 * executed.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   MIGRATION_DATABASE_URL=... STAGING_DATABASE_URL=... node scripts/check-staging-first.mjs
 *
 * Wired into the production `migrate` service in docker-compose.azure.yml, so
 * the enforced path is the documented path — `docker compose ... run --rm
 * migrate` — rather than a second command somebody has to remember.
 *
 * Exit codes: 0 clear to deploy · 1 refused · 2 misconfigured.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

/**
 * The escape hatch, and why it is spelled out loud.
 *
 * A platform that has not stood staging up yet still has to be able to deploy,
 * and this script arriving in a release must not brick that. But "no staging
 * configured" has to be a decision somebody makes on purpose each time, in the
 * same idiom as ALLOW_DEMO_SEED and TRUSTED_PROXY_CIDRS=none — never a default
 * that quietly turns the gate off because a variable happens to be unset.
 */
const OVERRIDE = 'ALLOW_UNSTAGED_MIGRATION';

/** sha256 of the file, hex — the same value `prisma migrate` writes as `checksum`. */
export function checksum(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

/** Every committed migration, oldest first. Prisma orders by directory name. */
export function readRepoMigrations(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .flatMap((name) => {
      try {
        return [{ name, checksum: checksum(readFileSync(join(dir, name, 'migration.sql'))) }];
      } catch {
        // A directory with no migration.sql is not a migration; Prisma ignores
        // it too rather than failing, and so should this.
        return [];
      }
    });
}

/**
 * The decision, as a pure function of three ledgers.
 *
 * Separated from the database access so it can be tested against the shapes that
 * matter — a half-applied migration, an edited file, a staging that ran
 * something never committed — none of which are convenient to produce live.
 *
 * `production` and `staging` are arrays of
 * `{ name, checksum, finished_at, rolled_back_at }`.
 */
export function decide({ repo, production, staging }) {
  const byName = (rows) => new Map(rows.map((row) => [row.name, row]));
  const prod = byName(production);
  const stage = byName(staging);
  const applied = (row) => row && row.finished_at != null && row.rolled_back_at == null;

  const pending = repo.filter((m) => !applied(prod.get(m.name)));
  const problems = [];

  for (const migration of pending) {
    const rehearsal = stage.get(migration.name);
    if (!rehearsal) {
      problems.push({
        migration: migration.name,
        reason: 'never applied to staging',
        detail: 'Deploy this release to staging and run its migrate service before promoting it.',
      });
      continue;
    }
    if (rehearsal.rolled_back_at != null) {
      problems.push({
        migration: migration.name,
        reason: 'was rolled back in staging',
        detail: 'It failed the rehearsal. Fix the migration; do not carry it to production.',
      });
      continue;
    }
    if (rehearsal.finished_at == null) {
      problems.push({
        migration: migration.name,
        reason: 'is still unfinished in staging',
        detail:
          'The staging apply started and never completed — usually a lock it could not take, ' +
          'which production will not give it either.',
      });
      continue;
    }
    if (rehearsal.checksum !== migration.checksum) {
      problems.push({
        migration: migration.name,
        reason: 'was edited after staging ran it',
        detail:
          'The file on disk no longer matches what staging executed, so what production would ' +
          'run has never been rehearsed anywhere. Re-run it against a fresh staging database.',
      });
    }
  }

  // Not a refusal: staging having run something the repo does not carry means a
  // migration was applied there from an uncommitted branch. It cannot reach
  // production — `migrate deploy` only applies what is on disk — but it means the
  // rehearsal was against a schema nobody can reproduce, so it is worth saying.
  const repoNames = new Set(repo.map((m) => m.name));
  const strays = staging.filter((row) => !repoNames.has(row.name)).map((row) => row.name);

  return { pending: pending.map((m) => m.name), problems, strays, ok: problems.length === 0 };
}

/** `_prisma_migrations`, or [] when the table does not exist yet. */
async function ledger(url, label) {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (error) {
    console.error(`[staging-first] Could not connect to the ${label} database: ${error.message}`);
    process.exit(2);
  }
  try {
    const { rows } = await client.query(`
      SELECT migration_name AS name, checksum, finished_at, rolled_back_at
        FROM _prisma_migrations
       ORDER BY started_at
    `);
    return rows;
  } catch (error) {
    // 42P01 is undefined_table: a database that has never been migrated. Empty
    // is the correct reading of it, and for staging it is also a refusal —
    // nothing has been rehearsed there — which `decide` reaches on its own.
    if (error.code === '42P01') return [];
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const migrationsDir = process.env.PRISMA_MIGRATIONS_DIR ?? join(process.cwd(), 'prisma', 'migrations');
  const productionUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  const stagingUrl = process.env.STAGING_DATABASE_URL;

  if (!productionUrl) {
    console.error('[staging-first] Set MIGRATION_DATABASE_URL to the database about to be migrated.');
    process.exit(2);
  }

  if (!stagingUrl) {
    if (process.env[OVERRIDE] === 'yes') {
      console.warn(
        `\n[staging-first] SKIPPED — ${OVERRIDE}=yes and no STAGING_DATABASE_URL is set.\n` +
          '  This migration will meet production-shaped data for the first time in production.\n' +
          '  Stand staging up: see docs/DEPLOY-STAGING.md.\n',
      );
      return;
    }
    console.error(
      `\n[staging-first] Refusing to migrate: STAGING_DATABASE_URL is not set.\n\n` +
        '  docs/ENVIRONMENTS.md requires migrations to be applied to staging first. This\n' +
        "  checks that they were. Point it at the staging project's database:\n\n" +
        '    STAGING_DATABASE_URL=postgresql://leadflow:...@host.docker.internal:5433/leadflow_staging\n\n' +
        `  If this deployment genuinely has no staging, say so out loud — ${OVERRIDE}=yes —\n` +
        '  and understand what it means: no migration in this release has been run against\n' +
        '  production-shaped data anywhere, and `migrate deploy` has no down-path.\n' +
        '  See docs/DEPLOY-STAGING.md.\n',
    );
    process.exit(1);
  }

  const repo = readRepoMigrations(migrationsDir);
  if (repo.length === 0) {
    console.error(`[staging-first] No migrations found in ${migrationsDir} — is this the right working directory?`);
    process.exit(2);
  }

  const [production, staging] = await Promise.all([ledger(productionUrl, 'production'), ledger(stagingUrl, 'staging')]);
  const result = decide({ repo, production, staging });

  for (const stray of result.strays) {
    console.warn(
      `[staging-first] staging has applied "${stray}", which is not in this checkout — ` +
        'the rehearsal ran against a schema this release cannot reproduce.',
    );
  }

  if (!result.ok) {
    console.error(`\n[staging-first] Refusing to migrate. ${result.problems.length} migration(s) not cleared:\n`);
    for (const problem of result.problems) {
      console.error(`  ${problem.migration}\n    ${problem.reason} — ${problem.detail}\n`);
    }
    console.error(
      '  Staging first, then production (docs/ENVIRONMENTS.md). Deploy this release to the\n' +
        '  staging project and run its migrate service, then come back.\n',
    );
    process.exit(1);
  }

  console.log(
    result.pending.length === 0
      ? '[staging-first] Nothing pending: production is already at this release.'
      : `[staging-first] ${result.pending.length} pending migration(s), each already applied to staging: ` +
          `${result.pending.join(', ')}`,
  );
}

// Importable for tests without running the check.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
