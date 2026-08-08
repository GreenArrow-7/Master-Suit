/**
 * P0-1 — privilege escalation through the employee-create payload.
 *
 * `roleKey` is caller-supplied. Before the fix, the handler looked the role up by
 * key and bound the new login to whatever it found, with no rank comparison — so
 * any holder of `hrms:CREATE` could post `roleKey: "company_admin"` and mint an
 * administrator with a password of their choosing.
 *
 * These tests go through the real route handler with real session cookies and
 * real rows. Nothing is stubbed.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as hrPost } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser } from '../helpers/fixtures';
import { post } from '../helpers/request';
import type { VisibilityScope } from '@prisma/client';
import type { Grants } from '../helpers/fixtures';

/**
 * Pinned here rather than imported from the route, so the test asserts the
 * number independently instead of agreeing with whatever the source says.
 */
const DEFAULT_EMPLOYEE_ROLE_RANK = 100;

const suffix = randomBytes(4).toString('hex');
const slug = `escalation-${suffix}`;

/** Permissions granted at a scope, created on demand so the catalogue need not be seeded. */
async function grant(tenantId: string, roleId: string, pairs: Grants, scope: VisibilityScope) {
  for (const [module, action] of pairs) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId, permissionId: permission.id, granted: true, scope },
    });
  }
}

let tenantId = '';
let hrAdminCookie = '';
let employeeCookie = '';
let companyAdminRoleId = '';

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Escalation LLC', displayName: 'Escalation', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

  // The role an attacker wants to land in. Rank 10 is what every real workspace
  // provisioning creates for `company_admin`.
  const companyAdmin = await prisma.role.create({
    data: { tenantId, key: 'company_admin', name: 'Company Administrator', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  companyAdminRoleId = companyAdmin.id;

  // HR administrator: legitimately allowed to create employees. Rank 10, same as
  // company_admin, which is what makes the equal-rank case below meaningful.
  const hrAdminRole = await prisma.role.create({
    data: { tenantId, key: `hr_admin-${suffix}`, name: 'HR Administrator', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  await grant(
    tenantId,
    hrAdminRole.id,
    [
      ['employee', 'CREATE'],
      ['employee', 'EDIT'],
      ['users', 'MANAGE_USERS'],
    ],
    'ORGANIZATION',
  );

  // Exactly what the auto-created employee role grants today: hrms VIEW/CREATE/EDIT
  // at OWN scope. This is the actor the escalation was reachable from.
  const employeeRole = await prisma.role.create({
    data: {
      tenantId,
      key: `employee-${suffix}`,
      name: 'Employee',
      rank: DEFAULT_EMPLOYEE_ROLE_RANK,
      defaultScope: 'OWN',
    },
  });
  await grant(
    tenantId,
    employeeRole.id,
    [
      ['employee', 'VIEW'],
      ['employee', 'CREATE'],
      ['employee', 'EDIT'],
    ],
    'OWN',
  );

  const hrAdmin = await createWorkspaceUser({
    tenantId,
    roleId: hrAdminRole.id,
    email: `hr@${slug}.test`,
    fullName: 'HR Admin',
  });
  const employee = await createWorkspaceUser({
    tenantId,
    roleId: employeeRole.id,
    email: `emp@${slug}.test`,
    fullName: 'Employee',
  });

  hrAdminCookie = await createSessionToken(tenantId, hrAdmin.id);
  employeeCookie = await createSessionToken(tenantId, employee.id);
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

const params = { workspaceSlug: slug, resource: 'employees' };
const body = (extra: Record<string, unknown>) => ({
  fullName: 'Mallory Intruder',
  employeeNumber: `E-${randomBytes(3).toString('hex')}`,
  ...extra,
});

describe('P0-1 employee creation cannot be used to escalate', () => {
  it('refuses an employee-role actor claiming company_admin', async () => {
    const res = await post(
      hrPost,
      `/api/v1/workspaces/${slug}/hr/employees`,
      body({ email: `mallory-a@${slug}.test`, roleKey: 'company_admin' }),
      employeeCookie,
      params,
    );

    expect(res.status).toBe(403);
    const created = await prisma.user.findFirst({ where: { tenantId, email: `mallory-a@${slug}.test` } });
    expect(created).toBeNull();
  });

  it('refuses an employee-role actor even for an ordinary role', async () => {
    // Creating a login is user administration, not HR data entry: `hrms:CREATE`
    // must not be sufficient on its own.
    const res = await post(
      hrPost,
      `/api/v1/workspaces/${slug}/hr/employees`,
      body({ email: `mallory-b@${slug}.test`, roleKey: `employee-${suffix}` }),
      employeeCookie,
      params,
    );

    expect(res.status).toBe(403);
    expect(await prisma.user.count({ where: { tenantId, email: `mallory-b@${slug}.test` } })).toBe(0);
  });

  it('refuses an actor at rank 10 assigning a role at rank 10 — equal rank is not administerable', async () => {
    const res = await post(
      hrPost,
      `/api/v1/workspaces/${slug}/hr/employees`,
      body({ email: `peer@${slug}.test`, roleKey: 'company_admin' }),
      hrAdminCookie,
      params,
    );

    expect(res.status).toBe(403);
    expect(await prisma.user.count({ where: { tenantId, roleId: companyAdminRoleId } })).toBe(0);
  });

  it('invites into an unknown role, created at the lowest rank with employee permissions', async () => {
    const res = await post(
      hrPost,
      `/api/v1/workspaces/${slug}/hr/employees`,
      body({ email: `newstarter@${slug}.test`, roleKey: `field-agent-${suffix}` }),
      hrAdminCookie,
      params,
    );

    expect(res.status).toBe(200);

    const role = await prisma.role.findFirst({
      where: { tenantId, key: `field-agent-${suffix}` },
      include: { permissions: { include: { permission: true } } },
    });
    expect(role?.rank).toBe(DEFAULT_EMPLOYEE_ROLE_RANK);
    expect(role?.defaultScope).toBe('OWN');
    // Never granted anything that administers people.
    const granted = role!.permissions.map((p) => `${p.permission.module}:${p.permission.action}`);
    expect(granted).not.toContain('users:MANAGE_USERS');
    expect(granted.every((key) => p1Scope(role!.permissions, key) === 'OWN')).toBe(true);

    // No account yet — since 4.2 the endpoint issues an invitation, so the
    // person chooses their own password rather than being handed one.
    expect(await prisma.user.findFirst({ where: { tenantId, email: `newstarter@${slug}.test` } })).toBeNull();
    const invitation = await prisma.workspaceInvitation.findFirst({
      where: { tenantId, email: `newstarter@${slug}.test` },
    });
    expect(invitation!.roleId).toBe(role!.id);
  });

  it('rolls the auto-created role back when the rank guard refuses', async () => {
    // The role is created a line before the guard runs. A refusal must not leave
    // it behind, or a second attempt would find an existing role and behave
    // differently from the first.
    const key = `sneaky-${randomBytes(3).toString('hex')}`;
    const res = await post(
      hrPost,
      `/api/v1/workspaces/${slug}/hr/employees`,
      body({ email: `sneaky@${slug}.test`, roleKey: key }),
      employeeCookie,
      params,
    );

    expect(res.status).toBe(403);
    expect(await prisma.role.count({ where: { tenantId, key } })).toBe(0);
  });
});

function p1Scope(permissions: { scope: string; permission: { module: string; action: string } }[], key: string) {
  return permissions.find((p) => `${p.permission.module}:${p.permission.action}` === key)?.scope;
}
