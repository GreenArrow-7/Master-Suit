/**
 * The `calls` and `events` modules used by /api/v1/calls/**, /api/v1/events/** and
 * the campaign send route were originally missing from the permission catalogue, so
 * assertPermission() denied every one of those routes for every role. Migration
 * 20260805000000_sales_engagement_flow adds them by mirroring each role's `leads`
 * grants.
 *
 * These assertions guard both directions of that fix: the routes must be reachable,
 * and the mirror must not hand a role more than it already had on leads.
 */
import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';

const ENGAGEMENT = ['calls', 'events'] as const;

/** Raw, because the tenant guard refuses an unscoped read and this needs every tenant. */
async function tenantIds(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Tenant" WHERE "deletedAt" IS NULL`;
  return rows.map((row) => row.id);
}

describe('calls and events permission catalogue', () => {
  it('carries every action the leads module carries', async () => {
    const leadActions = await prisma.permission.findMany({
      where: { module: 'leads' }, select: { action: true },
    });
    expect(leadActions.length).toBeGreaterThan(0);

    for (const module of ENGAGEMENT) {
      const actions = await prisma.permission.findMany({ where: { module }, select: { action: true } });
      const missing = leadActions
        .map((p) => p.action)
        .filter((action) => !actions.some((a) => a.action === action));
      expect(missing, `${module} is missing actions`).toEqual([]);
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
        id: true, key: true,
        permissions: {
          where: { granted: true, permission: { module: { in: ['leads', ...ENGAGEMENT] } } },
          select: { scope: true, permission: { select: { module: true, action: true } } },
        },
      },
    });
    for (const role of roles) {
      const leads = new Map(
        role.permissions
          .filter((p) => p.permission.module === 'leads')
          .map((p) => [p.permission.action, p.scope]),
      );

      for (const module of ENGAGEMENT) {
        const granted = role.permissions.filter((p) => p.permission.module === module);

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
