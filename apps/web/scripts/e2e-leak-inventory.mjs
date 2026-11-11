#!/usr/bin/env node
/**
 * What the end-to-end suite left behind in a workspace it was pointed at.
 *
 * **Read-only. It deletes nothing and has no --apply.** That is deliberate: the
 * rows are in a workspace somebody uses, and the first thing to produce is an
 * exact list, not a sweep.
 *
 * ── The leak ────────────────────────────────────────────────────────────────
 *
 * Three browser specs — business-journey, record-scope and daily-target-workflow
 * — sign in to the workspace `E2E_DEMO_SLUG` names and create roles, accounts,
 * employees, leads, a work location and an opportunity inside it. Until
 * 2026-11-09 they tagged what they created with their own
 * `Date.now().toString(36)` rather than the suite's run marker, and
 * `globalTeardown` deletes tenants whose slug ends with the marker. That
 * workspace is not one of them, so it survived every run and its rows
 * accumulated — one set per run. The field report of 9 November was a Role
 * picker showing "Journey Rep mu8vfn6x" and a Reporting-manager picker showing
 * accounts from runs nobody remembers.
 *
 * The specs now tag with `RUN_TAG` and the teardown removes it, so no new rows
 * are left. This is for the ones already there.
 *
 * ── How a row is identified ─────────────────────────────────────────────────
 *
 * By the **generator**, never by "looks like a test". Each pattern below is the
 * literal template from the spec that produced it, with `<run>` replaced by the
 * shape `Date.now().toString(36)` actually produces: 8 lowercase base-36
 * characters. `Seller 3` and `Journey Rep (Dubai)` do not match; only
 * `Seller mu8vfn6x` does.
 *
 * A row that does not match stays out of the list. A list that is slightly
 * short is recoverable; one that names a customer's own role is not.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   node scripts/e2e-leak-inventory.mjs --slug <workspace-slug>
 *   node scripts/e2e-leak-inventory.mjs --slug <slug> --json > inventory.json
 *
 * Reads DATABASE_URL from the environment the same way every other script here
 * does. Point it at a replica or a restored backup if you would rather not read
 * production directly — nothing it does depends on being live.
 */
import './env.mjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const slug = flag('slug');
const asJson = argv.includes('--json');

if (!slug) {
  console.error('Usage: node scripts/e2e-leak-inventory.mjs --slug <workspace-slug> [--json]');
  console.error('The slug is whatever E2E_DEMO_SLUG named when the suite was run.');
  process.exit(2);
}

/** `Date.now().toString(36)` — 8 lowercase base-36 characters for any date this decade. */
const RUN = '[0-9a-z]{8}';

/**
 * Every artefact the three specs created, as the template that made it.
 *
 * `prefix` is the literal text before the run tag and is what the **database**
 * filters on, so this never reads a whole lead table; `pattern` is anchored at
 * both ends and decides, in this process, whether a narrowed row really
 * matches. Both are needed: the prefix alone would take `Journey Lead of the
 * Year`, and the regex alone would cost a table scan.
 */
const PATTERNS = [
  // business-journey.spec.ts
  { spec: 'business-journey', model: 'role', column: 'key', pattern: `^seller_${RUN}$` },
  { spec: 'business-journey', model: 'role', column: 'key', pattern: `^journey_rep_${RUN}$` },
  { spec: 'business-journey', model: 'hrWorkLocation', column: 'name', pattern: `^Journey HQ ${RUN}$` },
  { spec: 'business-journey', model: 'user', column: 'email', pattern: `^journey-rep-${RUN}@example\\.com$` },
  { spec: 'business-journey', model: 'employeeProfile', column: 'employeeNumber', pattern: `^JR-${RUN}$` },
  { spec: 'business-journey', model: 'lead', column: 'fullName', pattern: `^Journey Lead ${RUN}-[0-9]+$` },
  { spec: 'business-journey', model: 'opportunity', column: 'name', pattern: `^Journey deal ${RUN}$` },

  // record-scope.spec.ts
  { spec: 'record-scope', model: 'role', column: 'key', pattern: `^scope_${RUN}$` },
  { spec: 'record-scope', model: 'user', column: 'email', pattern: `^scope-[a-z0-9]+-${RUN}@example\\.com$` },
  { spec: 'record-scope', model: 'employeeProfile', column: 'employeeNumber', pattern: `^SC-[a-z0-9]+-${RUN}$` },
  { spec: 'record-scope', model: 'lead', column: 'fullName', pattern: `^Scope Lead ${RUN}$` },

  // daily-target-workflow.spec.ts
  { spec: 'daily-target-workflow', model: 'user', column: 'email', pattern: `^dtw-${RUN}@example\\.com$` },
  { spec: 'daily-target-workflow', model: 'employeeProfile', column: 'employeeNumber', pattern: `^DTW-${RUN}$` },
  { spec: 'daily-target-workflow', model: 'lead', column: 'fullName', pattern: `^Daily WF Lead ${RUN}-[0-9]+$` },
];

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const tenant = await prisma.tenant.findUnique({
  where: { slug },
  select: { id: true, displayName: true, status: true },
});
if (!tenant) {
  console.error(`No workspace with slug "${slug}".`);
  process.exit(1);
}

const findings = [];
for (const { spec, model, column, prefix, pattern } of PATTERNS) {
  const rows = await prisma[model].findMany({
    where: { tenantId: tenant.id, [column]: { startsWith: prefix } },
    select: { id: true, [column]: true, createdAt: true },
  });
  const re = new RegExp(pattern);
  for (const row of rows) {
    const value = row[column];
    if (typeof value === 'string' && re.test(value)) {
      findings.push({ spec, model, column, value, id: row.id, createdAt: row.createdAt ?? null });
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({ workspace: { slug, ...tenant }, findings }, null, 2));
} else {
  console.log(`\nWorkspace  ${tenant.displayName} (${slug}) — ${tenant.status}`);
  console.log(`Matched    ${findings.length} row(s) created by the end-to-end suite\n`);

  const byModel = new Map();
  for (const f of findings) byModel.set(f.model, [...(byModel.get(f.model) ?? []), f]);
  for (const [model, rows] of [...byModel].sort()) {
    console.log(`  ${model} (${rows.length})`);
    for (const row of rows.sort((a, b) => a.value.localeCompare(b.value))) {
      const when = row.createdAt ? new Date(row.createdAt).toISOString().slice(0, 10) : '          ';
      console.log(`    ${when}  ${row.value.padEnd(44)} ${row.id}  [${row.spec}]`);
    }
    console.log('');
  }

  if (findings.length) {
    console.log('Nothing has been deleted. Read the list, confirm every row is one of');
    console.log('yours to remove, and delete by the ids above — not by re-running a match.');
    console.log('A role still granted to somebody needs that grant moved first.\n');
  }
}

await prisma.$disconnect();
