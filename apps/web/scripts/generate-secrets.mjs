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

/** Only files whose .example exists; `.env.test` is optional in a deployment. */
const TARGETS = ['.env', '.env.test'].filter((file) => existsSync(file) || existsSync(`${file}.example`));

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
