#!/usr/bin/env node
/**
 * Load scenarios against a running production build, driven by autocannon.
 *
 * Usage (server already running against the perf database):
 *   BASE=http://localhost:3200 node scripts/perf/run-load.mjs [--connections 50] [--duration 30]
 *
 * The password for the synthetic users is not stored anywhere; the login-burst
 * scenario measures the argon2 + session path with deliberately WRONG
 * passwords, which costs the server the same verify work (the timing-equalised
 * failure path burns a full hash) without ever minting 10 000 sessions.
 * Authenticated reads use a handful of real sessions minted for the demo-shape
 * personas seeded into the perf tenant by scripts/perf/mint-sessions.mjs — or,
 * simpler, PERF_COOKIE with a session minted by hand.
 *
 * Scenarios (docs/PERFORMANCE-REPORT.md maps them to the load model):
 *   ready       readiness endpoint — the transport + framework floor
 *   lead-list   first page of 100k leads, keyset order        (authenticated)
 *   lead-page5  5th page via cursor                           (authenticated)
 *   search      server-side ?q= over 100k rows                (authenticated)
 *   dashboard   the role-scoped dashboard SSR                 (authenticated)
 *   login-burst hundreds of credential verifications
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..');
const require = createRequire(path.join(appRoot, 'package.json'));
const autocannon = require('autocannon');

const BASE = process.env.BASE ?? 'http://localhost:3200';
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
};
const CONNECTIONS = arg('connections', 50);
const DURATION = arg('duration', 30);

const cookie = process.env.PERF_COOKIE;
if (!cookie) {
  console.error('Set PERF_COOKIE to a valid lf_session cookie for the perf tenant (mint one via the login API).');
  process.exit(1);
}

const run = (title, opts) =>
  new Promise((resolve, reject) => {
    autocannon({ url: BASE, connections: CONNECTIONS, duration: DURATION, ...opts }, (err, result) => {
      if (err) return reject(err);
      const r = {
        scenario: title,
        rps: result.requests.average,
        p50: result.latency.p50,
        p95: result.latency.p97_5 ?? result.latency.p95,
        p99: result.latency.p99,
        non2xx: result.non2xx,
        errors: result.errors,
        timeouts: result.timeouts,
      };
      console.log(
        `${title.padEnd(12)} rps=${String(Math.round(r.rps)).padStart(6)}  p50=${String(r.p50).padStart(5)}ms  p95=${String(r.p95).padStart(5)}ms  p99=${String(r.p99).padStart(5)}ms  non2xx=${r.non2xx}  errors=${r.errors}`,
      );
      resolve(r);
    });
  });

const authed = { headers: { cookie } };
const results = [];

console.log(`Target ${BASE} · ${CONNECTIONS} connections · ${DURATION}s per scenario\n`);

results.push(await run('ready', { requests: [{ path: '/api/health' }] }));
results.push(await run('lead-list', { requests: [{ path: '/api/v1/leads?limit=50', ...authed }] }));

// Walk to the 5th page once, then hammer that cursor: deep keyset pages must
// cost the same as page one — that is the whole argument for keyset over offset.
{
  let cursorPath = '/api/v1/leads?limit=50';
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(`${BASE}${cursorPath}`, { headers: { cookie } });
    const body = await res.json();
    if (!body.nextCursor) break;
    cursorPath = `/api/v1/leads?limit=50&cursor=${encodeURIComponent(body.nextCursor)}`;
  }
  results.push(await run('lead-page5', { requests: [{ path: cursorPath, ...authed }] }));
}

results.push(await run('search', { requests: [{ path: '/api/v1/leads?limit=50&q=PERF+Lead+0421', ...authed }] }));
results.push(await run('dashboard', { requests: [{ path: '/perf-titan/dashboard', ...authed }] }));

// Login burst: full body-parse + rate-limit + argon2 verify per request. Wrong
// password on purpose — the timing-equalised failure path costs the server the
// same hash work, and no session rows pile up. Rate limiting answers 429 for
// most of the burst; that is the *correct* behaviour under a credential storm,
// so 401+429 both count as handled.
results.push(
  await run('login-burst', {
    connections: Math.min(CONNECTIONS, 30),
    duration: Math.min(DURATION, 15),
    requests: [
      {
        method: 'POST',
        path: '/api/v1/auth/login',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'perf.user.000001@perf-titan.test', password: 'not-the-password-1234' }),
      },
    ],
  }),
);

console.log('\nJSON:');
console.log(JSON.stringify(results, null, 2));
