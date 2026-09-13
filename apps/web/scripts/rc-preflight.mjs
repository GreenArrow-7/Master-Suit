/**
 * Read-only production preflight for the next-follow-up release.
 *
 * Run by the production operator, against production, **before** the migration.
 * It answers the questions this release cannot answer from an isolated
 * environment: how big the tables are, whether any row would fail the new
 * foreign key, and how much the derived column is about to change.
 *
 *   node scripts/rc-preflight.mjs
 *
 * ── What it does and does not do ────────────────────────────────────────────
 *
 * Every statement is a SELECT. It creates nothing, changes nothing and deletes
 * nothing — in particular it does **not** repair the orphaned rows it reports.
 * Whether to detach them is a decision for whoever owns the data, and the
 * migration makes it explicitly and reversibly; a preflight that quietly tidied
 * up first would take that decision away and hide the evidence.
 *
 * Output is counts and durations only. No lead name, phone number, email,
 * employee record or connection string is read or printed, so the output can be
 * pasted into a ticket.
 *
 * Needs a role that can SELECT across tenants — the owning/migration role, the
 * same one `prisma migrate deploy` uses. It does not need write access.
 */
import { openAudit } from './rc-readonly.mjs';

const { rows: all, done } = await openAudit('Release preflight');

const one = async (sql, params = []) => (await all(sql, params))[0];

const line = (label, value, note = '') =>
  console.log(`  ${String(label).padEnd(38)} ${String(value).padStart(10)}  ${note}`);
const head = (t) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);

// ── 1. Where the schema currently is ────────────────────────────────────────
head('1. Applied migrations');
const applied = await all(
  `SELECT "migration_name", "finished_at" FROM "_prisma_migrations"
    WHERE "finished_at" IS NOT NULL ORDER BY "finished_at" DESC LIMIT 5`,
);
for (const r of applied) console.log(`  ${r.migration_name}`);
const pending = [
  '20260910190000_lead_triage_queue',
  '20260911100000_triage_idempotency_and_outbox',
  '20260911150000_follow_up_lead_relation',
  '20260911150500_follow_up_lead_relation_validate',
  '20260912020000_booking_unit_exclusivity',
  '20260912020500_booking_unit_exclusivity_validate',
  '20260912100000_agency_fee_receipts',
  '20260912200000_fee_amendments_recovery_workflow',
];
const allApplied = await all(`SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL`);
const appliedAll = new Set(allApplied.map((r) => r.migration_name));
head('   Of this release, still to apply');
for (const m of pending) console.log(`  ${appliedAll.has(m) ? 'applied ' : 'PENDING '} ${m}`);

// A migration that started and never finished blocks `migrate deploy`.
const failed = await one(
  `SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL`,
);
line('unfinished migration rows', failed.n, failed.n ? '!! resolve before deploying' : '');

// ── 2. Size, for the lock windows ───────────────────────────────────────────
head('2. Table sizes — these set how long the migration holds its locks');
for (const t of ['Lead', 'Task', 'FollowUpTask']) {
  const r = await one(`SELECT count(*)::bigint AS n FROM "${t}"`);
  const s = await one(`SELECT pg_size_pretty(pg_total_relation_size(quote_ident($1)::regclass)) AS sz`, [t]);
  line(`${t} rows`, r.n, s.sz);
}
console.log(`
  The foreign key is added NOT VALID (brief ACCESS EXCLUSIVE, no scan) and
  validated by a second migration under SHARE UPDATE EXCLUSIVE, which does not
  block writes. The two CREATE INDEX statements are NOT concurrent and take a
  SHARE lock on Task and FollowUpTask for the build: writes to those two tables
  wait, reads do not. Judge that against the FollowUpTask/Task sizes above.`);

// ── 3. Would the new foreign key hold? ──────────────────────────────────────
head('3. FollowUpTask -> Lead, the relation this release adds');
const fkExists = await one(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'FollowUpTask_leadId_fkey'`);
line('constraint already present', fkExists.n ? 'yes' : 'no');

const orphans = await one(
  `SELECT count(*)::bigint AS n FROM "FollowUpTask" f
    WHERE f."leadId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "Lead" l WHERE l."id" = f."leadId")`,
);
line('orphaned leadId references', orphans.n, orphans.n > 0 ? 'the migration DETACHES these (sets NULL)' : '');

const orphansByTenant = await all(
  `SELECT f."tenantId", count(*)::bigint AS n FROM "FollowUpTask" f
    WHERE f."leadId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "Lead" l WHERE l."id" = f."leadId")
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
);
for (const r of orphansByTenant) line(`  orphans in workspace ...${String(r.tenantId).slice(-6)}`, r.n);

// A follow-up whose lead belongs to a *different* workspace would be a tenancy
// fault the foreign key cannot see — it only checks that the id resolves.
const crossTenant = await one(
  `SELECT count(*)::bigint AS n FROM "FollowUpTask" f
     JOIN "Lead" l ON l."id" = f."leadId"
    WHERE l."tenantId" <> f."tenantId"`,
);
line('cross-workspace references', crossTenant.n, crossTenant.n > 0 ? '!! investigate before deploying' : '');

const nullLead = await one(`SELECT count(*)::bigint AS n FROM "FollowUpTask" WHERE "leadId" IS NULL`);
line('already detached (leadId IS NULL)', nullLead.n, 'unaffected');

console.log(`
  Deletion behaviour: ON DELETE CASCADE ON UPDATE CASCADE, matching Task.leadId,
  which has cascaded since it was introduced. After this release, deleting a Lead
  removes its follow-ups instead of leaving them pointing at an id that no longer
  resolves. Soft delete (deletedAt) is unaffected — it is not a row deletion.`);

// ── 4. How much will the derived column move? ───────────────────────────────
head('4. Lead.nextFollowUpAt — what the backfill will change');
const drift = await one(`
  WITH cmp AS (
    SELECT l."nextFollowUpAt" AS stored,
           (SELECT MIN(d."dueAt") FROM (
              SELECT t."dueAt" FROM "Task" t
               WHERE t."tenantId" = l."tenantId" AND t."leadId" = l."id"
                 AND t."deletedAt" IS NULL AND t."status" IN ('OPEN','IN_PROGRESS','RESCHEDULED')
              UNION ALL
              SELECT f."dueAt" FROM "FollowUpTask" f
               WHERE f."tenantId" = l."tenantId" AND f."leadId" = l."id"
                 AND f."deletedAt" IS NULL AND f."status" IN ('OPEN','IN_PROGRESS','RESCHEDULED')
           ) d) AS derived
      FROM "Lead" l WHERE l."deletedAt" IS NULL
  )
  SELECT count(*)::bigint AS leads,
         count(*) FILTER (WHERE stored IS NOT DISTINCT FROM derived)::bigint AS agreeing,
         count(*) FILTER (WHERE stored IS NULL AND derived IS NOT NULL)::bigint AS missing,
         count(*) FILTER (WHERE stored IS NOT NULL AND derived IS NOT NULL AND stored <> derived)::bigint AS stale,
         count(*) FILTER (WHERE stored IS NOT NULL AND derived IS NULL)::bigint AS unexpected
    FROM cmp`);
line('live leads', drift.leads);
line('already correct', drift.agreeing);
line('work no overdue screen can see', drift.missing, 'stored NULL, obligation open');
line('showing the wrong date', drift.stale);
line('showing a date with nothing open', drift.unexpected);
console.log(`
  Expect "missing" to be large: nothing has ever written this column, so it holds
  whatever the original seed left. The backfill is a separate, resumable step
  after the migration — see the runbook — and the screens derive per request, so
  they are correct before it runs.`);

// ── 5. Automation rules that would now be refused ───────────────────────────
head('5. Automation rules affected by the protected-field guard');
const versions = await one(`SELECT count(*)::int AS n FROM "AutomationVersion"`);
line('automation versions', versions.n);
const graphs = await all(`SELECT "graph"::text AS g FROM "AutomationVersion"`);
let protectedWrites = 0;
const seen = new Map();
for (const { g } of graphs) {
  for (const m of (g ?? '').matchAll(/"action"\s*:\s*"update_field"[\s\S]{0,200}?"field"\s*:\s*"([^"]+)"/g)) {
    seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
    if (m[1] === 'nextFollowUpAt') protectedWrites += 1;
  }
}
for (const [f, n] of seen)
  line(`  update_field -> ${f}`, n, f === 'nextFollowUpAt' ? '!! will be REFUSED' : 'unaffected');
if (seen.size === 0) line('  update_field targets', 0, 'no rule writes any field');
line('rules that will start failing', protectedWrites, protectedWrites ? '!! rewrite before deploying' : '');

// ── 6. Saved views built on the withdrawn filter ────────────────────────────
head('6. Saved views referencing the withdrawn nextFollowUpAt filter');
// Four models carry a filterTree. A view built on the withdrawn field does not
// break — the Smart Views screen translates the old "overdue" shape and lists
// anything else unfiltered behind an explicit notice — but the operator should
// know how many people will see that notice on the first morning.
for (const table of ['SmartView', 'SavedFilter', 'DashboardWidget', 'Report']) {
  // An absent table reads as n/a; any other error stops the script instead of hiding behind n/a.
  const exists = (await one('SELECT to_regclass($1) IS NOT NULL AS ok', [`"${table}"`])).ok;
  const r = exists
    ? await one(`SELECT count(*)::int AS n FROM "${table}" WHERE "filterTree"::text LIKE '%nextFollowUpAt%'`)
    : null;
  line(`  ${table}`, r ? r.n : 'n/a', r && r.n ? 'will show the compatibility notice' : '');
}

console.log('\npreflight complete — nothing was written.');
await done();
