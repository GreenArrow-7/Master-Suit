/**
 * The punch sequence rules, driven against real rows.
 *
 * The pure helpers (geofence maths, opening hours, candidate filtering) are
 * covered in attendance.spec.ts; what lives here is the ordering validatePunch
 * imposes on top of them — you cannot check in twice, you cannot check out of
 * nothing, a SAME_LOCATION assignment refuses a check-out elsewhere, and the
 * accuracy gate fires before the geofence verdict. Each refusal carries the
 * machine code the punch log records.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { PunchRejected, validatePunch } from '@/services/hr/attendance';
import { buildActor, buildCtx } from '../helpers/ctx';

const suffix = randomBytes(4).toString('hex');

// Two fences ~1.9 km apart in Dubai; GPS positions used below sit inside one
// or the other, or far from both.
const HQ = { latitude: 25.2048, longitude: 55.2708 };
const BRANCH = { latitude: 25.2215, longitude: 55.2758 };
const FAR = { latitude: 25.3, longitude: 55.4 };

let tenantId = '';
let employee: { id: string; employmentStatus: string };
let hqId = '';
let branchId = '';

const ctx = () => buildCtx(buildActor({ id: `actor-${suffix}`, tenantId }));

const expectRejection = async (run: Promise<unknown>, code: string) => {
  try {
    await run;
    expect.fail(`expected PunchRejected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(PunchRejected);
    expect((error as PunchRejected).code).toBe(code);
  }
};

const position = (at: { latitude: number; longitude: number }, gpsAccuracyM = 10) => ({ ...at, gpsAccuracyM });

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: {
      slug: `punchseq-${suffix}`,
      legalName: 'PunchSeq LLC',
      displayName: 'PunchSeq',
      status: 'ACTIVE',
    },
  });
  tenantId = tenant.id;

  const platformUser = await prisma.platformUser.create({
    data: {
      email: `punch-${suffix}@seq.test`,
      normalizedEmail: `punch-${suffix}@seq.test`,
      fullName: 'Punch Tester',
      status: 'ACTIVE',
    },
  });
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  const profile = await prisma.employeeProfile.create({
    data: { tenantId, membershipId: membership.id, employeeNumber: `PS-${suffix}`, employmentStatus: 'ACTIVE' },
  });
  employee = { id: profile.id, employmentStatus: profile.employmentStatus };

  const hq = await prisma.hrWorkLocation.create({
    data: { tenantId, name: `HQ ${suffix}`, ...HQ, radiusMeters: 150, status: 'ACTIVE' },
  });
  hqId = hq.id;
  const branch = await prisma.hrWorkLocation.create({
    data: { tenantId, name: `Branch ${suffix}`, ...BRANCH, radiusMeters: 150, status: 'ACTIVE' },
  });
  branchId = branch.id;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

/** The accepted punch that opens (or closes) a shift, written as the app would. */
function acceptedPunch(punchType: 'CHECK_IN' | 'CHECK_OUT', locationId: string) {
  return prisma.hrAttendancePunch.create({
    data: {
      tenantId,
      employeeId: employee.id,
      punchType,
      result: 'ACCEPTED',
      method: 'face',
      ...HQ,
      gpsAccuracyM: 8,
      deviceFingerprint: 'seq-device',
      locationId,
    },
  });
}

describe('validatePunch sequencing', () => {
  it('refuses a check-in with no assignment at all: NO_ACTIVE_ASSIGNMENT', async () => {
    await expectRejection(validatePunch(ctx(), employee, 'CHECK_IN', position(HQ)), 'NO_ACTIVE_ASSIGNMENT');
  });

  it('refuses a position outside every assigned fence: OUTSIDE_APPROVED_LOCATION', async () => {
    await prisma.hrEmployeeLocationAssignment.create({
      data: { tenantId, employeeId: employee.id, locationId: hqId, status: 'ACTIVE', checkoutRule: 'SAME_LOCATION' },
    });
    await expectRejection(validatePunch(ctx(), employee, 'CHECK_IN', position(FAR)), 'OUTSIDE_APPROVED_LOCATION');
  });

  it('refuses a weak GPS fix before measuring the fence: LOCATION_ACCURACY_TOO_LOW', async () => {
    await expectRejection(validatePunch(ctx(), employee, 'CHECK_IN', position(HQ, 5_000)), 'LOCATION_ACCURACY_TOO_LOW');
  });

  it('refuses a check-out when nothing is open: NO_OPEN_CHECKIN', async () => {
    await expectRejection(validatePunch(ctx(), employee, 'CHECK_OUT', position(HQ)), 'NO_OPEN_CHECKIN');
  });

  it('accepts a good check-in inside the fence', async () => {
    const context = await validatePunch(ctx(), employee, 'CHECK_IN', position(HQ));
    expect(context.inside).toBe(true);
    expect(context.assignment.locationId).toBe(hqId);
    expect(context.distanceM).toBeLessThan(150);
  });

  it('refuses a second check-in while one is open: ALREADY_CHECKED_IN', async () => {
    await acceptedPunch('CHECK_IN', hqId);
    await expectRejection(validatePunch(ctx(), employee, 'CHECK_IN', position(HQ)), 'ALREADY_CHECKED_IN');
  });

  it('refuses a SAME_LOCATION check-out from a different fence: CHECKOUT_WRONG_LOCATION', async () => {
    // Assigned to the branch too, standing inside it — but the open check-in
    // was at HQ and its rule pins the check-out there.
    await prisma.hrEmployeeLocationAssignment.create({
      data: {
        tenantId,
        employeeId: employee.id,
        locationId: branchId,
        status: 'ACTIVE',
        checkoutRule: 'SAME_LOCATION',
      },
    });
    await prisma.hrEmployeeLocationAssignment.updateMany({
      where: { tenantId, employeeId: employee.id, locationId: hqId },
      data: { status: 'REVOKED' },
    });
    await expectRejection(validatePunch(ctx(), employee, 'CHECK_OUT', position(BRANCH)), 'CHECKOUT_WRONG_LOCATION');
  });

  it('accepts the check-out back inside the original fence', async () => {
    await prisma.hrEmployeeLocationAssignment.updateMany({
      where: { tenantId, employeeId: employee.id, locationId: hqId },
      data: { status: 'ACTIVE' },
    });
    const context = await validatePunch(ctx(), employee, 'CHECK_OUT', position(HQ));
    expect(context.inside).toBe(true);
    expect(context.assignment.locationId).toBe(hqId);
  });

  it('refuses an EXCEPTION_ONLY assignment outright: CHECKOUT_REQUIRES_EXCEPTION', async () => {
    await prisma.hrEmployeeLocationAssignment.updateMany({
      where: { tenantId, employeeId: employee.id, locationId: hqId },
      data: { checkoutRule: 'EXCEPTION_ONLY' },
    });
    await expectRejection(validatePunch(ctx(), employee, 'CHECK_OUT', position(HQ)), 'CHECKOUT_REQUIRES_EXCEPTION');
  });

  it('refuses an employee with no active employment: EMPLOYMENT_INACTIVE', async () => {
    await expectRejection(
      validatePunch(ctx(), { ...employee, employmentStatus: 'EXITED' }, 'CHECK_IN', position(HQ)),
      'EMPLOYMENT_INACTIVE',
    );
  });
});
