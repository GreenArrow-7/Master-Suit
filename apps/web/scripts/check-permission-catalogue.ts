/**
 * Does this database hold every permission definition the application expects?
 *
 * Run against a migrated database, before any seed: CI runs it straight after
 * `prisma migrate deploy`, and an operator can run it read-only against a target
 * before or after an upgrade (runbook §3.1b). It reads `Permission` and writes
 * nothing. Exit 1 lists the missing `module:ACTION` definitions.
 *
 *   npx tsx scripts/check-permission-catalogue.ts            # MIGRATION_DATABASE_URL or DATABASE_URL
 *
 * The expected set is src/lib/security/permissionCatalogue.ts, which
 * tests/unit/permission-catalogue.spec.ts proves covers the navigation, the
 * monitoring allowlist and every literal permission check in src.
 */
import { Client } from 'pg';
import { catalogueTokens } from '../src/lib/security/permissionCatalogue';

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('[check-permission-catalogue] Set MIGRATION_DATABASE_URL or DATABASE_URL.');
    process.exit(2);
  }
  const client = new Client({ connectionString: url.split('?')[0] });
  await client.connect();
  try {
    const { rows } = await client.query<{ token: string }>(`SELECT module || ':' || action AS token FROM "Permission"`);
    const present = new Set(rows.map((row) => row.token));
    const expected = catalogueTokens();
    const missing = expected.filter((token) => !present.has(token)).sort();
    if (missing.length) {
      console.error(`[check-permission-catalogue] ${missing.length} of ${expected.length} definitions missing:`);
      for (const token of missing) console.error(`  ${token}`);
      process.exit(1);
    }
    console.log(`[check-permission-catalogue] all ${expected.length} definitions present (${present.size} rows).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[check-permission-catalogue] ${(error as Error).message}`);
  process.exit(2);
});
