/**
 * The reporting-manager rule, enforced on the HTTP route rather than in the
 * picker.
 *
 * `manager-eligibility.spec.ts` proves `setManager`, which is what the Add-user
 * form calls. This proves `PATCH /hr/employees`, which is the other way in and
 * the one a script, an import or a stale tab reaches. A rule that lives in one
 * of two doors is not a rule.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { PATCH as hrEdit } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route';
import { createSessionToken } from '../helpers/session';
import { createEmployee, createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { patch } from '../helpers/request';

const suffix = randomBytes(4).toString('hex');
const slug = `mgrroute-${suffix}`;

let tenantId = '';
let adminCookie = '';
let reportId = '';
let managerMembershipId = '';
let reportMembershipId = '';

const at = { path: `/api/v1/workspaces/${slug}/hr/employees`, params: { workspaceSlug: slug, resource: 'employees' } };

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'MgrRoute LLC', displayName: 'MgrRoute', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

  const role = await prisma.role.create({
    data: { tenantId, key: `hr-${suffix}`, name: 'HR', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, role.id, [
    ['employee', 'VIEW'],
    ['employee', 'EDIT'],
    ['employee', 'CREATE'],
    ['employee', 'DELETE'],
  ] as const);
  const admin = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `hr-${suffix}@mgr.test`,
    fullName: 'HR Admin',
  });
  adminCookie = await createSessionToken(tenantId, admin.id);

  const report = await createEmployee({ tenantId, label: 'report', suffix, roleId: role.id });
  const manager = await createEmployee({ tenantId, label: 'manager', suffix, roleId: role.id });
  reportId = report.employeeId;
  reportMembershipId = report.membershipId;
  managerMembershipId = manager.membershipId;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('PATCH /hr/employees — reporting manager', () => {
  it('accepts a manager whose login is active', async () => {
    const res = await patch(hrEdit, `${at.path}?id=${reportId}`, { managerMembershipId }, adminCookie, at.params);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('refuses a manager whose login is suspended', async () => {
    await prisma.workspaceMembership.update({
      where: { tenantId, id: managerMembershipId },
      data: { status: 'SUSPENDED' },
    });

    const res = await patch(hrEdit, `${at.path}?id=${reportId}`, { managerMembershipId }, adminCookie, at.params);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/not active/i);

    await prisma.workspaceMembership.update({
      where: { tenantId, id: managerMembershipId },
      data: { status: 'ACTIVE' },
    });
  });

  it('refuses a manager who does not exist', async () => {
    const res = await patch(
      hrEdit,
      `${at.path}?id=${reportId}`,
      { managerMembershipId: 'cl00000000000000000000000' },
      adminCookie,
      at.params,
    );
    expect(res.status).toBe(404);
  });

  it('refuses somebody as their own reporting manager', async () => {
    const res = await patch(
      hrEdit,
      `${at.path}?id=${reportId}`,
      { managerMembershipId: reportMembershipId },
      adminCookie,
      at.params,
    );
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/own reporting manager/i);
  });
});
