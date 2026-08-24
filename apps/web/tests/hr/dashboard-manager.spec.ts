/**
 * The manager dashboard, which nothing exercised.
 *
 * ── Why it needed a test before it could be fixed ───────────────────────────
 *
 * `resolvePersona` selects `manager` for a team- or branch-scoped approver who
 * is not an HR administrator and holds none of the org-wide functions. None of
 * the seeded demo personas satisfies that, so a sweep of every demo login never
 * reaches `manager()` — which is how it kept an unbounded query nobody noticed.
 *
 * It used to load **every** employee id in scope with a `findMany` carrying no
 * `take`, then pass the array into three `IN (…)` counts. Wasteful on a small
 * team; on a large one it is a query with tens of thousands of bound parameters
 * and the whole id array resident while it runs.
 *
 * The fix expresses the team as a relation filter and lets Postgres count. The
 * assertions below are about **scope**, because that is what an `IN (…)` list
 * silently encodes and a relation filter has to reproduce exactly: a manager
 * counts their own people and nobody else's.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { loadDashboard, resolvePersona } from '@/services/hr/dashboard';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createWorkspaceUser } from '../helpers/fixtures';
import type { PermissionMap } from '@/lib/security/rbac';

const suffix = randomBytes(4).toString('hex');
let tenantId = '';
let managerUserId = '';
const reportUserIds: string[] = [];
const outsiderUserIds: string[] = [];

/** `attendance:APPROVE` at TEAM and nothing org-wide — the manager shape. */
const managerPermissions = new Map([
  ['employee:VIEW', 'TEAM'],
  ['attendance:APPROVE', 'TEAM'],
]) as unknown as PermissionMap;

/**
 * A workspace user with an employee record, optionally reporting to somebody.
 *
 * `createWorkspaceUser` owns the identity graph — PlatformUser, User and the
 * membership that joins them — so this only adds the two things it does not:
 * the reporting line and the HR employee record.
 */
async function makeEmployee(label: string, managerId: string | null, roleId: string) {
  const user = await createWorkspaceUser({
    tenantId,
    roleId,
    email: `${label}-${suffix}@mgr.test`,
    fullName: label,
  });
  if (managerId) await prisma.user.update({ where: { id: user.id, tenantId }, data: { managerId } });

  const membership = await prisma.workspaceMembership.findFirstOrThrow({
    where: { tenantId, salesUserId: user.id },
    select: { id: true },
  });
  await prisma.employeeProfile.create({
    data: {
      tenantId,
      membershipId: membership.id,
      employeeNumber: `${label}-${suffix}`.slice(0, 24),
      employmentStatus: 'ACTIVE',
    },
  });
  return user.id;
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `mgr-${suffix}`, legalName: 'Mgr LLC', displayName: 'Mgr', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });
  const role = await prisma.role.create({
    data: { tenantId, key: `mgr-${suffix}`, name: 'Manager', rank: 20 },
  });

  managerUserId = await makeEmployee('boss', null, role.id);
  for (const n of [1, 2, 3]) reportUserIds.push(await makeEmployee(`report${n}`, managerUserId, role.id));
  // Two employees in the same workspace who do not report to this manager.
  for (const n of [1, 2]) outsiderUserIds.push(await makeEmployee(`outsider${n}`, null, role.id));

  // Attendance today: two of the three reports, and — the case that matters —
  // one outsider, who must not be counted.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const present = [...reportUserIds.slice(0, 2), outsiderUserIds[0]!];
  for (const userId of present) {
    const employee = await prisma.employeeProfile.findFirst({
      where: { tenantId, membership: { salesUserId: userId } },
      select: { id: true },
    });
    await prisma.hrAttendanceRecord.create({
      data: { tenantId, employeeId: employee!.id, workDate: today, status: 'PRESENT' },
    });
  }
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('the manager dashboard counts the manager’s team and nobody else', () => {
  const ctx = () =>
    buildCtx(
      buildActor({
        id: managerUserId,
        tenantId,
        roleKey: 'manager',
        roleRank: 20,
        managedUserIds: reportUserIds,
        permissions: managerPermissions,
      }),
    );

  it('selects the manager persona', () => {
    expect(resolvePersona(ctx())).toBe('manager');
  });

  it('counts the team without loading its ids', async () => {
    const data = await loadDashboard(ctx());
    expect(data.persona).toBe('manager');

    const team = data.stats.find((s) => s.label === 'Team size');
    // Self plus three reports — `resolveOwnerIds` at TEAM returns
    // `[self, ...managedUserIds]`, and every one of them has an EmployeeProfile.
    expect(team?.value).toBe(4);
  });

  it('excludes an attendance record belonging to someone outside the team', async () => {
    const data = await loadDashboard(ctx());
    const onSite = data.stats.find((s) => s.label === 'On site today');
    // Three people are PRESENT today; only two of them are this manager's.
    // A filter that lost its scope would say 3.
    expect(onSite?.value).toBe(2);
  });
});
