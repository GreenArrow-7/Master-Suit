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

// METRICS_TOKEN is here rather than left to the operator for the same reason
// the other two are: a secret nobody generates is a secret somebody types, and
// an unset one silently 404s the scrape endpoint rather than failing loudly.
//
// REDIS_PASSWORD is `base64url` rather than `base64`, and that is load-bearing:
// it is embedded in REDIS_URL as userinfo, and `+`, `/` and `=` are not valid
// there unescaped. A base64 password produces a URL that `lib/env.ts` rejects at
// boot — or worse, one that parses and truncates.
const KEYS = [
  { name: 'FIELD_ENCRYPTION_KEY', encoding: 'base64' },
  { name: 'WEBHOOK_SIGNING_PEPPER', encoding: 'base64' },
  { name: 'METRICS_TOKEN', encoding: 'base64' },
  { name: 'REDIS_PASSWORD', encoding: 'base64url' },
];

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
const FORCE = process.argv.includes('--force');
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

  for (const { name: key, encoding } of KEYS) {
    const current = new RegExp(`^${key}=(.*)$`, 'm').exec(env)?.[1]?.trim() ?? '';

    /**
     * A real value is left alone unless --force.
     *
     * This used to overwrite unconditionally, which quietly re-keyed an existing
     * environment: FIELD_ENCRYPTION_KEY seals authenticator secrets, so running
     * `npm run secrets` on a working checkout orphaned every enrolled second
     * factor with no warning. Setting up is not the same operation as rotating —
     * rotating is scripts/rotate-field-encryption-key.mjs, which re-wraps first.
     */
    const isPlaceholder = !current || /^CHANGE_ME/i.test(current);
    if (!isPlaceholder && !FORCE) {
      console.log(`  ${target}: ${key} already set — left alone (use --force to replace)`);
      continue;
    }

    // 32 bytes. lib/env.ts decodes and measures the bytes, so a shorter value is
    // rejected at boot rather than accepted.
    const secret = randomBytes(32).toString(encoding);
    const line = `${key}=${secret}`;
    env = new RegExp(`^${key}=.*$`, 'm').test(env)
      ? env.replace(new RegExp(`^${key}=.*$`, 'm'), line)
      : `${env.trimEnd()}\n${line}\n`;
    console.log(`  ${target}: ${key} set (${secret.length} chars)`);
    wrote += 1;
  }

  /**
   * REDIS_URL carries the password as userinfo, so the two would drift the
   * moment either is rotated — and the symptom is a NOAUTH error at the first
   * queue operation, nowhere near the file that caused it. Derive one from the
   * other instead of asking anybody to keep them in step.
   *
   * The URL keeps its own host, port and database number; only the credential
   * is replaced. `redis://localhost:6379/15` stays on database 15.
   */
  const password = new RegExp('^REDIS_PASSWORD=(.*)$', 'm').exec(env)?.[1]?.trim() ?? '';
  const redisUrl = new RegExp('^REDIS_URL=(.*)$', 'm').exec(env)?.[1]?.trim() ?? '';
  if (password && redisUrl) {
    let rewritten = redisUrl;
    try {
      const parsed = new URL(redisUrl);
      parsed.username = '';
      parsed.password = password;
      rewritten = parsed.toString();
    } catch {
      console.log(`  ${target}: REDIS_URL is not a URL — left alone`);
    }
    if (rewritten !== redisUrl) {
      env = env.replace(new RegExp('^REDIS_URL=.*$', 'm'), `REDIS_URL=${rewritten}`);
      console.log(`  ${target}: REDIS_URL credential set from REDIS_PASSWORD`);
    }
  }

  writeFileSync(target, env);
}

console.log(`\nWrote ${wrote} secrets across ${TARGETS.length} file(s): ${TARGETS.join(', ')}`);
