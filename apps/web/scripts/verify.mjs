/**
 * Run what CI runs, in the order CI runs it, before pushing.
 *
 * ── The failure this exists for ─────────────────────────────────────────────
 *
 * There is no single command for "is this pushable". There are fifteen gates in
 * `.github/workflows/ci.yml` and a developer is expected to remember them, so
 * what actually happens is that they remember the four they think of as "the
 * checks" — typecheck, lint, tests, and whichever gate they last saw fail — and
 * push. This has now cost a red build for `prettier --check` on two files that
 * had passed eslint five minutes earlier.
 *
 * `README.md` made it worse rather than better. It listed five commands and
 * said CI "runs all of these plus a schema-drift gate", which stopped being
 * true eight gates ago. A partial list that presents itself as complete is
 * worse than no list: the developer who runs all five believes they are done.
 *
 * ── Why it reads the workflow instead of listing the gates ──────────────────
 *
 * A hand-kept copy of CI's steps is the same defect one level up — it is
 * correct on the day it is written and silently stale afterwards, and the whole
 * point of this script is to be the thing you can trust without checking.
 *
 * So the steps come out of `ci.yml` itself, and the table below says only what
 * to do with each one. A gate added to CI tomorrow and not named here does not
 * get skipped quietly: this refuses to run at all and names it. Deciding a gate
 * cannot run locally is allowed; not noticing it is not.
 *
 *   node scripts/verify.mjs           every gate that can run here
 *   node scripts/verify.mjs --fast    without the two slowest
 *   node scripts/verify.mjs --list    the plan, run nothing
 *
 * Exit 0 all gates passed · 1 a gate failed · 2 the plan and CI disagree.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = path.resolve(root, '../../.github/workflows/ci.yml');

/**
 * What to do with each step CI runs, keyed by its `name:`.
 *
 * `run` executes CI's own command. `skip` states why it cannot or must not run
 * on a developer's machine — and every one of those reasons is about *this*
 * machine having something the runner does not, not about the gate being
 * unimportant. `slow` marks the two that `--fast` leaves out.
 */
const PLAN = {
  Redis: { skip: 'CI starts its own Redis container; yours is already running — `npm run docker:up`.' },
  Install: { skip: 'CI installs from a clean lockfile; your node_modules is already there.' },
  'Generate .env': {
    skip: 'Would overwrite your .env with fresh generated secrets. CI has no .env until this step; you do.',
  },
  'Export RLS connection': { skip: 'Done below, from your .env, by the same rule CI uses.' },
  'Apply migrations': {
    skip: 'Your database is already at head — and if it is not, "Schema drift" two lines down says so.',
  },
  'Schema drift': { run: true },
  'Tenant isolation': { run: true },
  'Raw SQL scope': { run: true },
  'Seed demo data': { skip: 'Creates dozens of demo logins. CI builds a database per run and throws it away.' },
  Typecheck: { run: true },
  Lint: { run: true },
  'Format check': { run: true },
  'README schema counts': { run: true },
  'Observability drift': { run: true },
  'Redis auth': { run: true },
  'Face token gate': { run: true },
  'Backup round trip': { run: true },
  Test: { run: true },
  'Integration (server)': { run: true, slow: true },
  'Playwright version': { skip: 'Reads a version into a CI output variable. Not a gate.' },
  'Install Playwright browser': { skip: 'Installs and caches Chromium on the runner.' },
  E2E: {
    skip: 'The slowest gate by a wide margin, and it needs a production build and a matching Chromium. Run `npm run test:e2e` when you have touched the browser paths.',
  },
  Build: { run: true, slow: true },
  Audit: { run: true },
};

/**
 * The `run:` steps of the `verify` job, in order.
 *
 * A deliberately small parser rather than a YAML dependency, with the step
 * count cross-checked below — a parser that quietly matched half the steps
 * would defeat the accounting this script exists to do.
 */
function stepsOf(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const steps = [];
  let inSteps = false;
  let current = null;
  let block = null;

  for (const line of lines) {
    if (/^ {2}verify:/.test(line)) inSteps = false;
    if (/^ {4}steps:/.test(line)) {
      inSteps = true;
      continue;
    }
    if (!inSteps) continue;
    // A top-level key at two spaces ends the job.
    if (/^ {2}\S/.test(line)) break;

    if (block !== null) {
      if (line.startsWith('          ') || line.trim() === '') {
        block.command.push(line.slice(10));
        continue;
      }
      block = null;
    }

    const named = /^ {6}- name:\s*(.+?)\s*$/.exec(line);
    if (named) {
      current = { name: named[1], command: null };
      steps.push(current);
      continue;
    }
    if (/^ {6}- /.test(line)) {
      current = null;
      continue;
    }

    const run = /^ {8}run:\s*(.*)$/.exec(line);
    if (run && current) {
      if (run[1] === '|' || run[1] === '>' || run[1] === '|-') {
        current.command = [];
        block = { command: current.command };
      } else {
        current.command = [run[1]];
      }
    }
  }

  const declared = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => /^ {6}- name:/.test(l)).length;
  if (steps.length !== declared) {
    console.error(
      `[verify] Parsed ${steps.length} named steps out of ${declared} in ci.yml. This script's parser is\n` +
        '  broken, and a plan built from half the workflow would report a clean run against gates it\n' +
        '  never saw. Fix stepsOf() before trusting it.',
    );
    process.exit(2);
  }

  return steps.filter((step) => step.command !== null);
}

const steps = stepsOf(workflow);

// ── The plan and CI must describe the same set of gates ─────────────────────
const unknown = steps.filter((step) => !PLAN[step.name]).map((step) => step.name);
const stale = Object.keys(PLAN).filter((name) => !steps.some((step) => step.name === name));
if (unknown.length > 0 || stale.length > 0) {
  console.error('[verify] This script and ci.yml disagree about which gates exist.\n');
  for (const name of unknown) {
    console.error(
      `  CI runs "${name}" and PLAN says nothing about it. Add it — either { run: true }, or\n` +
        `    { skip: 'why it cannot run on a developer machine' }. Skipping is a decision; missing it is not.\n`,
    );
  }
  for (const name of stale) {
    console.error(`  PLAN names "${name}" and ci.yml has no such step. It was renamed or removed.\n`);
  }
  process.exit(2);
}

const fast = process.argv.includes('--fast');
const listOnly = process.argv.includes('--list');

// CI derives this from .env rather than repeating it, and so does this: the two
// must name the same connection or the tenant suites throw rather than skip.
const env = { ...process.env };
if (!env.RLS_DATABASE_URL) {
  const line = readFileSync(path.join(root, '.env'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('DATABASE_URL='));
  if (!line) {
    console.error('[verify] No DATABASE_URL in apps/web/.env — run `npm run secrets` first.');
    process.exit(2);
  }
  env.RLS_DATABASE_URL = line.slice('DATABASE_URL='.length);
}
env.CI = 'true';
env.NODE_OPTIONS = env.NODE_OPTIONS ?? '--max-old-space-size=6144';

const plan = steps.map((step) => {
  const entry = PLAN[step.name];
  const skipped = entry.skip ?? (fast && entry.slow ? 'slow, and --fast was passed' : null);
  return { ...step, skipped };
});

if (listOnly) {
  for (const step of plan) {
    console.log(step.skipped ? `  skip  ${step.name}\n          ${step.skipped}` : `  run   ${step.name}`);
  }
  process.exit(0);
}

const started = Date.now();
let ran = 0;

for (const step of plan) {
  if (step.skipped) {
    console.log(`\x1b[2m  skip  ${step.name} — ${step.skipped}\x1b[0m`);
    continue;
  }
  const at = Date.now();
  process.stdout.write(`  run   ${step.name} … `);
  const result = spawnSync('bash', ['-eo', 'pipefail', '-c', step.command.join('\n')], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const took = ((Date.now() - at) / 1000).toFixed(1);

  if (result.status === 0) {
    ran += 1;
    console.log(`\x1b[32mok\x1b[0m ${took}s`);
    continue;
  }

  console.log(`\x1b[31mFAILED\x1b[0m ${took}s\n`);
  process.stdout.write(result.stdout?.toString() ?? '');
  process.stderr.write(result.stderr?.toString() ?? '');
  console.error(
    `\n[verify] "${step.name}" failed. This is the gate CI would have failed on — fix it and run\n` +
      '  this again rather than pushing to find out.',
  );
  process.exit(1);
}

const total = ((Date.now() - started) / 1000).toFixed(0);
console.log(`\n[verify] ${ran} gate(s) passed in ${total}s.`);
if (fast) console.log('[verify] --fast skipped the slow ones. CI runs them.');
