import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import type { Ctx, PermissionMap } from '@/lib/security/rbac';
import { attendanceScope } from '@/services/hr/reads';
import { decideAttendanceException, requestAttendanceException } from '@/services/hr/requests';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createWorkspaceUser } from '../helpers/fixtures';

/**
 * A line manager's attendance authority, the same in every workspace: they see
 * their reporting line's days, not the whole workspace's, and their approval of
 * an early check-out is final — the employee then checks out with their face.
 */
const suffix = randomBytes(4).toString('hex');
const WHO = ['manager', 'rep', 'outsider'] as const;
type Who = (typeof WHO)[number];

let tenantId = '';
const people = {} as Record<Who, { userId: string; employeeId: string }>;
const teamApprover = new Map([
  ['attendance:VIEW', 'TEAM'],
  ['attendance:APPROVE', 'TEAM'],
]) as PermissionMap;
const ctxOf = (who: Who, permissions = new Map() as PermissionMap) =>
  buildCtx(buildActor({ id: people[who].userId, tenantId, permissions }));

/** Whose days on record this actor's attendance scope returns. */
const visible = async (ctx: Ctx) =>
  (
    await prisma.hrAttendanceRecord.findMany({
      where: { tenantId, ...(await attendanceScope(ctx)) },
      select: { employeeId: true },
    })
  )
    .map((row) => row.employeeId)
    .sort();

beforeAll(async () => {
  tenantId = (
    await prisma.tenant.create({
      data: { slug: `attmgr-${suffix}`, legalName: 'Att Mgr LLC', displayName: 'Att Mgr', status: 'ACTIVE' },
    })
  ).id;
  const role = await prisma.role.create({
    data: { tenantId, key: `staff-${suffix}`, name: 'Staff', rank: 60, defaultScope: 'OWN' },
  });
  let managerMembershipId: string | null = null;
  for (const who of WHO) {
    const user = await createWorkspaceUser({
      tenantId,
      roleId: role.id,
      email: `${who}-${suffix}@example.com`,
      fullName: `${who} ${suffix}`,
    });
    const profile = await prisma.employeeProfile.create({
      data: {
        tenantId,
        membershipId: user.membershipId,
        employeeNumber: `AM-${who}-${suffix}`,
        employmentStatus: 'ACTIVE',
        // The rep reports to the manager; the outsider reports to nobody here.
        managerMembershipId: who === 'rep' ? managerMembershipId : null,
      },
    });
    if (who === 'manager') managerMembershipId = user.membershipId;
    people[who] = { userId: user.id, employeeId: profile.id };
    await prisma.hrAttendanceRecord.create({ data: { tenantId, employeeId: profile.id, workDate: new Date() } });
  }
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('whose attendance a manager sees', () => {
  it('a manager who approves attendance sees their reporting line, not the whole workspace', async () => {
    expect(await visible(ctxOf('manager', teamApprover))).toEqual(
      [people.manager.employeeId, people.rep.employeeId].sort(),
    );
  });

  it('an organisation-wide reader sees everyone, and anyone else only themselves', async () => {
    const orgWide = buildCtx(buildActor({ id: people.manager.userId, tenantId, grants: [['employee', 'VIEW']] }));
    expect(await visible(orgWide)).toHaveLength(WHO.length);
    expect(await visible(ctxOf('outsider'))).toEqual([people.outsider.employeeId]);
  });
});

describe('an early check-out', () => {
  const ask = (who: Who, reasonCode = 'work_pending', requestedAction: 'CHECK_IN' | 'CHECK_OUT' = 'CHECK_OUT') =>
    requestAttendanceException(ctxOf(who), { requestedAction, requestedFor: new Date(), reasonCode });

  it("is final on the line manager's approval, and writes no punch for the employee", async () => {
    const request = await ask('rep');
    const decided = await decideAttendanceException(
      ctxOf('manager', teamApprover),
      request.id,
      true,
      'Viewing ran over',
    );
    expect(decided.status).toBe('APPROVED');
    expect(decided.createdPunchId).toBeNull();
    expect(
      await prisma.hrAttendancePunch.count({
        where: { tenantId, employeeId: people.rep.employeeId, method: 'exception' },
      }),
    ).toBe(0);
  });

  it("cannot be decided by a manager outside the employee's reporting line", async () => {
    const request = await ask('outsider');
    await expect(
      decideAttendanceException(ctxOf('manager', teamApprover), request.id, true, 'Not my report'),
    ).rejects.toThrow(/line manager/);
  });

  it('leaves every other exception on two stages: the manager endorses, then HR decides', async () => {
    const request = await ask('rep', 'gps_failure', 'CHECK_IN');
    const endorsed = await decideAttendanceException(ctxOf('manager', teamApprover), request.id, true, 'Was with me');
    expect(endorsed.status).toBe('PENDING_HR');
  });
});
