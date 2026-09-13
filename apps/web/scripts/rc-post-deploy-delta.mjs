/**
 * Read-only: what has been written since a moment in time.
 *
 *   MIGRATION_DATABASE_URL=<owner url> node scripts/rc-post-deploy-delta.mjs 2026-09-12T08:00:00Z
 *
 * The recovery question nobody wants to answer at 3 a.m. is "if we restore
 * the pre-deployment backup, what do we lose?" This answers it before it is
 * asked: for every business table that carries createdAt/updatedAt, the number
 * of rows created and the number modified after the given instant, per
 * workspace. Counts only — no name, phone, email, amount or connection string
 * — so the output can go into the ticket and be compared against the same run
 * after a restore.
 *
 * It is the input to a reconciliation, not the reconciliation: a restore to
 * before T loses everything listed here, and the listed rows are what has to
 * be re-entered, replayed from the audit log, or accepted as lost. That is a
 * decision for whoever owns the data, made with this in front of them.
 *
 * Every statement is a SELECT. Needs a role that can read across tenants —
 * the owning/migration role. It does not need write access.
 */
import { openAudit } from './rc-readonly.mjs';

const since = process.argv[2];
if (!since || Number.isNaN(Date.parse(since))) {
  console.error('Usage: MIGRATION_DATABASE_URL=<owner url> node scripts/rc-post-deploy-delta.mjs <ISO-8601 instant>');
  process.exit(2);
}

const { rows, who, done } = await openAudit('Post-deployment delta');
console.log(`Server time ${who.at.toISOString()}.`);
console.log(`Rows created or modified since ${new Date(since).toISOString()}. Read-only.`);

// Every table with both timestamps and a tenantId: the business tables. The
// list is read from the catalogue rather than hard-coded so a table added
// after this script was written is counted rather than silently missed.
const tables = await rows(`
  SELECT c.table_name AS name
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.column_name = 'createdAt'
    AND EXISTS (SELECT 1 FROM information_schema.columns u WHERE u.table_schema='public' AND u.table_name=c.table_name AND u.column_name='updatedAt')
    AND EXISTS (SELECT 1 FROM information_schema.columns t WHERE t.table_schema='public' AND t.table_name=c.table_name AND t.column_name='tenantId')
  ORDER BY 1`);

let totalCreated = 0;
let totalModified = 0;
const perTenant = new Map();
console.log(`\n${'table'.padEnd(34)} ${'created'.padStart(9)} ${'modified'.padStart(9)}`);
console.log('─'.repeat(54));
for (const { name } of tables) {
  const [r] = await rows(
    `SELECT count(*) FILTER (WHERE "createdAt" >= $1) AS created,
            count(*) FILTER (WHERE "updatedAt" >= $1 AND "createdAt" < $1) AS modified
     FROM "${name}"`,
    [since],
  );
  const created = Number(r.created);
  const modified = Number(r.modified);
  if (created === 0 && modified === 0) continue;
  totalCreated += created;
  totalModified += modified;
  console.log(`${name.padEnd(34)} ${String(created).padStart(9)} ${String(modified).padStart(9)}`);
  for (const t of await rows(
    `SELECT "tenantId", count(*) AS n FROM "${name}" WHERE "createdAt" >= $1 OR "updatedAt" >= $1 GROUP BY 1`,
    [since],
  )) {
    perTenant.set(t.tenantId, (perTenant.get(t.tenantId) ?? 0) + Number(t.n));
  }
}
console.log('─'.repeat(54));
console.log(`${'total'.padEnd(34)} ${String(totalCreated).padStart(9)} ${String(totalModified).padStart(9)}`);

console.log('\nRows touched, per workspace (tenant id only):');
if (perTenant.size === 0) console.log('  none');
for (const [tenant, n] of [...perTenant].sort((a, b) => b[1] - a[1])) console.log(`  ${tenant}  ${n}`);

// The two things a pre-deployment restore cannot get back by re-entry: money
// state and audit trail. Called out separately so nobody averages them away.
const [money] = await rows(
  `SELECT
     (SELECT count(*) FROM "Booking"    WHERE "updatedAt" >= $1 AND "status" = 'CONFIRMED') AS confirmed_bookings,
     (SELECT count(*) FROM "Booking"    WHERE "collectedAt" >= $1)                            AS collections_marked,
     (SELECT count(*) FROM "Commission" WHERE "updatedAt" >= $1)                              AS commissions_touched,
     (SELECT count(*) FROM "Payout"     WHERE "updatedAt" >= $1)                              AS payouts_touched`,
  [since],
);
console.log('\nMoney state written since then (cannot be reconstructed from memory):');
for (const [k, v] of Object.entries(money)) console.log(`  ${k.padEnd(22)} ${v}`);

await done();
