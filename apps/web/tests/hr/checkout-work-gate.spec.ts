import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { pendingLeadWork, startOfLocalDay, validatePunch } from '@/services/hr/attendance';
import { DEFAULT_POLICY } from '@/services/hr/settings';
import { dailyTargetShortfall } from '@/services/targets/dailyBoard';
import { buildActor, buildCtx } from '../helpers/ctx';

/**
 * §5: a seller handed leads today cannot check out while any is untouched — when
 * the workspace turns the rule on — and an approved WORK_PENDING exception lets
 * a manager override it for the day. The sibling rule holds the check-out while
 * today's lead-calling target is short, counted from the calls themselves.
 */
const suffix = randomBytes(4).toString('hex');
const HQ = { latitude: 25.2048, longitude: 55.2708 };
let tenantId = '';
let userId = '';
let employee: { id: string; employmentStatus: string };

const ctx = () => buildCtx(buildActor({ id: userId, tenantId }));
const position = { ...HQ, gpsAccuracyM: 8 };
const gated = { ...DEFAULT_POLICY, checkoutRequiresLeadWork: true };

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `workgate-${suffix}`, legalName: 'WorkGate LLC', displayName: 'WorkGate', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({
    data: { tenantId, key: `rep-${suffix}`, name: 'Rep', rank: 60, defaultScope: 'OWN' },
  });
  const user = await prisma.user.create({
    data: { tenantId, email: `rep-${suffix}@example.com`, fullName: 'Gate Rep', roleId: role.id, status: 'ACTIVE' },
  });
  userId = user.id;
  const platformUser = await prisma.platformUser.create({
    data: {
      email: `rep-${suffix}@example.com`,
      normalizedEmail: `rep-${suffix}@example.com`,
      fullName: 'Gate Rep',
      status: 'ACTIVE',
    },
  });
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  const profile = await prisma.employeeProfile.create({
    data: { tenantId, membershipId: membership.id, employeeNumber: `WG-${suffix}`, employmentStatus: 'ACTIVE' },
  });
  employee = { id: profile.id, employmentStatus: profile.employmentStatus };
  const hq = await prisma.hrWorkLocation.create({
    data: { tenantId, name: `HQ ${suffix}`, ...HQ, radiusMeters: 150, status: 'ACTIVE' },
  });

  await prisma.hrEmployeeLocationAssignment.create({
    data: { tenantId, employeeId: profile.id, locationId: hq.id, status: 'ACTIVE', checkInAllowed: true },
  });
  await prisma.hrAttendancePunch.create({
    data: {
      tenantId,
      employeeId: profile.id,
      punchType: 'CHECK_IN',
      result: 'ACCEPTED',
      method: 'face',
      ...HQ,
      gpsAccuracyM: 8,
      deviceFingerprint: 'gate-device',
      locationId: hq.id,
    },
  });
  const stage = await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', position: 0, isDefault: true },
  });
  const now = new Date();
  await prisma.lead.createMany({
    data: [1, 2].map((n) => ({
      tenantId,
      reference: `WG-${suffix}-${n}`,
      fullName: `Lead ${n}`,
      stageId: stage.id,
      ownerId: user.id,
      assignedAt: now,
    })),
  });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('work-gated check-out', () => {
  it('startOfLocalDay is midnight in the workspace zone', () => {
    const start = startOfLocalDay(new Date('2026-09-19T10:00:00Z'), 'Asia/Dubai');
    expect(start.toISOString()).toBe('2026-09-18T20:00:00.000Z');
  });

  it("counts today's untouched leads and refuses the check-out while any remain", async () => {
    expect(await pendingLeadWork(ctx(), 'Asia/Dubai')).toBe(2);
    await expect(validatePunch(ctx(), employee, 'CHECK_OUT', position, true, gated)).rejects.toMatchObject({
      code: 'WORK_PENDING',
    });
    // Off by default: the same check-out passes without the rule.
    await expect(validatePunch(ctx(), employee, 'CHECK_OUT', position, true, DEFAULT_POLICY)).resolves.toBeTruthy();
  });

  it("holds the check-out while today's lead-calling target is short", async () => {
    const targeted = { ...DEFAULT_POLICY, checkoutRequiresDailyTarget: true };
    const midnight = startOfLocalDay(new Date(), 'UTC');
    await prisma.employeeTarget.create({
      data: {
        tenantId,
        userId,
        metric: 'LEADS_CALLED',
        period: 'DAILY',
        targetValue: 2,
        periodStart: midnight,
        periodEnd: new Date(midnight.getTime() + 24 * 60 * 60 * 1000 - 1),
      },
    });
    expect(await dailyTargetShortfall(ctx(), userId), 'two leads to call, none called').toBe(2);
    await expect(validatePunch(ctx(), employee, 'CHECK_OUT', position, true, targeted)).rejects.toMatchObject({
      code: 'WORK_PENDING',
    });

    // One lead called: the shortfall falls, the gate still holds.
    const leads = await prisma.lead.findMany({ where: { tenantId, ownerId: userId }, select: { id: true } });
    await prisma.call.create({
      data: {
        tenantId,
        callerId: userId,
        leadId: leads[0]!.id,
        status: 'COMPLETED',
        outcome: 'INTERESTED',
        durationSecs: 120,
      },
    });
    expect(await dailyTargetShortfall(ctx(), userId)).toBe(1);
    await expect(validatePunch(ctx(), employee, 'CHECK_OUT', position, true, targeted)).rejects.toMatchObject({
      code: 'WORK_PENDING',
    });

    // The target met by the day's calls, the check-out goes through.
    await prisma.call.create({
      data: { tenantId, callerId: userId, leadId: leads[1]!.id, status: 'COMPLETED', outcome: 'NO_ANSWER' },
    });
    expect(await dailyTargetShortfall(ctx(), userId)).toBe(0);
    await expect(validatePunch(ctx(), employee, 'CHECK_OUT', position, true, targeted)).resolves.toBeTruthy();
    // Off by default: the same check-out never consults the target.
    await expect(validatePunch(ctx(), employee, 'CHECK_OUT', position, true, DEFAULT_POLICY)).resolves.toBeTruthy();
  });

  it('lets the check-out through once the leads are worked, or on an approved exception', async () => {
    const later = new Date(Date.now() + 1000);
    await prisma.lead.updateMany({ where: { tenantId, ownerId: userId }, data: { lastActivityAt: later } });
    expect(await pendingLeadWork(ctx(), 'Asia/Dubai')).toBe(0);
    await expect(validatePunch(ctx(), employee, 'CHECK_OUT', position, true, gated)).resolves.toBeTruthy();

    // Back to untouched, but a manager approved an exception for today.
    await prisma.lead.updateMany({ where: { tenantId, ownerId: userId }, data: { lastActivityAt: null } });
    await prisma.hrAttendanceExceptionRequest.create({
      data: {
        tenantId,
        employeeId: employee.id,
        requestedAction: 'CHECK_OUT',
        requestedFor: new Date(),
        reasonCode: 'work_pending',
        status: 'APPROVED',
      },
    });
    await expect(validatePunch(ctx(), employee, 'CHECK_OUT', position, true, gated)).resolves.toBeTruthy();
  });
});
