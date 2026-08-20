/**
 * The `calls` and `events` modules used by /api/v1/calls/**, /api/v1/events/** and
 * the campaign send route were originally missing from the permission catalogue, so
 * assertPermission() denied every one of those routes for every role. Migration
 * 20260805000000_sales_engagement_flow adds them by mirroring each role's `leads`
 * grants.
 *
 * These assertions guard both directions of that fix: the routes must be reachable,
 * and the mirror must not hand a role more than it already had on leads.
 *
 * ── Why the first assertion names its actions instead of reading `leads` ────
 *
 * It used to assert "every action `leads` carries". That was a proxy for the
 * migration's list, and it is not a safe one: `POST /api/v1/platform/workspaces`
 * seeds a baseline catalogue when a workspace is provisioned, and its module
 * list includes `leads` and `calls` but not `events` — so creating a workspace
 * adds `MANAGE_USERS` and `MANAGE_CONFIGURATION` to two of the three modules
 * this test compares. Against a database where that route has run, the old
 * assertion failed on `events` for a reason that has nothing to do with the
 * fix it guards.
 *
 * In CI it happened to stay green only because `Integration (server)` runs
 * after `Test`. A test that passes because of step ordering is a test waiting
 * to fail, so it now names the ten record actions the migration is actually
 * responsible for.
 */
import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';

const ENGAGEMENT = ['calls', 'events'] as const;

/**
 * Exactly what `20260805000000_sales_engagement_flow` inserts for both modules.
 * These ten are what make /api/v1/calls/** and /api/v1/events/** reachable.
 */
const RECORD_ACTIONS = [
  'VIEW',
  'CREATE',
  'EDIT',
  'DELETE',
  'EXPORT',
  'IMPORT',
  'ASSIGN',
  'REASSIGN',
  'BULK_UPDATE',
  'VIEW_SENSITIVE_FIELDS',
] as const;

/** Raw, because the tenant guard refuses an unscoped read and this needs every tenant. */
async function tenantIds(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Tenant" WHERE "deletedAt" IS NULL`;
  return rows.map((row) => row.id);
}

describe('calls and events permission catalogue', () => {
  it('carries every record action the engagement migration inserts', async () => {
    for (const permissionModule of ENGAGEMENT) {
      const rows = await prisma.permission.findMany({
        where: { module: permissionModule },
        select: { action: true },
      });
      const present = new Set(rows.map((row) => row.action as string));
      const missing = RECORD_ACTIONS.filter((action) => !present.has(action));
      // `permissionModule`, not `module` — the old message interpolated Node's
      // module object and printed "[object Object] is missing actions", which
      // told a reader nothing about which of the two had failed.
      expect(missing, `${permissionModule} is missing actions`).toEqual([]);
    }
  });

  it('grants each role exactly what it already had on leads — never more', async (ctx) => {
    // Seeded roles only exist on a seeded database; the catalogue assertion above
    // is the part that holds everywhere.
    const tenants = await tenantIds();
    if (tenants.length === 0) return ctx.skip();

    const roles = await prisma.role.findMany({
      where: { tenantId: { in: tenants } },
      select: {
        id: true,
        key: true,
        permissions: {
          where: { granted: true, permission: { module: { in: ['leads', ...ENGAGEMENT] } } },
          select: { scope: true, permission: { select: { module: true, action: true } } },
        },
      },
    });
    for (const role of roles) {
      const leads = new Map(
        role.permissions.filter((p) => p.permission.module === 'leads').map((p) => [p.permission.action, p.scope]),
      );

      for (const permissionModule of ENGAGEMENT) {
        const granted = role.permissions.filter((p) => p.permission.module === permissionModule);

        // A role with no leads access must not have gained engagement access, and a
        // role with leads access must not exceed the scope it holds there.
        for (const grant of granted) {
          const leadScope = leads.get(grant.permission.action);
          expect(
            leadScope,
            `${role.key} was granted ${module}:${grant.permission.action} without the matching leads grant`,
          ).toBeDefined();
          expect(
            grant.scope,
            `${role.key} holds a wider scope on ${module}:${grant.permission.action} than on leads`,
          ).toBe(leadScope);
        }
      }
    }
  });

  it('leaves read-only roles unable to create or edit calls', async () => {
    const tenants = await tenantIds();
    const readOnly = await prisma.rolePermission.findMany({
      where: {
        tenantId: { in: tenants },
        granted: true,
        role: { key: 'read_only' },
        permission: { module: { in: [...ENGAGEMENT] }, action: { in: ['CREATE', 'EDIT', 'DELETE'] } },
      },
    });
    expect(readOnly).toEqual([]);
  });
});
