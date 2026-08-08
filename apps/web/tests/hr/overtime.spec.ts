/**
 * Overtime: the rate rules, and the things that must never happen.
 *
 * The pure block asserts the calculation a labour inspector would ask about —
 * overnight shift length, the night window, which rate wins when a public
 * holiday lands on a rest day.
 *
 * The database block asserts the four properties that make the module safe to
 * connect to payroll:
 *
 *   1. detection is idempotent, so re-running a scan cannot double-pay a day;
 *   2. detection never touches a claim a human already decided;
 *   3. nobody approves their own overtime;
 *   4. an approved multiplier is frozen, so a later rate change cannot restate
 *      a payout that has already been committed to.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  approvedOvertimeMinutes,
  cancelOvertime,
  classifyOvertime,
  decideOvertime,
  detectOvertime,
  isNightHour,
  listOvertime,
  multiplierFor,
  nightMinutesIn,
  requestOvertime,
  shiftMinutes,
} from '@/services/hr/overtime';
import { DEFAULT_POLICY } from '@/services/hr/settings';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { PermissionMap } from '@/lib/security/rbac';

// ── Pure calculation ───────────────────────────────────────────────────────

describe('shiftMinutes', () => {
  it('measures an ordinary day shift', () => {
    expect(shiftMinutes('09:00', '17:00')).toBe(480);
  });

  it('measures an overnight shift as eight hours, not minus sixteen', () => {
    // The regression this guards: a naive end-minus-start returns -960 here, and
    // every night-shift day then looks like fourteen hours of overtime.
    expect(shiftMinutes('22:00', '06:00')).toBe(480);
  });

  it('treats an equal start and end as a full day rather than zero', () => {
    expect(shiftMinutes('08:00', '08:00')).toBe(1440);
  });

  it('refuses a malformed time instead of guessing', () => {
    expect(shiftMinutes('9am', '17:00')).toBeNull();
    expect(shiftMinutes('25:00', '17:00')).toBeNull();
  });
});

describe('isNightHour', () => {
  it('handles a window that wraps midnight', () => {
    expect(isNightHour(23, 22, 4)).toBe(true);
    expect(isNightHour(2, 22, 4)).toBe(true);
    expect(isNightHour(4, 22, 4)).toBe(false);
    expect(isNightHour(12, 22, 4)).toBe(false);
  });

  it('handles a window that does not wrap', () => {
    expect(isNightHour(3, 1, 5)).toBe(true);
    expect(isNightHour(6, 1, 5)).toBe(false);
  });
});

describe('nightMinutesIn', () => {
  const tz = 'Asia/Dubai'; // UTC+4, no DST — arithmetic stays legible.

  it('counts only the minutes inside the window', () => {
    // 20:30 → 23:30 Dubai. The window opens at 22:00, so 90 of 180 minutes.
    const from = new Date('2026-03-10T16:30:00Z');
    const to = new Date('2026-03-10T19:30:00Z');
    expect(nightMinutesIn(from, to, tz, 22, 4)).toBe(90);
  });

  it('counts a stretch entirely outside the window as zero', () => {
    const from = new Date('2026-03-10T06:00:00Z'); // 10:00 Dubai
    const to = new Date('2026-03-10T08:00:00Z'); // 12:00 Dubai
    expect(nightMinutesIn(from, to, tz, 22, 4)).toBe(0);
  });

  it('counts a stretch entirely inside the window in full', () => {
    const from = new Date('2026-03-10T19:00:00Z'); // 23:00 Dubai
    const to = new Date('2026-03-10T20:00:00Z'); // 00:00 Dubai
    expect(nightMinutesIn(from, to, tz, 22, 4)).toBe(60);
  });

  it('returns zero for an inverted or empty interval', () => {
    const at = new Date('2026-03-10T19:00:00Z');
    expect(nightMinutesIn(at, at, tz, 22, 4)).toBe(0);
    expect(nightMinutesIn(at, new Date(at.getTime() - 3_600_000), tz, 22, 4)).toBe(0);
  });
});

describe('classifyOvertime', () => {
  const base = {
    timeZone: 'Asia/Dubai',
    weekendDays: [0, 6],
    holidayKeys: new Set<string>(),
    nightStart: 22,
    nightEnd: 4,
  };

  it('bills ordinary weekday evening work at the normal rate', () => {
    // Wednesday 18:00 → 19:00 Dubai.
    const workDate = new Date('2026-03-11T00:00:00Z');
    expect(
      classifyOvertime({
        ...base,
        workDate,
        from: new Date('2026-03-11T14:00:00Z'),
        to: new Date('2026-03-11T15:00:00Z'),
      }),
    ).toBe('NORMAL');
  });

  it('bills work mostly after 22:00 at the night rate', () => {
    // 22:00 → 23:30 Dubai: entirely inside the window.
    const workDate = new Date('2026-03-11T00:00:00Z');
    expect(
      classifyOvertime({
        ...base,
        workDate,
        from: new Date('2026-03-11T18:00:00Z'),
        to: new Date('2026-03-11T19:30:00Z'),
      }),
    ).toBe('NIGHT');
  });

  it('keeps the normal rate when only a minority of the stretch is at night', () => {
    // 20:00 → 22:30 Dubai: 30 of 150 minutes at night.
    const workDate = new Date('2026-03-11T00:00:00Z');
    expect(
      classifyOvertime({
        ...base,
        workDate,
        from: new Date('2026-03-11T16:00:00Z'),
        to: new Date('2026-03-11T18:30:00Z'),
      }),
    ).toBe('NORMAL');
  });

  it('bills rest-day work at the weekend rate', () => {
    // Saturday 2026-03-14.
    const workDate = new Date('2026-03-14T00:00:00Z');
    expect(
      classifyOvertime({
        ...base,
        workDate,
        from: new Date('2026-03-14T10:00:00Z'),
        to: new Date('2026-03-14T11:00:00Z'),
      }),
    ).toBe('WEEKEND');
  });

  it('lets a public holiday outrank a rest day', () => {
    // The precedence that matters: a holiday falling on a Saturday must pay the
    // holiday rate, not whichever rule happened to be checked first.
    const workDate = new Date('2026-03-14T00:00:00Z');
    expect(
      classifyOvertime({
        ...base,
        workDate,
        holidayKeys: new Set(['2026-03-14']),
        from: new Date('2026-03-14T10:00:00Z'),
        to: new Date('2026-03-14T11:00:00Z'),
      }),
    ).toBe('HOLIDAY');
  });
});

describe('multiplierFor', () => {
  it('maps every kind to its statutory default', () => {
    expect(multiplierFor('NORMAL', DEFAULT_POLICY)).toBe(1.25);
    expect(multiplierFor('NIGHT', DEFAULT_POLICY)).toBe(1.5);
    expect(multiplierFor('WEEKEND', DEFAULT_POLICY)).toBe(1.5);
    expect(multiplierFor('HOLIDAY', DEFAULT_POLICY)).toBe(2.5);
  });
});

// ── Workflow, against the real database ────────────────────────────────────

const suffix = randomBytes(4).toString('hex');
const slug = `ot-${suffix}`;

let tenantId = '';
const employees: Record<string, string> = {};
const userIds: Record<string, string> = {};

const permissions = (grants: readonly (readonly [string, string])[]) =>
  new Map(grants.map(([module, action]) => [`${module}:${action}`, 'ORGANIZATION'])) as PermissionMap;

/** A Ctx whose actor is backed by a real membership, so `myEmployee` resolves. */
const ctxFor = (label: string, grants: readonly (readonly [string, string])[]) =>
  buildCtx(buildActor({ id: userIds[label]!, tenantId, permissions: permissions(grants) }));

const APPROVER = [
  ['overtime', 'APPROVE'],
  ['employee', 'VIEW'],
] as const;
const STAFF = [['employee', 'VIEW']] as const;

async function makeEmployee(label: string) {
  const email = `${label}-${suffix}@overtime.test`;
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: label, status: 'ACTIVE' },
  });
  // The role is required by `User` but carries no grants here: authorization in
  // these cases comes from the Ctx built by `ctxFor`, so each test states the
  // permissions it is exercising instead of inheriting them from a fixture.
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: 'ORGANIZATION' },
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
    },
  });
  employees[label] = employee.id;
  userIds[label] = user.id;
  return employee.id;
}

/** A closed attendance day of `worked` minutes on `day`. */
async function attendanceDay(label: string, day: string, worked: number) {
  const checkInAt = new Date(`${day}T04:00:00Z`);
  return prisma.hrAttendanceRecord.create({
    data: {
      tenantId,
      employeeId: employees[label]!,
      workDate: new Date(`${day}T00:00:00Z`),
      checkInAt,
      checkOutAt: new Date(checkInAt.getTime() + worked * 60_000),
      workMinutes: worked,
      status: 'PRESENT',
    },
  });
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Overtime LLC', displayName: 'Overtime', status: 'ACTIVE', timezone: 'Asia/Dubai' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });
  await makeEmployee('worker');
  await makeEmployee('manager');
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('detection', () => {
  it('raises one claim for a day worked past the schedule, and is safe to re-run', async () => {
    await attendanceDay('worker', '2026-03-02', 600); // 10h against a default 8h day
    const ctx = ctxFor('manager', APPROVER);
    const range = { from: new Date('2026-03-02'), to: new Date('2026-03-02') };

    const first = await detectOvertime(ctx, range);
    expect(first.raised).toBe(1);

    // The property that lets a nightly job run without supervision: a second
    // scan over the same window must not stack a second claim on the day.
    const second = await detectOvertime(ctx, range);
    expect(second.raised).toBe(0);

    const rows = await prisma.hrOvertimeRequest.findMany({
      where: { tenantId, employeeId: employees.worker, workDate: new Date('2026-03-02T00:00:00Z') },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.minutes).toBe(120);
    expect(rows[0]!.status).toBe('PENDING');
  });

  it('ignores an overrun below the workspace minimum', async () => {
    await attendanceDay('worker', '2026-03-03', 490); // 10 minutes over, under the 30-minute floor
    const summary = await detectOvertime(ctxFor('manager', APPROVER), {
      from: new Date('2026-03-03'),
      to: new Date('2026-03-03'),
    });
    expect(summary.raised).toBe(0);
  });

  it('leaves a claim alone once a human has decided it', async () => {
    await attendanceDay('worker', '2026-03-04', 600);
    const ctx = ctxFor('manager', APPROVER);
    const range = { from: new Date('2026-03-04'), to: new Date('2026-03-04') };
    await detectOvertime(ctx, range);

    const claim = await prisma.hrOvertimeRequest.findFirstOrThrow({
      where: { tenantId, workDate: new Date('2026-03-04T00:00:00Z') },
    });
    await decideOvertime(ctx, claim.id, true);

    // The attendance day is then corrected downwards. Detection must not reopen
    // or restate a decision somebody already signed.
    await prisma.hrAttendanceRecord.update({
      where: { tenantId_employeeId_workDate: { tenantId, employeeId: employees.worker!, workDate: new Date('2026-03-04T00:00:00Z') } },
      data: { workMinutes: 500 },
    });
    const summary = await detectOvertime(ctx, range);
    expect(summary.updated).toBe(0);

    const after = await prisma.hrOvertimeRequest.findFirstOrThrow({ where: { tenantId, id: claim.id } });
    expect(after.status).toBe('APPROVED');
    expect(after.minutes).toBe(120);
  });

  it('withdraws a pending claim when the day it came from stops qualifying', async () => {
    await attendanceDay('worker', '2026-03-05', 600);
    const ctx = ctxFor('manager', APPROVER);
    const range = { from: new Date('2026-03-05'), to: new Date('2026-03-05') };
    await detectOvertime(ctx, range);

    await prisma.hrAttendanceRecord.update({
      where: { tenantId_employeeId_workDate: { tenantId, employeeId: employees.worker!, workDate: new Date('2026-03-05T00:00:00Z') } },
      data: { workMinutes: 480 },
    });
    const summary = await detectOvertime(ctx, range);
    expect(summary.withdrawn).toBe(1);

    const after = await prisma.hrOvertimeRequest.findFirstOrThrow({
      where: { tenantId, workDate: new Date('2026-03-05T00:00:00Z') },
    });
    expect(after.status).toBe('CANCELLED');
  });

  it('refuses to run for someone without the signing authority', async () => {
    await expect(
      detectOvertime(ctxFor('worker', STAFF), { from: new Date('2026-03-02'), to: new Date('2026-03-02') }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('claims', () => {
  it('records a manual claim with its reason', async () => {
    const claim = await requestOvertime(ctxFor('worker', STAFF), {
      workDate: new Date('2026-03-09'),
      minutes: 90,
      reason: 'Client handover ran late',
    });
    expect(claim.minutes).toBe(90);
    expect(claim.source).toBe('REQUESTED');
    expect(claim.status).toBe('PENDING');
  });

  it('refuses a second claim for the same day rather than double-counting it', async () => {
    await expect(
      requestOvertime(ctxFor('worker', STAFF), {
        workDate: new Date('2026-03-09'),
        minutes: 30,
        reason: 'Again',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a claim for a future date', async () => {
    await expect(
      requestOvertime(ctxFor('worker', STAFF), {
        workDate: new Date(Date.now() + 7 * 86_400_000),
        minutes: 60,
        reason: 'Next week',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('stops an employee raising a claim on a colleague', async () => {
    await expect(
      requestOvertime(ctxFor('worker', STAFF), {
        workDate: new Date('2026-03-10'),
        minutes: 60,
        reason: 'For the manager',
        employeeId: employees.manager,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('decisions', () => {
  it('refuses to let anyone approve their own claim', async () => {
    const claim = await requestOvertime(ctxFor('manager', APPROVER), {
      workDate: new Date('2026-03-11'),
      minutes: 60,
      reason: 'Own claim',
    });
    // The manager holds `overtime:APPROVE`. The rule is about the record, not
    // the role, so the permission check passing is not enough.
    await expect(decideOvertime(ctxFor('manager', APPROVER), claim.id, true)).rejects.toMatchObject({ status: 409 });
  });

  it('freezes the multiplier so a later rate change cannot restate the payout', async () => {
    const claim = await requestOvertime(ctxFor('worker', STAFF), {
      workDate: new Date('2026-03-12'),
      minutes: 120,
      reason: 'Deployment window',
    });
    const approved = await decideOvertime(ctxFor('manager', APPROVER), claim.id, true);
    const committed = approved.multiplier;
    expect(committed).toBeGreaterThan(0);

    // The workspace now cuts its rates. February's approved overtime must not move.
    await prisma.organizationSetting.upsert({
      where: { tenantId },
      update: { hrPolicy: { overtimeMultiplierNormal: 1, overtimeMultiplierNight: 1 } },
      create: { tenantId, hrPolicy: { overtimeMultiplierNormal: 1, overtimeMultiplierNight: 1 } },
    });

    const after = await prisma.hrOvertimeRequest.findFirstOrThrow({ where: { tenantId, id: claim.id } });
    expect(after.multiplier).toBe(committed);
  });

  it('refuses a second decision on a claim already decided', async () => {
    const claim = await requestOvertime(ctxFor('worker', STAFF), {
      workDate: new Date('2026-03-13'),
      minutes: 45,
      reason: 'Stock count',
    });
    await decideOvertime(ctxFor('manager', APPROVER), claim.id, false, { note: 'Not authorised' });
    await expect(decideOvertime(ctxFor('manager', APPROVER), claim.id, true)).rejects.toMatchObject({ status: 409 });
  });

  it('refuses to change a claim a payroll run has locked', async () => {
    const claim = await requestOvertime(ctxFor('worker', STAFF), {
      workDate: new Date('2026-03-16'),
      minutes: 60,
      reason: 'Month end',
    });
    await prisma.hrOvertimeRequest.update({ where: { tenantId, id: claim.id }, data: { lockedAt: new Date() } });

    await expect(decideOvertime(ctxFor('manager', APPROVER), claim.id, true)).rejects.toMatchObject({ status: 409 });
    await expect(cancelOvertime(ctxFor('worker', STAFF), claim.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe('visibility', () => {
  it('stops an employee reading a colleague’s claims', async () => {
    await expect(listOvertime(ctxFor('worker', STAFF), { employeeId: employees.manager })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('returns only your own claims when you cannot approve', async () => {
    const { rows } = await listOvertime(ctxFor('worker', STAFF), {});
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.employeeId === employees.worker)).toBe(true);
  });
});

describe('payroll input', () => {
  it('counts approved claims once, weighted by the rate they were approved at', async () => {
    const claim = await requestOvertime(ctxFor('worker', STAFF), {
      workDate: new Date('2026-04-06'),
      minutes: 60,
      reason: 'Release night',
    });
    const approved = await decideOvertime(ctxFor('manager', APPROVER), claim.id, true);

    const totals = await approvedOvertimeMinutes(
      ctxFor('manager', APPROVER),
      [employees.worker!],
      new Date('2026-04-01'),
      new Date('2026-04-30'),
    );
    expect(totals).toHaveLength(1);
    expect(totals[0]!.minutes).toBe(60);
    expect(totals[0]!.weightedMinutes).toBeCloseTo(60 * approved.multiplier!, 5);
  });

  it('excludes a claim settled with time off, so it is not paid twice', async () => {
    const claim = await requestOvertime(ctxFor('worker', STAFF), {
      workDate: new Date('2026-05-06'),
      minutes: 90,
      reason: 'Took the Thursday off instead',
    });
    await decideOvertime(ctxFor('manager', APPROVER), claim.id, true, { compensatory: true });

    const totals = await approvedOvertimeMinutes(
      ctxFor('manager', APPROVER),
      [employees.worker!],
      new Date('2026-05-01'),
      new Date('2026-05-31'),
    );
    expect(totals).toHaveLength(0);
  });

  it('ignores claims that were never approved', async () => {
    await requestOvertime(ctxFor('worker', STAFF), {
      workDate: new Date('2026-06-08'),
      minutes: 120,
      reason: 'Unreviewed',
    });
    const totals = await approvedOvertimeMinutes(
      ctxFor('manager', APPROVER),
      [employees.worker!],
      new Date('2026-06-01'),
      new Date('2026-06-30'),
    );
    expect(totals).toHaveLength(0);
  });
});
