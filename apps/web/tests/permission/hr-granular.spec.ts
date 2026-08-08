/**
 * P1-8 — the HR module's three permissions were three different authorities.
 *
 * `hrms:VIEW` returned the entire workspace, `hrms:CREATE` could mark any
 * employee present, and `isHrAdmin` — derived from `hrms:EDIT` at ORGANIZATION
 * scope — was the only gate on identity documents. Administering HR and reading
 * everyone's passport were the same permission, and no company could grant one
 * without the other.
 *
 * These tests pin the separation: each authority is granted alone and the others
 * stay shut.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  isApprover,
  isAttendanceApprover,
  isHrAdmin,
  mayReadAllEmployees,
  mayReadSensitiveDocuments,
} from '@/services/hr/access';
import { GET as hrRead, POST as hrWrite } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route';
import { createSessionToken } from '../helpers/session';
import { buildActor, buildCtx } from '../helpers/ctx';
import { get, post } from '../helpers/request';
import type { VisibilityScope } from '@prisma/client';
import type { Grants } from '../helpers/fixtures';

const suffix = randomBytes(4).toString('hex');
const slug = `granular-${suffix}`;

let tenantId = '';
let selfEmployeeId = '';
let otherEmployeeId = '';
const cookies: Record<string, string> = {};

/** A ctx holding exactly the permissions given, at ORGANIZATION scope. */
const ctxWith = (...keys: string[]) =>
  buildCtx(
    buildActor({
      id: `actor-${suffix}`,
      tenantId,
      roleId: 'r',
      roleKey: 'k',
      roleRank: 50,
      permissions: new Map(keys.map((key) => [key, 'ORGANIZATION' as const])),
    }),
  );

/** Creates a role holding exactly these grants, plus a member and a session. */
async function member(label: string, grants: Grants, scope: VisibilityScope = 'ORGANIZATION') {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: scope },
  });
  for (const [module, action] of grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope },
    });
  }
  const user = await prisma.user.create({
    data: { tenantId, email: `${label}-${suffix}@granular.test`, fullName: label, roleId: role.id, status: 'ACTIVE' },
  });
  const platformUser = await prisma.platformUser.create({
    data: {
      email: `${label}-${suffix}@granular.test`,
      normalizedEmail: `${label}-${suffix}@granular.test`,
      fullName: label,
      status: 'ACTIVE',
    },
  });
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  const employee = await prisma.employeeProfile.create({
    data: {
      tenantId,
      membershipId: membership.id,
      employeeNumber: `${label.toUpperCase()}-${suffix}`,
      employmentStatus: 'ACTIVE',
      joinedOn: new Date(),
    },
  });
  cookies[label] = await createSessionToken(tenantId, user.id);
  return employee.id;
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Granular LLC', displayName: 'Granular', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

  // Only the floor: may reach HR, sees their own record and nothing else.
  selfEmployeeId = await member('plain', [['employee', 'VIEW']], 'OWN');
  // Someone for them to try to reach.
  otherEmployeeId = await member('colleague', [['employee', 'VIEW']], 'OWN');
  // The full HR administrator, as the old `hrms:EDIT`@ORGANIZATION was.
  await member('hradmin', [
    ['employee', 'VIEW'],
    ['employee', 'CREATE'],
    ['employee', 'EDIT'],
    ['leave', 'APPROVE'],
    ['attendance', 'APPROVE'],
  ]);
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser
    .deleteMany({ where: { normalizedEmail: { contains: `-${suffix}@granular.test` } } })
    .catch(() => {});
});

describe('the authorities are independent', () => {
  it('administering HR no longer implies reading identity documents', () => {
    // The change that matters most. `isHrAdmin` used to be the document gate.
    const hrAdmin = ctxWith('employee:VIEW', 'employee:EDIT');
    expect(isHrAdmin(hrAdmin)).toBe(true);
    expect(mayReadSensitiveDocuments(hrAdmin)).toBe(false);
  });

  it('reading identity documents no longer implies administering HR', () => {
    const auditor = ctxWith('employee:VIEW', 'hr_documents:VIEW_SENSITIVE_FIELDS');
    expect(mayReadSensitiveDocuments(auditor)).toBe(true);
    expect(isHrAdmin(auditor)).toBe(false);
  });

  it('approving leave is separate from approving attendance', () => {
    const leaveOnly = ctxWith('leave:APPROVE');
    expect(isApprover(leaveOnly)).toBe(true);
    expect(isAttendanceApprover(leaveOnly)).toBe(false);

    const attendanceOnly = ctxWith('attendance:APPROVE');
    expect(isAttendanceApprover(attendanceOnly)).toBe(true);
    expect(isApprover(attendanceOnly)).toBe(false);
  });

  it('approving is separate from editing employee records', () => {
    // A line manager decides their reports' leave without being able to change
    // anyone's employment record; HR does the reverse.
    const manager = ctxWith('leave:APPROVE');
    expect(isApprover(manager)).toBe(true);
    expect(isHrAdmin(manager)).toBe(false);
    expect(mayReadAllEmployees(manager)).toBe(false);
  });
});

describe('reads are scoped', () => {
  it('an ordinary employee sees only their own record, not a directory', async () => {
    const res = await get(hrRead, `/api/v1/workspaces/${slug}/hr/employees`, cookies.plain, {
      workspaceSlug: slug,
      resource: 'employees',
    });

    expect(res.status).toBe(200);
    const ids = res.body.map((row: { id: string }) => row.id);
    expect(ids).toEqual([selfEmployeeId]);
    expect(ids).not.toContain(otherEmployeeId);
  });

  it('an HR administrator sees the workspace', async () => {
    const res = await get(hrRead, `/api/v1/workspaces/${slug}/hr/employees`, cookies.hradmin, {
      workspaceSlug: slug,
      resource: 'employees',
    });

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
  });

  it('the approval queue needs the approval permission', async () => {
    const refused = await get(hrRead, `/api/v1/workspaces/${slug}/hr/leave-pending`, cookies.plain, {
      workspaceSlug: slug,
      resource: 'leave-pending',
    });
    expect(refused.status).toBe(403);

    const allowed = await get(hrRead, `/api/v1/workspaces/${slug}/hr/leave-pending`, cookies.hradmin, {
      workspaceSlug: slug,
      resource: 'leave-pending',
    });
    expect(allowed.status).toBe(200);
  });
});

describe('attendance for another person', () => {
  it('is refused without the approval permission', async () => {
    // The hole this closes: `hrms:CREATE` — the permission that adds a
    // department — could mark any employee id PRESENT. Timesheet fraud with no
    // approval step.
    const res = await post(
      hrWrite,
      `/api/v1/workspaces/${slug}/hr/attendance`,
      { employeeId: otherEmployeeId, workDate: '2026-03-02', status: 'PRESENT' },
      cookies.plain,
      { workspaceSlug: slug, resource: 'attendance' },
    );

    expect(res.status).toBe(403);
    expect(await prisma.hrAttendanceRecord.count({ where: { tenantId, employeeId: otherEmployeeId } })).toBe(0);
  });

  it('is allowed for an attendance approver', async () => {
    const res = await post(
      hrWrite,
      `/api/v1/workspaces/${slug}/hr/attendance`,
      { employeeId: otherEmployeeId, workDate: '2026-03-03', status: 'PRESENT' },
      cookies.hradmin,
      { workspaceSlug: slug, resource: 'attendance' },
    );
    expect(res.status).toBe(200);
  });
});

describe('the upgrade preserved access', () => {
  it('every role that held hrms also holds the derived permission at the same scope', async () => {
    // The backfill in 20260807030000 must not have changed anyone's effective
    // access. Checked against the seeded workspaces, which carry real roles.
    const rows = await prisma.$queryRawUnsafe<{ mismatches: bigint }[]>(`
      SELECT count(*) AS mismatches
      FROM "RolePermission" rp
      JOIN "Permission" source ON source."id" = rp."permissionId"
      JOIN "Permission" target ON target."module" = 'employee' AND target."action" = source."action"
      LEFT JOIN "RolePermission" derived
        ON derived."roleId" = rp."roleId"
       AND derived."permissionId" = target."id"
       AND derived."scope" = rp."scope"
       AND derived."granted" = rp."granted"
      WHERE source."module" = 'hrms'
        AND source."action" IN ('VIEW', 'CREATE', 'EDIT', 'DELETE')
        AND derived."id" IS NULL
    `);
    expect(Number(rows[0].mismatches)).toBe(0);
  });
});
