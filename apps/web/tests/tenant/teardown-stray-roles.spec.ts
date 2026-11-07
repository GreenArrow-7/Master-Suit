import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createRole } from '@/services/identity/roles';
import { ctxForUser } from '@/lib/auth/session';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';

/**
 * The rule `globalTeardown` deletes stray roles by.
 *
 * `business-journey` and `record-scope` run against `E2E_DEMO_SLUG` — a
 * workspace that already existed and has to survive the run — and each creates
 * a role inside it. The teardown deletes tenants whose slug carries the run
 * tag, which never reaches those, so a demo workspace collected a
 * `Journey Rep`, a `Seller` and a `Scope probe` per run.
 *
 * Two things have to hold for the fix to be safe, and neither is obvious:
 *
 *   1. the key the API *stores* still ends with the tag — `createRole`
 *      lowercases it and replaces everything outside `[a-z0-9_]`, so a tag
 *      containing anything else would be silently rewritten and never matched;
 *   2. the rule cannot reach a real role.
 */
const tag = `e2e${Date.now().toString(36)}`;
const suffix = randomBytes(4).toString('hex');
const tenantIds: string[] = [];

afterAll(async () => {
  for (const id of tenantIds) await prisma.tenant.delete({ where: { id } }).catch(() => {});
});

describe('the teardown rule for roles left in a workspace it did not create', () => {
  it('matches what the roles API actually stores, and nothing else', async () => {
    const tenant = await prisma.tenant.create({
      data: { slug: `stray-${suffix}`, legalName: `Stray ${suffix} LLC`, displayName: 'Stray', status: 'ACTIVE' },
    });
    tenantIds.push(tenant.id);
    const adminRole = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        key: `admin-${suffix}`,
        name: 'Administrator',
        rank: 0,
        defaultScope: 'ORGANIZATION',
      },
    });
    await grantPermissions(tenant.id, adminRole.id, [
      ['roles', 'VIEW'],
      ['roles', 'MANAGE_CONFIGURATION'],
    ]);
    const admin = await createWorkspaceUser({
      tenantId: tenant.id,
      roleId: adminRole.id,
      email: `stray-admin-${suffix}@stray.test`,
      fullName: 'Stray Administrator',
    });
    const ctx = await ctxForUser(admin.id, tenant.id, `teardown-roles-${suffix}`);

    // Exactly what business-journey and record-scope send.
    const run = `${randomBytes(3).toString('hex')}${tag}`;
    for (const [key, name] of [
      [`seller_${run}`, `Seller ${run}`],
      [`journey_rep_${run}`, `Journey Rep ${run}`],
      [`scope_${run}`, `Scope probe ${run}`],
    ])
      await createRole(ctx, { key: key!, name: name!, rank: 60, defaultScope: 'OWN' });

    // A real role, created the same way, that the rule must not touch.
    await createRole(ctx, { key: 'sales_agent', name: 'Sales Agent', rank: 50, defaultScope: 'OWN' });

    const before = await prisma.role.count({ where: { tenantId: tenant.id } });
    expect(before).toBe(5);

    /**
     * The teardown's predicate. It runs there across every tenant on its own
     * unguarded `PrismaClient`; here it is scoped to this workspace as well,
     * because `lib/db` refuses a `Role` query that does not name its tenant and
     * a test has no business being the one exception. What is under test is
     * which rows the `endsWith` selects, and that is the same either way.
     */
    const matched = await prisma.role.findMany({
      where: { tenantId: tenant.id, key: { endsWith: tag } },
      select: { name: true },
    });
    expect(matched.map((role) => role.name.split(' ').slice(0, -1).join(' ')).sort()).toEqual([
      'Journey Rep',
      'Scope probe',
      'Seller',
    ]);

    const { count } = await prisma.role.deleteMany({ where: { tenantId: tenant.id, key: { endsWith: tag } } });
    expect(count, 'the three roles the specs leave behind').toBe(3);

    const left = (await prisma.role.findMany({ where: { tenantId: tenant.id }, select: { key: true } })).map(
      (role) => role.key,
    );
    expect(left.sort()).toEqual([`admin-${suffix}`, 'sales_agent']);
  });

  it('the run tag survives the key normalisation it passes through', () => {
    // createRole lowercases and strips anything outside [a-z0-9_]; the tag is
    // base36 of a timestamp, so it passes through untouched. A tag with a
    // hyphen or a capital would not, and the teardown would match nothing.
    expect(tag).toBe(tag.toLowerCase().replace(/[^a-z0-9_]+/g, '_'));
  });
});
