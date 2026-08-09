#!/usr/bin/env node
/**
 * Removes rows whose workspace no longer exists.
 *
 * 131 of the 177 tenant-scoped tables have **no foreign key to `Tenant`**, so
 * deleting a workspace leaves its rows behind. Nothing reads them — row-level
 * security matches `tenantId` against the session's workspace, and a workspace
 * that has been deleted can never be one — but they accumulate, they are counted
 * by anything that aggregates across tenants, and they made a permission
 * backfill write 121,891 grants onto roles belonging to workspaces that no
 * longer exist.
 *
 * This is the sweep. It does not add the missing foreign keys: that is 131
 * constraints across live tables and a decision about lock time, not something
 * to do on the way past.
 *
 * Usage:
 *   node scripts/clean-orphaned-rows.mjs            # dry run
 *   node scripts/clean-orphaned-rows.mjs --apply    # delete
 *
 * ── Why this is safe ───────────────────────────────────────────────────────
 *
 * The rule is not a heuristic. A row is removed only when its `tenantId` names
 * a workspace that is **not in the Tenant table at all** — not soft-deleted,
 * absent. Every such row is already unreachable through the application, and no
 * amount of activity can make one reachable again.
 *
 * Tables are swept repeatedly until a full pass removes nothing. Some of them
 * reference each other, so the first attempt at a parent can fail on a child
 * that has not been cleared yet; the next pass gets it. Converging that way
 * needs no hand-maintained ordering to drift out of date.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const APPLY = process.argv.includes('--apply');

const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Set MIGRATION_DATABASE_URL or DATABASE_URL. This reads and writes across tenants.');
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Every table carrying a tenantId, whether or not it has the foreign key. */
async function tenantScopedTables() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT c.table_name AS name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'tenantId'
       AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name`);
  return rows.map((row) => row.name);
}

const countOrphans = async (table) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "${table}" x
      WHERE NOT EXISTS (SELECT 1 FROM "Tenant" t WHERE t.id = x."tenantId")`,
  );
  return rows[0].n;
};

async function main() {
  const tables = await tenantScopedTables();

  const before = [];
  for (const table of tables) {
    const n = await countOrphans(table);
    if (n > 0) before.push({ table, n });
  }

  const total = before.reduce((sum, row) => sum + row.n, 0);
  console.log(`${tables.length} tenant-scoped tables.`);
  console.log(`${before.length} hold rows whose workspace is gone — ${total.toLocaleString('en-GB')} rows in all.\n`);

  if (total === 0) {
    console.log('Nothing to remove.');
    return;
  }

  for (const row of before.sort((a, b) => b.n - a.n)) {
    console.log(`  ${String(row.n).padStart(8)}  ${row.table}`);
  }

  if (!APPLY) {
    console.log('\nNothing was deleted. Re-run with --apply.');
    return;
  }

  console.log('\nSweeping…');
  let removed = 0;
  for (let pass = 1; pass <= 10; pass++) {
    let passRemoved = 0;
    const blocked = [];

    for (const { table } of before) {
      try {
        const rows = await prisma.$queryRawUnsafe(
          `WITH gone AS (
             DELETE FROM "${table}" x
              WHERE NOT EXISTS (SELECT 1 FROM "Tenant" t WHERE t.id = x."tenantId")
              RETURNING 1
           ) SELECT count(*)::int AS n FROM gone`,
        );
        passRemoved += rows[0].n;
      } catch {
        // A child row elsewhere still points at this one. The next pass, after
        // that table has been cleared, will get it.
        blocked.push(table);
      }
    }

    removed += passRemoved;
    console.log(
      `  pass ${pass}: removed ${passRemoved.toLocaleString('en-GB')}${blocked.length ? `, ${blocked.length} table(s) still blocked` : ''}`,
    );
    if (passRemoved === 0) break;
  }

  const leftover = [];
  for (const { table } of before) {
    const n = await countOrphans(table);
    if (n > 0) leftover.push(`${table} (${n})`);
  }

  console.log(`\nRemoved ${removed.toLocaleString('en-GB')} row(s).`);
  if (leftover.length > 0) {
    console.log(`Still orphaned, blocked by a reference this sweep could not resolve: ${leftover.join(', ')}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
