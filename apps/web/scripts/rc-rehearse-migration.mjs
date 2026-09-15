/**
 * Rehearse the FollowUpTask -> Lead migration against data that would break it.
 *
 * The isolated databases have no orphaned rows, so applying the migration there
 * proves only that the SQL parses. Production may well have them — the column
 * has never had a foreign key, so nothing has ever stopped a lead being deleted
 * out from under a follow-up. This manufactures exactly that, plus the tenancy
 * fault a foreign key cannot catch, and runs the real migration statements over
 * it.
 *
 *   node scripts/rc-rehearse-migration.mjs
 *
 * Disposable databases only — it refuses anything without a marker in the name,
 * and it drops and re-adds the constraint, which is not a thing to do to a
 * customer's data.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const dbName = (url ?? '').split('/').pop()?.split('?')[0] ?? '';
if (!/_rehearse$|_nfu$|_test$/.test(dbName)) {
  console.error(`refusing to rehearse against "${dbName}": no disposable-database marker in the name`);
  process.exit(2);
}

const c = new pg.Client({ connectionString: url });
await c.connect();
const one = async (s, p = []) => (await c.query(s, p)).rows[0];
const n = (v) => Number(v ?? 0);

const MIG = path.join(root, 'prisma/migrations/20260911150000_follow_up_lead_relation/migration.sql');
const VAL = path.join(root, 'prisma/migrations/20260911150500_follow_up_lead_relation_validate/migration.sql');

console.log(`rehearsing on ${dbName}\n`);

// ── Put the database back to the shape production is in ─────────────────────
await c.query('ALTER TABLE "FollowUpTask" DROP CONSTRAINT IF EXISTS "FollowUpTask_leadId_fkey"');
await c.query('DROP INDEX IF EXISTS "FollowUpTask_tenantId_leadId_status_dueAt_idx"');
await c.query('DROP INDEX IF EXISTS "Task_tenantId_leadId_status_dueAt_idx"');
console.log('reverted to the pre-release shape: no foreign key, no new indexes');

// A workspace and a lead to hang the damage off.
const tenantFirst = await one(`SELECT "id" FROM "Tenant" ORDER BY "createdAt" LIMIT 1`);
const tenant = tenantFirst;
// A lead in a *different* workspace. Picked by asking for the lead directly
// rather than for a tenant and then hoping it has one — the seed's later
// workspaces do not all carry leads, and an empty pick silently skipped this case.
const foreignLead = await one(`SELECT "id" FROM "Lead" WHERE "tenantId" <> $1 LIMIT 1`, [tenantFirst.id]);
if (!tenant) {
  console.error('no workspace in this database — seed it first');
  process.exit(2);
}
const lead = await one(`SELECT "id", "tenantId" FROM "Lead" WHERE "tenantId" = $1 LIMIT 1`, [tenant.id]);
const owner = await one(`SELECT "id" FROM "User" WHERE "tenantId" = $1 LIMIT 1`, [tenant.id]);
if (!lead || !owner) {
  console.error('no lead or user in this database — seed it first');
  process.exit(2);
}

// ── Manufacture the two faults ──────────────────────────────────────────────
const ORPHANS = 7;
for (let i = 0; i < ORPHANS; i++) {
  await c.query(
    `INSERT INTO "FollowUpTask" ("id","tenantId","leadId","ownerId","title","dueAt","status","createdAt","updatedAt")
     VALUES (gen_random_uuid()::text, $1, 'lead_deleted_' || $2::text, $3, 'Orphaned follow-up', now(), 'OPEN', now(), now())`,
    [tenant.id, String(i), owner.id],
  );
}
// A follow-up pointing at a lead in a *different* workspace: the foreign key
// accepts it (the id resolves) but it is a tenancy fault, so the preflight
// reports it separately and the migration deliberately leaves it alone.
let crossMade = 0;
if (foreignLead) {
  await c.query(
    `INSERT INTO "FollowUpTask" ("id","tenantId","leadId","ownerId","title","dueAt","status","createdAt","updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, 'Cross-workspace follow-up', now(), 'OPEN', now(), now())`,
    [tenant.id, foreignLead.id, owner.id],
  );
  crossMade = 1;
}

const before = await one(`
  SELECT (SELECT count(*) FROM "FollowUpTask" f WHERE f."leadId" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "Lead" l WHERE l."id" = f."leadId")) AS orphans,
         (SELECT count(*) FROM "FollowUpTask" f JOIN "Lead" l ON l."id" = f."leadId"
           WHERE l."tenantId" <> f."tenantId") AS cross_tenant,
         (SELECT count(*) FROM "FollowUpTask") AS total`);
console.log(`injected ${ORPHANS} orphan(s) and ${crossMade} cross-workspace reference`);
console.log(`  before: orphans=${n(before.orphans)} cross=${n(before.cross_tenant)} rows=${n(before.total)}`);

// ── Run the real migration files, each in its own transaction ───────────────
const t0 = Date.now();
await c.query('BEGIN');
await c.query(readFileSync(MIG, 'utf8'));
await c.query('COMMIT');
const tMig = Date.now() - t0;

const t1 = Date.now();
await c.query('BEGIN');
await c.query(readFileSync(VAL, 'utf8'));
await c.query('COMMIT');
const tVal = Date.now() - t1;

const after = await one(`
  SELECT (SELECT count(*) FROM "FollowUpTask" f WHERE f."leadId" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "Lead" l WHERE l."id" = f."leadId")) AS orphans,
         (SELECT count(*) FROM "FollowUpTask" WHERE "leadId" IS NULL) AS detached,
         (SELECT count(*) FROM "FollowUpTask" f JOIN "Lead" l ON l."id" = f."leadId"
           WHERE l."tenantId" <> f."tenantId") AS cross_tenant,
         (SELECT count(*) FROM "FollowUpTask") AS total,
         (SELECT convalidated FROM pg_constraint WHERE conname = 'FollowUpTask_leadId_fkey') AS validated`);

console.log(`\nmigration ${tMig} ms, validation ${tVal} ms`);
console.log(
  `  after:  orphans=${n(after.orphans)} detached=${n(after.detached)} cross=${n(after.cross_tenant)} rows=${n(after.total)}`,
);
console.log(`  constraint validated: ${after.validated}`);

const kept = n(after.total) === n(before.total);
const cleared = n(after.orphans) === 0;
const detached = n(after.detached) >= ORPHANS;
const crossKept = n(after.cross_tenant) === n(before.cross_tenant);

console.log('');
console.log(`  ${kept ? 'PASS' : 'FAIL'}  no row was deleted (${n(before.total)} -> ${n(after.total)})`);
console.log(`  ${cleared ? 'PASS' : 'FAIL'}  every orphan reference resolved`);
console.log(`  ${detached ? 'PASS' : 'FAIL'}  orphans were detached, not removed`);
// 0 === 0 is not evidence. If none was injected — the seeded dataset carries
// leads in one workspace only — say so rather than print a PASS that means
// nothing. The preflight checks this against real data, which is where it counts.
console.log(
  crossMade === 0
    ? '  SKIP  cross-workspace reference not exercised: no lead exists outside the first workspace here'
    : `  ${crossKept ? 'PASS' : 'FAIL'}  the cross-workspace row was left alone for a human to judge`,
);
console.log(`  ${after.validated ? 'PASS' : 'FAIL'}  the foreign key is validated, not left NOT VALID`);

// ── Prove the cascade behaviour the release introduces ──────────────────────
const probeLead = await one(
  `INSERT INTO "Lead" ("id","tenantId","reference","fullName","stageId","createdAt","updatedAt")
   SELECT gen_random_uuid()::text, $1, 'REHEARSE-' || substr(md5(random()::text),1,8), 'Cascade probe', s."id", now(), now()
     FROM "LeadStage" s WHERE s."tenantId" = $1 LIMIT 1
   RETURNING "id"`,
  [tenant.id],
);
await c.query(
  `INSERT INTO "FollowUpTask" ("id","tenantId","leadId","ownerId","title","dueAt","status","createdAt","updatedAt")
   VALUES (gen_random_uuid()::text, $1, $2, $3, 'Cascade probe', now(), 'OPEN', now(), now())`,
  [tenant.id, probeLead.id, owner.id],
);
await c.query(`DELETE FROM "Lead" WHERE "id" = $1`, [probeLead.id]);
const left = await one(`SELECT count(*)::int AS n FROM "FollowUpTask" WHERE "leadId" = $1`, [probeLead.id]);
console.log(`  ${left.n === 0 ? 'PASS' : 'FAIL'}  deleting a lead now removes its follow-ups (ON DELETE CASCADE)`);

await c.end();
