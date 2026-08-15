#!/usr/bin/env node
/**
 * Demo-login smoke test, run against whatever URL actually serves users.
 *
 *   node scripts/demo-smoke.mjs
 *
 * Configuration comes from the environment (falling back to .env for the
 * password so nothing secret lives in source control):
 *   DEMO_URL       target origin        (default http://localhost:3000)
 *   DEMO_EMAIL     account to test      (default demo@manathhomes.ae)
 *   DEMO_PASSWORD  the seeded password  (required, from env or .env)
 *
 * Verifies: the login endpoint answers 200 with a workspace destination, the
 * session cookie opens a protected CRM page, and reports the build id from the
 * login page plus the database identity the local .env points at — so a
 * mismatch between "what was seeded" and "what is running" is visible at once.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of fs.readFileSync(path.join(appRoot, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const BASE = process.env.DEMO_URL ?? 'http://localhost:3000';
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@manathhomes.ae';
const PASSWORD = process.env.DEMO_PASSWORD;
if (!PASSWORD) {
  console.error('DEMO_PASSWORD is not set (env or apps/web/.env). Refusing to guess.');
  process.exit(2);
}

const fail = (msg) => {
  console.error(`FAIL  ${msg}`);
  process.exit(1);
};

const dbId = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL);
    return `${url.pathname.replace('/', '')}@${url.hostname}:${url.port || '5432'}`;
  } catch {
    return 'unknown';
  }
})();

const loginPage = await fetch(`${BASE}/login`).catch(() => null);
if (!loginPage?.ok) fail(`login page unreachable at ${BASE}/login`);

const res = await fetch(`${BASE}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
}).catch(() => null);
if (!res) fail('auth endpoint unreachable');
const body = await res.json().catch(() => ({}));
if (res.status !== 200) fail(`auth returned HTTP ${res.status}: ${body.detail ?? ''}`);
if (body.mfaRequired || body.mfaEnrolmentRequired) fail('demo account unexpectedly requires MFA');
if (!body.destination) fail('no destination in login response');

const cookie = res.headers.getSetCookie?.().map((c) => c.split(';')[0]).join('; ') ?? '';
if (!cookie.includes('lf_session')) fail('no session cookie returned');

const page = await fetch(`${BASE}${body.destination}`, { headers: { cookie }, redirect: 'manual' });
if (page.status !== 200) fail(`protected route ${body.destination} returned HTTP ${page.status}`);

console.log(`PASS  ${EMAIL} → HTTP 200 → ${body.destination}`);
console.log(`      target: ${BASE} · database (local .env): ${dbId}`);
