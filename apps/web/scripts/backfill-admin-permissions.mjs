#!/usr/bin/env node
/**
 * Grants workspace administrators the permission modules provisioning never
 * offered them.
 *
 * Until commit 18de31f, creating a workspace granted its administrator a
 * hardcoded list of 25 permission modules. The catalogue has 61. The other 36 —
 * projects, listings, visits, bookings, commissions, events, documents,
 * products, tickets, payroll, recruitment and the rest — were unreachable in
 * that workspace, because each module's migration backfills grants by deriving
 * from rows already in RolePermission and therefore only ever helped workspaces
 * that existed when the migration ran.
 *
 * Provisioning is fixed going forward. This is for the workspaces created
 * before it was.
 *
 * Usage:
 *   node scripts/backfill-admin-permissions.mjs             # dry run
 *   node scripts/backfill-admin-permissions.mjs --apply     # write
 *
 * Dry run is the default because this widens what an administrator may do.
 *
 * ── The part that matters ──────────────────────────────────────────────────
 *
 * Revoking a permission DELETES its RolePermission row (see
 * services/identity/roles.ts), so a missing row is ambiguous: it can mean "never
 * granted" or "an administrator deliberately took this away".
 *
 * Restoring both would silently undo every deliberate revocation in the
 * database, which is a worse bug than the one being fixed. The list below is
 * what provisioning used to grant, and it is the discriminator:
 *
 *   - missing AND in the old list      → provisioning gave it, so somebody
 *                                        removed it on purpose. LEFT ALONE.
 *   - missing AND not in the old list  → never offered. GRANTED.
 *
 * Nothing is ever revoked, downgraded or re-scoped, and an existing row is
 * never touched — including one sitting at granted = false.
 *
 * Sessions are not revoked. resolveCtx reads role permissions from the database
 * on every request, so the grants take effect on the next one; logging every
 * administrator out to widen their own access would be noise.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const APPLY = process.argv.includes('--apply');

/** Exactly what provisioning granted before the fix. Do not "tidy" this. */
const OLD_MODULES = [
  'employee',
  'leave',
  'attendance',
  'hr_documents',
  'departments',
  'overtime',
  'shifts',
  'holidays',
  'work_locations',
  'hr_reports',
  'hrms',
  'leads',
  'opportunities',
  'accounts',
  'contacts',
  'activities',
  'tasks',
  'calls',
  'campaigns',
  'reports',
  'users',
  'roles',
  'settings',
  'auditlogs',
  'integrations',
];
const OLD_ACTIONS = ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'MANAGE_USERS', 'MANAGE_CONFIGURATION'];
const OLD_EXTRAS = ['leave:APPROVE', 'attendance:APPROVE', 'overtime:APPROVE', 'hr_documents:VIEW_SENSITIVE_FIELDS'];

const provisioned = new Set([
  ...OLD_MODULES.flatMap((module) => OLD_ACTIONS.map((action) => `${module}:${action}`)),
  ...OLD_EXTRAS,
]);

/** The role provisioning creates. Nothing else is touched. */
const ADMIN_ROLE_KEYS = ['company_admin', 'org_admin'];

const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Set MIGRATION_DATABASE_URL or DATABASE_URL. The migration role is needed: this reads across tenants.');
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const permissions = await prisma.permission.findMany({ select: { id: true, module: true, action: true } });
  const catalogue = permissions.map((p) => ({ ...p, key: `${p.module}:${p.action}` }));

  const roles = await prisma.role.findMany({
    where: { key: { in: ADMIN_ROLE_KEYS } },
    select: { id: true, tenantId: true, key: true, name: true },
  });

  if (roles.length === 0) {
    console.log('No administrator roles found. Nothing to do.');
    return;
  }

  const tenants = await prisma.tenant.findMany({
    where: { id: { in: [...new Set(roles.map((r) => r.tenantId))] } },
    select: { id: true, slug: true },
  });
  const slugOf = new Map(tenants.map((t) => [t.id, t.slug]));

  console.log(
    `${catalogue.length} permissions in the catalogue, ${provisioned.size} of which provisioning used to grant.`,
  );
  console.log(`${roles.length} administrator role(s) across ${tenants.length} workspace(s).\n`);

  let totalGranted = 0;
  let totalRespected = 0;

  for (const role of roles) {
    const existing = await prisma.rolePermission.findMany({
      where: { tenantId: role.tenantId, roleId: role.id },
      select: { permissionId: true },
    });
    const held = new Set(existing.map((e) => e.permissionId));

    const missing = catalogue.filter((p) => !held.has(p.id));
    // Absence inside the old list is a decision. Absence outside it is the bug.
    const revoked = missing.filter((p) => provisioned.has(p.key));
    const neverOffered = missing.filter((p) => !provisioned.has(p.key));

    const slug = slugOf.get(role.tenantId) ?? role.tenantId;
    if (neverOffered.length === 0 && revoked.length === 0) {
      console.log(`  ${slug} / ${role.key}: already complete`);
      continue;
    }

    const modules = [...new Set(neverOffered.map((p) => p.module))].sort();
    console.log(
      `  ${slug} / ${role.key}: granting ${neverOffered.length} permission(s) across ${modules.length} module(s)`,
    );
    if (modules.length > 0) console.log(`      ${modules.join(', ')}`);
    if (revoked.length > 0) {
      const revokedModules = [...new Set(revoked.map((p) => p.key))].sort();
      console.log(`      leaving ${revoked.length} deliberately revoked: ${revokedModules.join(', ')}`);
    }

    totalGranted += neverOffered.length;
    totalRespected += revoked.length;

    if (APPLY && neverOffered.length > 0) {
      // createMany, not upsert: everything here is known to have no row, and
      // skipDuplicates means a concurrent run cannot double-insert.
      await prisma.rolePermission.createMany({
        data: neverOffered.map((p) => ({
          tenantId: role.tenantId,
          roleId: role.id,
          permissionId: p.id,
          granted: true,
          scope: 'ORGANIZATION',
        })),
        skipDuplicates: true,
      });
    }
  }

  console.log(
    `\n${APPLY ? 'Granted' : 'Would grant'} ${totalGranted} permission(s); left ${totalRespected} deliberate revocation(s) alone.`,
  );
  if (!APPLY) console.log('Nothing was written. Re-run with --apply.');
  else console.log('Administrators pick these up on their next request; no sign-out is needed.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
