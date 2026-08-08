/**
 * Overtime approval must respect the reporting line, not just the permission.
 *
 * `overtime:APPROVE` is granted at a scope, and the scope is the whole point:
 * per services/hr/access.ts, "TEAM scope and above is a line manager acting for
 * their own reports; ORGANIZATION is HR acting for anyone." Every sibling
 * workflow honours that distinction — `decideLeave` refuses a request that is
 * not assigned to you, `decideAttendanceException` refuses one from outside your
 * reporting line — but `decideOvertime` checked only that the *role* held the
 * permission, so a TEAM-scoped approver could decide any claim in the workspace.
 *
 * That is the money path: approving a claim stamps a multiplier onto it and
 * `approvedOvertimeMinutes` feeds the result straight to payroll. The permission
 * arrives by backfill from `attendance:APPROVE` at the same scope
 * (20260808140000_hr_overtime), and *that* authority is line-manager-constrained
 * — so the derived one silently granted strictly more than its source.
 *
 * The existing overtime suite builds every actor at ORGANIZATION scope, which is
 * exactly why this survived: at ORGANIZATION the behaviour is correct.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { decideOvertime, listOvertime, requestOvertime } from '@/services/hr/overtime';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { PermissionMap, Scope } from '@/lib/security/rbac';

const suffix = randomBytes(4).toString('hex');

let tenantId = '';
const employees: Record<string, string> = {};
const userIds: Record<string, string> = {};
const membershipIds: Record<string, string> = {};

const permissions = (grants: readonly (readonly [string, string])[], scope: Scope) =>
  new Map(grants.map(([module, action]) => [`${module}:${action}`, scope])) as PermissionMap;

const ctxFor = (label: string, grants: readonly (readonly [string, string])[], scope: Scope) =>
  buildCtx(buildActor({ id: userIds[label]!, tenantId, permissions: permissions(grants, scope) }));

const APPROVER = [
  ['overtime', 'APPROVE'],
  ['employee', 'VIEW'],
] as const;
const STAFF = [['employee', 'VIEW']] as const;

async function makeEmployee(label: string, managerOf?: string) {
  const email = `${label}-${suffix}@ot-scope.test`;
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: label, status: 'ACTIVE' },
  });
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: 'TEAM' },
  });
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: label, roleId: role.id, status: 'ACTIVE' },
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
      joinedOn: new Date('2020-01-01'),
      // The reporting line the scope is supposed to be measured against.
      managerMembershipId: managerOf ? membershipIds[managerOf] : null,
    },
  });
  employees[label] = employee.id;
  userIds[label] = user.id;
  membershipIds[label] = membership.id;
  return employee.id;
}

/** A pending claim belonging to `label`, on a date unique to this test. */
async function claimFor(label: string, workDate: string, minutes = 60) {
  return requestOvertime(ctxFor(label, STAFF, 'OWN'), {
    workDate: new Date(workDate),
    minutes,
    reason: `Claim for ${label}`,
  });
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: {
      slug: `ot-scope-${suffix}`,
      legalName: 'Overtime Scope LLC',
      displayName: 'Overtime Scope',
      status: 'ACTIVE',
      timezone: 'Asia/Dubai',
    },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

  await makeEmployee('manager');
  // Reports to `manager`.
  await makeEmployee('report', 'manager');
  // Reports to nobody — a different part of the company entirely.
  await makeEmployee('outsider');
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('a TEAM-scoped overtime approver', () => {
  it('cannot decide a claim from outside their reporting line', async () => {
    const claim = await claimFor('outsider', '2026-03-02');

    await expect(decideOvertime(ctxFor('manager', APPROVER, 'TEAM'), claim.id, true)).rejects.toMatchObject({
      status: 403,
    });

    // And the refusal must be real, not merely a thrown error after the write.
    const after = await prisma.hrOvertimeRequest.findFirstOrThrow({ where: { tenantId, id: claim.id } });
    expect(after.status).toBe('PENDING');
    expect(after.multiplier).toBeNull();
  });

  it('can still decide a claim from their own report', async () => {
    // The positive control: the fix must not break the approval it exists for.
    const claim = await claimFor('report', '2026-03-03');
    const decided = await decideOvertime(ctxFor('manager', APPROVER, 'TEAM'), claim.id, true);

    expect(decided.status).toBe('APPROVED');
    expect(decided.multiplier).toBeGreaterThan(0);
  });

  it('does not see claims from outside their reporting line in the queue', async () => {
    await claimFor('outsider', '2026-03-04');
    const { rows } = await listOvertime(ctxFor('manager', APPROVER, 'TEAM'), {});

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.employeeId === employees.outsider)).toBe(false);
  });
});

describe('an ORGANIZATION-scoped approver', () => {
  it('decides anyone, because that scope is what HR means', async () => {
    const claim = await claimFor('outsider', '2026-03-05');
    const decided = await decideOvertime(ctxFor('manager', APPROVER, 'ORGANIZATION'), claim.id, true);

    expect(decided.status).toBe('APPROVED');
  });
});
