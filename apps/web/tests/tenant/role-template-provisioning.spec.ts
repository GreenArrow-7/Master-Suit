import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, withPlatformTx } from '@/lib/db';
import { provisionRoleTemplates } from '@/services/platform/provisioning';
import { ROLE_TEMPLATES, templatesFor } from '@/lib/roles/templates';

/**
 * Provisioning the six role templates into a workspace.
 *
 * The three things that must hold, because they are what make this safe to run
 * against a company that has been working in the product for a year:
 *
 *   1. it is idempotent — running it again writes nothing;
 *   2. it never touches a role that exists, by key *or* by name, so an
 *      administrator's rename, re-scope or trimmed permission list stands;
 *   3. it never widens an existing role.
 *
 * (3) is the one worth stating plainly: the permission model deletes a
 * `RolePermission` row to revoke, so a gap cannot be told apart from a
 * deliberate revocation. Filling gaps would silently reverse administrators'
 * decisions, which is why the only write here is creating a role that is
 * absent.
 */
const suffix = randomBytes(4).toString('hex');
const tenantIds: string[] = [];

async function workspace(label: string) {
  const tenant = await prisma.tenant.create({
    data: { slug: `tpl-${label}-${suffix}`, legalName: `${label} LLC`, displayName: label, status: 'ACTIVE' },
  });
  tenantIds.push(tenant.id);
  return tenant.id;
}

const roleKeys = async (tenantId: string) =>
  (await prisma.role.findMany({ where: { tenantId }, orderBy: { rank: 'asc' }, select: { key: true } })).map(
    (role) => role.key,
  );

const grantsOf = async (tenantId: string, key: string) => {
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId, key }, select: { id: true } });
  const rows = await prisma.rolePermission.findMany({
    where: { tenantId, roleId: role.id },
    select: { scope: true, permission: { select: { module: true, action: true } } },
  });
  return rows.map((row) => `${row.permission.module}:${row.permission.action}@${row.scope}`).sort();
};

afterAll(async () => {
  for (const id of tenantIds) await prisma.tenant.delete({ where: { id } }).catch(() => {});
});

describe('provisionRoleTemplates', () => {
  it('gives a fully entitled workspace every template, with its grants', async () => {
    const tenantId = await workspace('full');
    await withPlatformTx((tx) => provisionRoleTemplates(tx, tenantId, ['SALES', 'HRMS', 'REAL_ESTATE']));

    expect(await roleKeys(tenantId)).toEqual(ROLE_TEMPLATES.map((t) => t.key));

    // Every grant in the spec reached the database at the scope the spec names.
    for (const template of ROLE_TEMPLATES) {
      const expected = template.grants.map((g) => `${g.module}:${g.action}@${g.scope}`).sort();
      expect(await grantsOf(tenantId, template.key), template.key).toEqual(expected);
    }
  });

  it('writes nothing the second time', async () => {
    const tenantId = await workspace('again');
    await withPlatformTx((tx) => provisionRoleTemplates(tx, tenantId, ['SALES', 'HRMS']));
    const before = await prisma.rolePermission.count({ where: { tenantId } });
    const keysBefore = await roleKeys(tenantId);

    await withPlatformTx((tx) => provisionRoleTemplates(tx, tenantId, ['SALES', 'HRMS']));

    expect(await roleKeys(tenantId)).toEqual(keysBefore);
    expect(await prisma.rolePermission.count({ where: { tenantId } })).toBe(before);
  });

  it('provisions only what the workspace is entitled to, and more when a module arrives', async () => {
    const tenantId = await workspace('grow');
    await withPlatformTx((tx) => provisionRoleTemplates(tx, tenantId, ['SALES']));
    expect(await roleKeys(tenantId)).not.toContain('hr_administrator');

    // The workspace buys HRMS. The editor and the subscription route both call
    // this again with the new module list.
    await withPlatformTx((tx) => provisionRoleTemplates(tx, tenantId, ['SALES', 'HRMS']));
    expect(await roleKeys(tenantId)).toContain('hr_administrator');
  });

  it('gives a workspace with no product modules the Employee template only', async () => {
    const tenantId = await workspace('bare');
    await withPlatformTx((tx) => provisionRoleTemplates(tx, tenantId, []));
    expect(await roleKeys(tenantId)).toEqual(['employee_self']);
  });

  it('leaves a role an administrator renamed alone, and does not re-create it', async () => {
    const tenantId = await workspace('renamed');
    await withPlatformTx((tx) => provisionRoleTemplates(tx, tenantId, ['SALES']));
    const before = await grantsOf(tenantId, 'sales_agent');

    await prisma.role.updateMany({
      where: { tenantId, key: 'sales_agent' },
      data: { name: 'Property Consultant', defaultScope: 'TEAM' },
    });
    await withPlatformTx((tx) => provisionRoleTemplates(tx, tenantId, ['SALES']));

    const role = await prisma.role.findFirstOrThrow({ where: { tenantId, key: 'sales_agent' } });
    expect(role.name).toBe('Property Consultant');
    expect(role.defaultScope).toBe('TEAM');
    expect((await roleKeys(tenantId)).filter((key) => key === 'sales_agent')).toHaveLength(1);
    expect(await grantsOf(tenantId, 'sales_agent')).toEqual(before);
  });

  it('does not widen a role an administrator trimmed', async () => {
    const tenantId = await workspace('trimmed');
    await withPlatformTx((tx) => provisionRoleTemplates(tx, tenantId, ['SALES']));

    // An administrator decides this workspace's agents may not see full contact
    // details. Revoking deletes the row — exactly the state that cannot be told
    // apart from "never granted".
    const role = await prisma.role.findFirstOrThrow({ where: { tenantId, key: 'sales_agent' } });
    const sensitive = await prisma.permission.findFirstOrThrow({
      where: { module: 'leads', action: 'VIEW_SENSITIVE_FIELDS' },
    });
    await prisma.rolePermission.deleteMany({ where: { tenantId, roleId: role.id, permissionId: sensitive.id } });

    await withPlatformTx((tx) => provisionRoleTemplates(tx, tenantId, ['SALES']));

    expect(await grantsOf(tenantId, 'sales_agent')).not.toContain('leads:VIEW_SENSITIVE_FIELDS@OWN');
  });

  it('skips a template whose name is already taken by a different key', async () => {
    const tenantId = await workspace('namesake');
    // A workspace that built its own "Sales Agent" by hand, under its own key.
    await prisma.role.create({
      data: { tenantId, key: 'own_agent', name: 'Sales Agent', rank: 55, defaultScope: 'OWN' },
    });
    await withPlatformTx((tx) => provisionRoleTemplates(tx, tenantId, ['SALES']));

    const keys = await roleKeys(tenantId);
    expect(keys).toContain('own_agent');
    expect(keys).not.toContain('sales_agent');
    // Two roles called "Sales Agent" in one picker is the confusion this work exists to remove.
    const named = await prisma.role.count({ where: { tenantId, name: 'Sales Agent' } });
    expect(named).toBe(1);
  });

  it('never creates the Company Administrator role', async () => {
    const tenantId = await workspace('admin');
    await withPlatformTx((tx) => provisionRoleTemplates(tx, tenantId, ['SALES', 'HRMS', 'REAL_ESTATE']));
    expect(await roleKeys(tenantId)).not.toContain('company_admin');
  });

  it('matches templatesFor, module for module', async () => {
    for (const [label, modules] of [
      ['le', ['LEAD_EAGLE']],
      ['re', ['REAL_ESTATE']],
      ['hr', ['HRMS']],
    ] as const) {
      const tenantId = await workspace(label);
      await withPlatformTx((tx) => provisionRoleTemplates(tx, tenantId, modules));
      expect(await roleKeys(tenantId), label).toEqual(templatesFor(modules).map((t) => t.key));
    }
  });
});
