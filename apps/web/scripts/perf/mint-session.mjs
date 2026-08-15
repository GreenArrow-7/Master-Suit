#!/usr/bin/env node
/**
 * Mint one real session for the perf tenant: give a single synthetic user a
 * known password, sign in through the real login API, print the cookie.
 *
 *   PERF_DATABASE_URL=... BASE=http://localhost:3200 node scripts/perf/mint-session.mjs
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..');
const require = createRequire(path.join(appRoot, 'package.json'));
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const { hash } = require('@node-rs/argon2');

const url = process.env.PERF_DATABASE_URL;
const BASE = process.env.BASE ?? 'http://localhost:3200';
if (!url || !/perf/i.test(new URL(url).pathname)) {
  console.error('PERF_DATABASE_URL must point at the performance database.');
  process.exit(1);
}

const email = 'perf.user.000042@perf-titan.test';
const password = `Mint-${randomBytes(9).toString('base64url')}`;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
await db.platformUser.update({
  where: { normalizedEmail: email },
  data: { passwordHash: await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }), passwordChangedAt: new Date() },
});
await db.$disconnect();

const res = await fetch(`${BASE}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!res.ok) {
  console.error(`Login failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const cookie = res.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .find((c) => c.startsWith('lf_session='));
console.log(cookie);
