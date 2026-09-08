#!/usr/bin/env node
/**
 * Prepare the local test database `.env.test` names.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Nothing created it. `npm run setup` migrates the database `.env` names —
 * `leadflow` — and `infra/docker-compose.yml` creates only that one. So
 * `master_saas_test` was whatever each machine happened to have, and on this
 * one it sat a migration behind for long enough that eighteen tests failed with
 * a missing column while `check:drift` reported the schema clean. That is the
 * worst shape a test environment can take: wrong, and quietly so.
 *
 * ── What it does ────────────────────────────────────────────────────────────
 *
 *   create the database if it is absent  →  apply existing migrations  →  seed
 *
 * Idempotent. Running it against a prepared database applies no migration and
 * destroys nothing. It creates no migration and touches no schema file; it only
 * runs migrations that already exist in `prisma/migrations`.
 *
 * ── Why it seeds ────────────────────────────────────────────────────────────
 *
 * Because CI does, and a "deterministic" local database that differs from the
 * one the suite is actually gated on is not deterministic — it is a second,
 * quieter environment.
 *
 * `.github/workflows/ci.yml` runs the migrations, then `npm run db:seed`, and
 * only then `npm test`. Without the seed one test skips locally that executes
 * in CI: `tests/permission/engagement-modules.spec.ts` → *"grants each role
 * exactly what it already had on leads — never more"*, which calls
 * `ctx.skip()` when no tenant exists. That is a real authorization assertion —
 * it is what proves the engagement migration did not hand a role more than its
 * `leads` grants — and skipping it locally means the check most worth having
 * before a permission change is the one a developer never runs.
 *
 * The seed is upsert-based (`createMany({ skipDuplicates: true })` for the
 * permission catalogue, `upsert` for everything else), so running it twice
 * changes nothing the first run did not already do.
 *
 * `--reset` drops the database first, so the seed rebuilds from empty.
 *
 * ── What it refuses ─────────────────────────────────────────────────────────
 *
 * It fails closed on anything that is not loopback, and on a database name that
 * does not look like a test database. Preparing a database is destructive
 * enough — it applies migrations — that pointing it at the wrong host must be
 * impossible rather than merely unlikely.
 *
 * Destructive reset is deliberately NOT here. `db:test:reset` is a separate,
 * separately named command, because a developer who types "prepare" has not
 * asked to lose anything.
 *
 * No dependency, and no URL or credential is ever printed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const RESET = process.argv.includes('--reset');
const ENV_FILE = '.env.test';

/** Zero-dependency `KEY=value` read. Values are never logged. */
function readEnvFile(file) {
  if (!existsSync(file)) return null;
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return out;
}

function die(message) {
  process.stderr.write(`prepare-test-db: ${message}\n`);
  process.exit(1);
}

const env = readEnvFile(ENV_FILE);
if (!env) die(`${ENV_FILE} not found. Run \`node scripts/generate-secrets.mjs\` first.`);

const migrationUrl = env.MIGRATION_DATABASE_URL || env.DATABASE_URL;
if (!migrationUrl) die(`${ENV_FILE} declares neither MIGRATION_DATABASE_URL nor DATABASE_URL.`);

let parsed;
try {
  parsed = new URL(migrationUrl);
} catch {
  die(`the migration URL in ${ENV_FILE} is not a valid URL.`);
}

// ── Fail closed ─────────────────────────────────────────────────────────────
//
// Loopback only. A hostname is not trusted to be local because it contains
// "local"; only these three literals are accepted.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

if (!LOOPBACK.has(parsed.hostname)) {
  die(`refusing to act on a non-loopback host (${parsed.hostname}). This command is local-only.`);
}
if (!/test/i.test(database)) {
  die(`refusing to act on "${database}": the database name must identify it as a test database.`);
}
for (const marker of ['prod', 'staging', 'stage', 'live']) {
  if (database.toLowerCase().includes(marker)) {
    die(`refusing to act on "${database}": the name looks like a deployed environment.`);
  }
}

// `postgres`, not the target database, so CREATE and DROP are not run from
// inside the thing being created or dropped. Prisma URLs carry `?schema=`,
// which psql rejects as an unknown URI parameter, so the query is dropped.
const adminUrl = new URL(migrationUrl);
adminUrl.pathname = '/postgres';
adminUrl.search = '';

function psql(url, sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'master-saas-postgres-1', 'psql', url.toString(), '-tAc', sql],
    { encoding: 'utf8', shell: false },
  ).trim();
}

/**
 * The Prisma CLI is invoked through Node directly rather than through `npx`.
 *
 * Node refuses to spawn a `.cmd` with `shell: false` (EINVAL), and `npx` is
 * `npx.cmd` on Windows — so the obvious call fails on exactly the platform this
 * script exists to make work. Reaching for `shell: true` instead would put a
 * command line through a shell parser, which is not worth it for a fixed
 * argument array.
 */
const PRISMA_CLI = 'node_modules/prisma/build/index.js';

function prisma(args) {
  if (!existsSync(PRISMA_CLI)) die('the Prisma CLI is not installed. Run `npm install` first.');
  execFileSync(process.execPath, [PRISMA_CLI, ...args], {
    encoding: 'utf8',
    shell: false,
    stdio: 'inherit',
    env: { ...process.env, MIGRATION_DATABASE_URL: migrationUrl, DATABASE_URL: env.DATABASE_URL ?? migrationUrl },
  });
}

/**
 * The demo seed, pointed at the test database.
 *
 * `npm run db:seed` on its own would be wrong here: the seed loads `.env`
 * through `dotenv/config`, and `.env` names the *development* database. Run
 * after `db:test:prepare` it would migrate one database and seed another,
 * silently. dotenv does not overwrite a variable that is already set, so
 * passing `.env.test`'s own values in the child environment is what makes the
 * target unambiguous.
 *
 * `ALLOW_DEMO_SEED` is the seed's third gate and must be answered explicitly
 * every time. It is answered here because the target has already been proven,
 * above, to be a loopback database whose name identifies it as a test database
 * and does not look like a deployed environment. The seed keeps its own two
 * other gates — NODE_ENV and APP_ENV — and this passes neither of them.
 *
 * `tsx` is invoked through Node for the same reason the Prisma CLI is: the
 * `.bin` entry is `tsx.cmd` on Windows, and Node refuses to spawn a `.cmd`
 * with `shell: false`.
 */
const TSX_CLI = 'node_modules/tsx/dist/cli.mjs';

function seed() {
  if (!existsSync(TSX_CLI)) die('tsx is not installed. Run `npm install` first.');
  process.stdout.write('prepare-test-db: seeding…\n');
  try {
    // Captured, not inherited. The seed finishes by printing a banner carrying
    // the demo password every seeded account shares, and this script says it
    // never prints a credential. On failure the output is still not echoed, for
    // the same reason the catch below surfaces only an error type: run
    // `npm run db:seed` directly to see it.
    execFileSync(process.execPath, [TSX_CLI, 'prisma/seed/index.ts'], {
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env, ALLOW_DEMO_SEED: 'yes' },
    });
  } catch (error) {
    die(
      `the seed failed (exit ${error?.status ?? 'unknown'}). Its output is not echoed because it ends by ` +
        `printing the demo password. Run it directly to see why: ALLOW_DEMO_SEED=yes npm run db:seed`,
    );
  }
  process.stdout.write(`prepare-test-db: seeded ${database}.\n`);
}

const quoted = `"${database.replace(/"/g, '""')}"`;

try {
  const exists = psql(adminUrl, `SELECT 1 FROM pg_database WHERE datname = '${database.replace(/'/g, "''")}'`) === '1';

  if (RESET) {
    if (!exists) {
      process.stdout.write(`prepare-test-db: ${database} does not exist; nothing to reset.\n`);
    } else {
      // Named explicitly so nobody reaches this by typing "prepare".
      process.stdout.write(`prepare-test-db: DROPPING ${database} (--reset)\n`);
      psql(adminUrl, `DROP DATABASE ${quoted} WITH (FORCE)`);
    }
    psql(adminUrl, `CREATE DATABASE ${quoted}`);
    process.stdout.write(`prepare-test-db: recreated ${database}\n`);
  } else if (exists) {
    process.stdout.write(`prepare-test-db: ${database} already exists; leaving its data alone.\n`);
  } else {
    psql(adminUrl, `CREATE DATABASE ${quoted}`);
    process.stdout.write(`prepare-test-db: created ${database}\n`);
  }

  // `migrate deploy` applies existing migrations only. It never generates one.
  prisma(['migrate', 'deploy']);

  // The baseline CI gates on. See "Why it seeds" above.
  seed();

  process.stdout.write(`prepare-test-db: ${database} is ready.\n`);
} catch (error) {
  // The message may embed a connection string, so only the type is surfaced.
  die(`preparation failed (${error?.constructor?.name ?? 'Error'}). Is the local Postgres container running? Try \`npm run docker:up\`.`);
}
