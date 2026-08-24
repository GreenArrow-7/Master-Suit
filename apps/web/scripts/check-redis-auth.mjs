#!/usr/bin/env node
/**
 * Redis has a password, everywhere, and the two places it is written agree.
 *
 * Redis carries queue payloads and cached actor permissions. It had no password
 * in any Compose file — contained by the bridge network on one host, and that
 * containment is the first assumption to break when anything moves to a second
 * machine. So `--requirepass` is set in every stack, including development,
 * because a path no environment exercises is a path nobody notices is broken.
 *
 * Two invariants, both of which fail silently otherwise:
 *
 *   1. Every Compose file that defines a `redis` service passes `--requirepass`,
 *      and every REDIS_URL carries a credential. A URL without one produces
 *      `NOAUTH Authentication required` at the first queue operation — which
 *      surfaces as jobs that never run, not as a configuration error.
 *
 *   2. In each env example, the password inside REDIS_URL matches
 *      REDIS_PASSWORD. They are separate because the container needs the bare
 *      password for `--requirepass` and the application needs the URL; rotating
 *      one and not the other is the obvious mistake, and its symptom is again
 *      NOAUTH at the first operation.
 *
 * `scripts/generate-secrets.mjs` derives the second from the first, so this is a
 * backstop against a hand edit rather than the only thing keeping them in step.
 *
 * Run:  node scripts/check-redis-auth.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const INFRA = 'infra';
const problems = [];
const fail = (msg) => problems.push(msg);

// ── 1. Compose ──────────────────────────────────────────────────────────────
const composeFiles = readdirSync(INFRA).filter((f) => /^docker-compose[.\w-]*\.yml$/.test(f));
if (composeFiles.length === 0) fail('no Compose files found in infra/ — this check would pass vacuously.');

let sawRedisService = false;
for (const file of composeFiles) {
  const body = readFileSync(join(INFRA, file), 'utf8');

  // The `redis:` service block, up to the next top-level service key. Sliced
  // rather than matched with a lazy `(?:.*\n)*?`, which runs past the end of one
  // service into the next and finds a sibling's setting.
  const start = body.indexOf('\n  redis:\n');
  if (start >= 0) {
    const rest = body.slice(start + 1);
    const next = rest.slice(1).search(/\n {0,2}\S/);
    const block = next < 0 ? rest : rest.slice(0, next + 1);
    // Only the file that *defines* the service needs the flag; the overlays
    // override ports and environment on top of it.
    if (block.includes('image:')) {
      sawRedisService = true;
      if (!block.includes('--requirepass')) {
        fail(`${file} defines the redis service without --requirepass.`);
      }
    }
  }

  // To end of line, not `\S+`: a `${VAR:?message}` default contains spaces, and
  // a non-greedy token match truncates the URL mid-interpolation and then reports
  // the truncation as a missing credential.
  for (const [, url] of body.matchAll(/REDIS_URL:\s*(.+)$/gm)) {
    if (!url.includes('@')) {
      fail(`${file} sets REDIS_URL to ${url}, which carries no credential — every queue operation would fail NOAUTH.`);
    }
  }
}
if (!sawRedisService)
  fail('no Compose file defines a redis service — the --requirepass check found nothing to assert on.');

// ── 2. Env examples ─────────────────────────────────────────────────────────
const envFiles = ['.env.example', '.env.test.example', '.env.production.example', '.env.staging.example'];
let checkedPairs = 0;

for (const file of envFiles) {
  if (!existsSync(file)) {
    fail(`${file} does not exist.`);
    continue;
  }
  const body = readFileSync(file, 'utf8');
  const password = /^REDIS_PASSWORD=(.*)$/m.exec(body)?.[1]?.trim();
  const url = /^REDIS_URL=(.*)$/m.exec(body)?.[1]?.trim();

  if (password === undefined) {
    fail(`${file} declares no REDIS_PASSWORD.`);
    continue;
  }
  if (!url) {
    fail(`${file} declares no REDIS_URL.`);
    continue;
  }

  // A deployment example ships both empty for the operator to generate; a
  // development one ships both filled with the well-known default. Half-filled
  // is the state that breaks.
  if (!password) {
    if (url.includes('@')) fail(`${file} has an empty REDIS_PASSWORD but a REDIS_URL carrying a credential.`);
    continue;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`${file}: REDIS_URL is not a valid URL.`);
    continue;
  }
  // `URL` percent-encodes on the way in, so compare decoded.
  const inUrl = decodeURIComponent(parsed.password);
  if (inUrl !== password) {
    // Never print either value: one of them is a real credential in a deployment
    // file somebody copied from this example.
    fail(
      `${file}: the password in REDIS_URL does not match REDIS_PASSWORD. Run \`node scripts/generate-secrets.mjs ${file.replace('.example', '')}\`.`,
    );
  }
  checkedPairs += 1;
}

if (problems.length > 0) {
  console.error('redis auth:\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}

console.log(
  `redis auth: ok — ${composeFiles.length} Compose files require a password, ${checkedPairs} env example(s) agree with their URL.`,
);
