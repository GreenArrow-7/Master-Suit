#!/usr/bin/env node
/**
 * `npm audit` for production dependencies, with named exceptions that expire.
 *
 * It replaces a bare `npm audit --omit=dev --audit-level=high`. The threshold is
 * the same; what this adds is the ability to say "this one advisory, for this
 * reason, until this date" out loud, instead of the two alternatives a bare
 * audit leaves you: lower the bar for everything, or let one unfixable advisory
 * block every merge.
 *
 * An exception fails the build the day it expires, so it cannot be forgotten.
 */
import { execSync } from 'node:child_process';

/**
 * Advisories allowed through, each with the reason and the date it stops being
 * allowed. Keep this list short, and never add one without a mitigation.
 */
const ALLOWED = [
  {
    url: 'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5',
    package: 'zod',
    until: '2026-12-15',
    why:
      'Unbounded issue accumulation while validating a large failing array. ' +
      'zod patched it in 4.6.6 only; 3.25.76 is the last of the 3.x line, so ' +
      'there is nothing to upgrade to short of zod 4, which rewrites the ' +
      'internals our OpenAPI generator reads (245 files). Mitigated instead: ' +
      'route() refuses a body carrying more than 20,000 list entries before ' +
      'any schema runs (src/lib/api/handler.ts), which bounds the cost for ' +
      'every route. The zod 4 upgrade is scheduled separately.',
  },
];

const FAIL_FROM = new Set(['high', 'critical']);

/** npm exits non-zero whenever it finds anything, and still writes the report to stdout. */
function auditReport() {
  try {
    // One fixed command, no interpolation: `npm` resolves through the shell on
    // Windows too, where `npm.cmd` cannot be spawned directly (EINVAL).
    return execSync('npm audit --omit=dev --json', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    if (typeof err.stdout === 'string' && err.stdout.trim()) return err.stdout;
    throw err;
  }
}

const report = JSON.parse(auditReport());

const today = new Date().toISOString().slice(0, 10);
const blocking = [];
const allowed = [];

for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  if (!FAIL_FROM.has(vuln.severity)) continue;
  for (const via of vuln.via) {
    if (typeof via === 'string' || !FAIL_FROM.has(via.severity)) continue;
    const exception = ALLOWED.find((a) => a.url === via.url);
    if (!exception) blocking.push(`${name}: ${via.title} (${via.url})`);
    else if (exception.until < today)
      blocking.push(`${name}: the exception for ${via.url} expired on ${exception.until}`);
    else allowed.push(`${name}: ${via.url} — allowed until ${exception.until}`);
  }
}

for (const line of allowed) console.log(`[audit] allowed  ${line}`);
for (const line of blocking) console.error(`[audit] BLOCKING ${line}`);

if (blocking.length) {
  console.error(
    `\n[audit] ${blocking.length} advisor${blocking.length === 1 ? 'y' : 'ies'} at high or above with no live exception.` +
      '\n[audit] Fix it, or add a dated exception with its mitigation in scripts/audit-gate.mjs.',
  );
  process.exit(1);
}
console.log(`[audit] no unexcepted advisories at high or above (${allowed.length} allowed, all in date).`);
