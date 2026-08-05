#!/usr/bin/env node
// Cross-platform replacement for `openssl rand -base64 32`. Rewrites the three
// secrets in .env in place, creating it from .env.example if it is missing.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';

const KEYS = ['SESSION_SECRET', 'FIELD_ENCRYPTION_KEY', 'WEBHOOK_SIGNING_PEPPER'];

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Created .env from .env.example');
}

let env = readFileSync('.env', 'utf8');

for (const key of KEYS) {
  const secret = randomBytes(32).toString('base64');
  const line = `${key}=${secret}`;
  env = new RegExp(`^${key}=.*$`, 'm').test(env)
    ? env.replace(new RegExp(`^${key}=.*$`, 'm'), line)
    : `${env.trimEnd()}\n${line}\n`;
  console.log(`  ${key} set (${secret.length} chars)`);
}

writeFileSync('.env', env);
console.log('\nWrote 3 secrets to .env');
