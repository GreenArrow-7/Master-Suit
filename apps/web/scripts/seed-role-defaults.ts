/**
 * Grants the seeded defaults to roles that hold no permissions at all.
 *
 * Usage:
 *   npx tsx scripts/seed-role-defaults.ts                 # dry run, the default
 *   npx tsx scripts/seed-role-defaults.ts --apply
 *   npx tsx scripts/seed-role-defaults.ts --apply --workspace manath-homes
 *   npx tsx scripts/seed-role-defaults.ts --apply --role employee
 *
 * ── Why only empty roles ───────────────────────────────────────────────────
 *
 * Revoking a permission DELETES its RolePermission row rather than storing a
 * false, so a missing row is ambiguous: it can mean "never granted" or "an
 * administrator deliberately took this away". Filling in every gap would
 * silently undo every considered revocation in the database, which is a worse
 * bug than the one being fixed.
 *
 * A role holding *zero* rows carries no such ambiguity. Nobody trims a role
 * down to nothing and leaves it in service — that is a role provisioning never
 * finished, which is exactly the state the HR roles were found in. So that is
 * the only case this touches, and roles with even one grant are reported and
 * left alone.
 *
 * Dry run is the default because this widens what people may do.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ROLES } from '../prisma/seed/roles';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const only = argv.includes('--workspace') ? argv[argv.indexOf('--workspace') + 1] : undefined;
/**
 * Roles to top up even though they already hold something.
 *
 * The zero-grants rule below is the safe default, but it is not always right:
 * a role can carry a stray grant from an unrelated module and still have never
 * been provisioned for its actual job. Naming one here is a deliberate act by
 * the operator, and it still only ever adds — `skipDuplicates` leaves whatever
 * is already there untouched.
 */
const forced = argv.filter((value, index) => argv[index - 1] === '--role');

/** Every table here is RLS-forced; this is the flag the policies name. */
const withPlatformTx = <T>(fn: (tx: Omit<PrismaClient, `$${string}`>) => Promise<T>) =>
  db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.platform_admin', 'on', true)`);
      return fn(tx as never);
    },
    { timeout: 120_000 },
  );

async function main() {
  await withPlatformTx(async (tx) => {
    const tenants = await tx.tenant.findMany({
      where: { deletedAt: null, ...(only ? { slug: only } : {}) },
      select: { id: true, slug: true, displayName: true },
      orderBy: { slug: 'asc' },
    });
    if (!tenants.length) throw new Error(only ? `No workspace with slug "${only}".` : 'No workspaces.');

    const catalogue = await tx.permission.findMany({ select: { id: true, module: true, action: true } });
    const index = new Map(catalogue.map((row) => [`${row.module}:${row.action}`, row.id]));

    let filled = 0;
    let skipped = 0;
    let unknown = 0;

    for (const tenant of tenants) {
      const roles = await tx.role.findMany({
        where: { tenantId: tenant.id },
        select: { id: true, key: true, name: true, rank: true },
        orderBy: { rank: 'asc' },
      });
      const counts = await tx.rolePermission.groupBy({
        by: ['roleId'],
        where: { tenantId: tenant.id },
        _count: { _all: true },
      });
      const held = new Map(counts.map((row) => [row.roleId, row._count._all]));

      console.log(`\n${tenant.displayName} (${tenant.slug})`);
      for (const role of roles) {
        const spec = ROLES.find((candidate) => candidate.key === role.key);
        const current = held.get(role.id) ?? 0;

        if (!spec) {
          console.log(`  ${role.key.padEnd(18)} ${String(current).padStart(4)} grants  no default defined — left alone`);
          unknown++;
          continue;
        }
        if (current > 0 && !forced.includes(role.key)) {
          console.log(`  ${role.key.padEnd(18)} ${String(current).padStart(4)} grants  already provisioned — left alone`);
          skipped++;
          continue;
        }

        const rows: { tenantId: string; roleId: string; permissionId: string; scope: string; granted: boolean }[] = [];
        for (const [module, actions] of Object.entries(spec.grants)) {
          if (module === '*') {
            for (const id of index.values()) {
              rows.push({ tenantId: tenant.id, roleId: role.id, permissionId: id, scope: 'ORGANIZATION', granted: true });
            }
            continue;
          }
          for (const [action, scope] of Object.entries(actions)) {
            const id = index.get(`${module}:${action}`);
            if (id) rows.push({ tenantId: tenant.id, roleId: role.id, permissionId: id, scope: scope!, granted: true });
          }
        }

        const how = forced.includes(role.key) && current > 0 ? ' (named with --role)' : '';
        console.log(
          `  ${role.key.padEnd(18)} ${String(current).padStart(4)} grants  ${apply ? 'GRANTING' : 'would grant'} ${rows.length}${how}`,
        );
        if (apply && rows.length) {
          await tx.rolePermission.createMany({ data: rows as never, skipDuplicates: true });
        }
        filled++;
      }
    }

    console.log(
      `\n${apply ? 'Filled' : 'Would fill'} ${filled} role(s); left ${skipped} already-provisioned and ${unknown} without a default.`,
    );
    if (!apply) console.log('Dry run. Re-run with --apply to write.');
  });
}

main()
  .catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
