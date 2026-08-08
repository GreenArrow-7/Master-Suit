#!/usr/bin/env node
// Cross-platform replacement for `openssl rand -base64 32`. Rewrites the three
// secrets in an env file in place, creating it from its .example if missing.
//
// Handles `.env` and `.env.test`. Neither is tracked: `.env.test` used to be,
// with real secret values in it, so a fresh clone has to generate its own. The
// row-level-security suite refuses to run without `RLS_DATABASE_URL`, which only
// `.env.test` supplies, so without this a clean checkout could not run the tests
// at all.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';

const KEYS = ['SESSION_SECRET', 'FIELD_ENCRYPTION_KEY', 'WEBHOOK_SIGNING_PEPPER'];

/**
 * Which env files to write. Defaults to both; name them to narrow it.
 *
 *   node scripts/generate-secrets.mjs          # .env and .env.test
 *   node scripts/generate-secrets.mjs .env     # .env only
 *
 * CI passes `.env` deliberately. `.env.test` points DATABASE_URL at a separate
 * `master_saas_test` database that a developer creates with `npm run setup`, and
 * Vitest prefers `.env.test` over `.env` — so generating it on a runner that has
 * only one database sent every suite at a database that does not exist.
 */
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const TARGETS = (requested.length > 0 ? requested : ['.env', '.env.test']).filter(
  (file) => existsSync(file) || existsSync(`${file}.example`),
);

if (TARGETS.length === 0) {
  console.error(
    `No env file to write. Looked for: ${(requested.length > 0 ? requested : ['.env', '.env.test']).join(', ')}`,
  );
  process.exit(1);
}

let wrote = 0;

for (const target of TARGETS) {
  if (!existsSync(target)) {
    copyFileSync(`${target}.example`, target);
    console.log(`Created ${target} from ${target}.example`);
  }

  let env = readFileSync(target, 'utf8');

  for (const key of KEYS) {
    // 32 bytes, base64 — 44 characters. lib/env.ts decodes and measures the
    // bytes, so a shorter value is rejected at boot rather than accepted.
    const secret = randomBytes(32).toString('base64');
    const line = `${key}=${secret}`;
    env = new RegExp(`^${key}=.*$`, 'm').test(env)
      ? env.replace(new RegExp(`^${key}=.*$`, 'm'), line)
      : `${env.trimEnd()}\n${line}\n`;
    console.log(`  ${target}: ${key} set (${secret.length} chars)`);
    wrote += 1;
  }

  writeFileSync(target, env);
}

console.log(`\nWrote ${wrote} secrets across ${TARGETS.length} file(s): ${TARGETS.join(', ')}`);
