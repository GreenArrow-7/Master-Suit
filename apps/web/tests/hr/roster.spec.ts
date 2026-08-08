/**
 * Rostering: the conflict rules, and the swap that must move both sides or
 * neither.
 *
 * A roster is almost always built by copying a week forward, and copying is
 * exactly how a schedule quietly breaches a rest-day entitlement — nobody
 * re-reads six weeks of history before dragging a shift. So the pure block
 * concentrates on the checks that catch that, and the database block proves the
 * bulk paths apply the same checks the single path does.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  assignShift,
  bulkAssign,
  conflictsFor,
  consecutiveRunIncluding,
  copyWeek,
  decideShiftChange,
  removeRosterEntry,
  requestShiftChange,
  restHoursBetween,
  rosterFor,
  shiftWindow,
  windowsOverlap,
} from '@/services/hr/roster';
import { DEFAULT_POLICY } from '@/services/hr/settings';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { PermissionMap } from '@/lib/security/rbac';

const day = (value: string) => new Date(`${value}T00:00:00Z`);

// ── Pure scheduling arithmetic ─────────────────────────────────────────────

describe('shiftWindow', () => {
  it('places an ordinary day shift inside its date', () => {
    const window = shiftWindow(day('2026-03-02'), '09:00', '17:00')!;
    expect(new Date(window.start).toISOString()).toBe('2026-03-02T09:00:00.000Z');
    expect(new Date(window.end).toISOString()).toBe('2026-03-02T17:00:00.000Z');
  });

  it('carries an overnight shift into the following day', () => {
    // Without this a 22:00–06:00 shift is a negative-length event and never
    // overlaps anything, so a night worker can be double-booked freely.
    const window = shiftWindow(day('2026-03-02'), '22:00', '06:00')!;
    expect(new Date(window.end).toISOString()).toBe('2026-03-03T06:00:00.000Z');
  });

  it('refuses an unreadable time', () => {
    expect(shiftWindow(day('2026-03-02'), 'evening', '17:00')).toBeNull();
  });
});

describe('windowsOverlap and restHoursBetween', () => {
  it('detects an overlap across midnight', () => {
    const night = shiftWindow(day('2026-03-02'), '22:00', '06:00')!;
    const early = shiftWindow(day('2026-03-03'), '05:00', '13:00')!;
    expect(windowsOverlap(night, early)).toBe(true);
  });

  it('measures the gap between consecutive shifts', () => {
    const late = shiftWindow(day('2026-03-02'), '14:00', '22:00')!;
    const early = shiftWindow(day('2026-03-03'), '06:00', '14:00')!;
    expect(restHoursBetween(late, early)).toBe(8);
  });
});

describe('consecutiveRunIncluding', () => {
  const entry = (date: string) => ({ workDate: day(date), shiftId: 's', startTime: '09:00', endTime: '17:00' });

  it('counts the run a new day would join, in both directions', () => {
    const existing = ['2026-03-02', '2026-03-03', '2026-03-05', '2026-03-06'].map(entry);
    // Filling the 4th joins two runs of two into one of five.
    expect(consecutiveRunIncluding(day('2026-03-04'), existing)).toBe(5);
  });

  it('counts an isolated day as one', () => {
    expect(consecutiveRunIncluding(day('2026-03-20'), [entry('2026-03-02')])).toBe(1);
  });
});

describe('conflictsFor', () => {
  const base = {
    workDate: day('2026-03-04'),
    shiftId: 'shift-a',
    startTime: '09:00',
    endTime: '17:00',
    shiftActive: true,
    shiftWorkingDays: [] as number[],
    existing: [] as { workDate: Date; shiftId: string; startTime: string; endTime: string }[],
    leaveDays: new Set<string>(),
    policy: DEFAULT_POLICY,
  };

  const codes = (input: Partial<typeof base>) =>
    conflictsFor({ ...base, ...input }).map((conflict) => conflict.code);

  it('accepts a clean assignment', () => {
    expect(codes({})).toEqual([]);
  });

  it('refuses the same shift twice on one day', () => {
    expect(codes({ existing: [{ workDate: day('2026-03-04'), shiftId: 'shift-a', startTime: '09:00', endTime: '17:00' }] })).toContain(
      'DUPLICATE',
    );
  });

  it('refuses a second shift that overlaps the first', () => {
    expect(
      codes({ existing: [{ workDate: day('2026-03-04'), shiftId: 'shift-b', startTime: '13:00', endTime: '21:00' }] }),
    ).toContain('OVERLAP');
  });

  it('allows a genuine split shift with enough rest between the halves', () => {
    // 09:00–17:00 then 04:00–08:00 the same day is 11 h of rest, which the
    // default policy permits: a split shift is legitimate, an overlap is not.
    expect(
      codes({
        startTime: '18:00',
        endTime: '22:00',
        existing: [{ workDate: day('2026-03-04'), shiftId: 'shift-b', startTime: '01:00', endTime: '07:00' }],
      }),
    ).toEqual([]);
  });

  it('refuses too little rest after the previous evening', () => {
    expect(
      codes({
        startTime: '06:00',
        endTime: '14:00',
        existing: [{ workDate: day('2026-03-03'), shiftId: 'shift-b', startTime: '14:00', endTime: '22:00' }],
      }),
    ).toContain('INSUFFICIENT_REST');
  });

  it('refuses a seventh consecutive day', () => {
    const existing = ['2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03'].map(
      (date) => ({ workDate: day(date), shiftId: 'shift-a', startTime: '09:00', endTime: '17:00' }),
    );
    expect(codes({ existing })).toContain('TOO_MANY_CONSECUTIVE');
  });

  it('refuses rostering over approved leave, unless the workspace allows it', () => {
    expect(codes({ leaveDays: new Set(['2026-03-04']) })).toContain('ON_LEAVE');
    expect(
      codes({ leaveDays: new Set(['2026-03-04']), policy: { ...DEFAULT_POLICY, rosterBlockOnLeave: false } }),
    ).not.toContain('ON_LEAVE');
  });

  it('refuses a retired shift and a day the shift does not run', () => {
    expect(codes({ shiftActive: false })).toContain('SHIFT_INACTIVE');
    // 2026-03-04 is a Wednesday (3); this shift runs Sunday and Monday only.
    expect(codes({ shiftWorkingDays: [0, 1] })).toContain('NOT_A_WORKING_DAY');
  });

  it('reports each distinct reason once, not once per collision', () => {
    const existing = [
      { workDate: day('2026-03-04'), shiftId: 'shift-b', startTime: '10:00', endTime: '12:00' },
      { workDate: day('2026-03-04'), shiftId: 'shift-c', startTime: '14:00', endTime: '16:00' },
    ];
    expect(codes({ existing }).filter((code) => code === 'OVERLAP')).toHaveLength(1);
  });
});

// ── Workflow, against the real database ────────────────────────────────────

const suffix = randomBytes(4).toString('hex');
const slug = `roster-${suffix}`;

let tenantId = '';
const employees: Record<string, string> = {};
const userIds: Record<string, string> = {};
const shifts: Record<string, string> = {};

const permissions = (grants: readonly (readonly [string, string])[]) =>
  new Map(grants.map(([module, action]) => [`${module}:${action}`, 'ORGANIZATION'])) as PermissionMap;

const ctxFor = (label: string, grants: readonly (readonly [string, string])[]) =>
  buildCtx(buildActor({ id: userIds[label]!, tenantId, permissions: permissions(grants) }));

const PLANNER = [
  ['shifts', 'EDIT'],
  ['shifts', 'APPROVE'],
  ['employee', 'VIEW'],
] as const;
const STAFF = [['employee', 'VIEW']] as const;

async function makeEmployee(label: string) {
  const email = `${label}-${suffix}@roster.test`;
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: label, status: 'ACTIVE' },
  });
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
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Roster LLC', displayName: 'Roster', status: 'ACTIVE', timezone: 'Asia/Dubai' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });
  await makeEmployee('amina');
  await makeEmployee('bilal');
  await makeEmployee('planner');

  for (const [key, code, startTime, endTime] of [
    ['early', 'EARLY', '06:00', '14:00'],
    ['late', 'LATE', '14:00', '22:00'],
    ['night', 'NIGHT', '22:00', '06:00'],
  ] as const) {
    const shift = await prisma.hrShift.create({
      data: { tenantId, name: key, code: `${code}-${suffix}`, startTime, endTime, isActive: true },
    });
    shifts[key] = shift.id;
  }
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('assigning', () => {
  it('places a shift and refuses the same one twice', async () => {
    const ctx = ctxFor('planner', PLANNER);
    const entry = await assignShift(ctx, {
      employeeId: employees.amina!,
      shiftId: shifts.early!,
      workDate: day('2026-04-06'),
    });
    expect(entry.source).toBe('ROSTER');

    await expect(
      assignShift(ctx, { employeeId: employees.amina!, shiftId: shifts.early!, workDate: day('2026-04-06') }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a late shift the evening before an early one', async () => {
    // EARLY on the 6th already exists, so LATE on the 5th leaves 8 h of rest.
    await expect(
      assignShift(ctxFor('planner', PLANNER), {
        employeeId: employees.amina!,
        shiftId: shifts.late!,
        workDate: day('2026-04-05'),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses rostering over approved leave', async () => {
    const leaveType = await prisma.hrLeaveType.create({
      data: { tenantId, name: 'Annual', code: `ANN-${suffix}`, annualAllowance: 30, paid: true },
    });
    await prisma.hrLeaveRequest.create({
      data: {
        tenantId,
        employeeId: employees.bilal!,
        leaveTypeId: leaveType.id,
        startDate: day('2026-04-20'),
        endDate: day('2026-04-22'),
        days: 3,
        status: 'APPROVED',
      },
    });

    await expect(
      assignShift(ctxFor('planner', PLANNER), {
        employeeId: employees.bilal!,
        shiftId: shifts.early!,
        workDate: day('2026-04-21'),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses someone without planning rights', async () => {
    await expect(
      assignShift(ctxFor('amina', STAFF), {
        employeeId: employees.amina!,
        shiftId: shifts.early!,
        workDate: day('2026-05-01'),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('bulk assigning', () => {
  it('breaks a long stretch with a rest day rather than refusing the rest of it', async () => {
    // Ten days requested. The check sees the streak the loop is itself building,
    // so day seven is refused — and then day eight starts a fresh run and is
    // placed. The result is 6 on, 1 off, 3 on: nine shifts, no run over the
    // ceiling. Refusing everything after day six would be the lazier behaviour
    // and the wrong one, because the days after the rest day are perfectly legal.
    const result = await bulkAssign(ctxFor('planner', PLANNER), {
      employeeIds: [employees.bilal!],
      shiftId: shifts.late!,
      from: day('2026-06-01'),
      to: day('2026-06-10'),
    });
    expect(result.created).toBe(9);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reasons).toContain('TOO_MANY_CONSECUTIVE');

    // The property that actually matters: no run exceeds the ceiling.
    const rows = await prisma.hrRosterEntry.findMany({
      where: { tenantId, employeeId: employees.bilal!, workDate: { gte: day('2026-06-01'), lte: day('2026-06-10') } },
      orderBy: { workDate: 'asc' },
    });
    let longest = 0;
    let run = 0;
    let previous = 0;
    for (const row of rows) {
      const today = row.workDate.getTime();
      run = previous && today - previous === 86_400_000 ? run + 1 : 1;
      longest = Math.max(longest, run);
      previous = today;
    }
    expect(longest).toBeLessThanOrEqual(DEFAULT_POLICY.rosterMaxConsecutiveDays);
  });

  it('fills only the weekdays asked for', async () => {
    const result = await bulkAssign(ctxFor('planner', PLANNER), {
      employeeIds: [employees.amina!],
      shiftId: shifts.late!,
      from: day('2026-07-01'),
      to: day('2026-07-31'),
      weekdays: [1], // Mondays
    });
    expect(result.created).toBe(4);
    const rows = await prisma.hrRosterEntry.findMany({
      where: { tenantId, employeeId: employees.amina!, workDate: { gte: day('2026-07-01'), lte: day('2026-07-31') } },
    });
    expect(rows.every((row) => row.workDate.getUTCDay() === 1)).toBe(true);
  });

  it('reports what it skipped rather than refusing everything', async () => {
    const result = await bulkAssign(ctxFor('planner', PLANNER), {
      employeeIds: [employees.bilal!],
      shiftId: shifts.early!,
      from: day('2026-04-19'),
      to: day('2026-04-23'),
    });
    // The 20th to 22nd are approved leave; the rest still get placed.
    expect(result.created).toBeGreaterThan(0);
    expect(result.skipped.some((row) => row.reasons.includes('ON_LEAVE'))).toBe(true);
  });
});

describe('copying a week', () => {
  it('carries the shape of one week onto another', async () => {
    const ctx = ctxFor('planner', PLANNER);
    await bulkAssign(ctx, {
      employeeIds: [employees.amina!],
      shiftId: shifts.night!,
      from: day('2026-09-07'),
      to: day('2026-09-09'),
    });

    const result = await copyWeek(ctx, {
      fromWeekStart: day('2026-09-07'),
      toWeekStart: day('2026-09-14'),
      employeeIds: [employees.amina!],
    });
    expect(result.created).toBe(3);

    const copied = await prisma.hrRosterEntry.findMany({
      where: { tenantId, employeeId: employees.amina!, workDate: { gte: day('2026-09-14'), lte: day('2026-09-20') } },
    });
    expect(copied).toHaveLength(3);
    expect(copied.map((row) => row.workDate.getUTCDay()).sort()).toEqual([1, 2, 3]);
  });

  it('refuses to copy a week with nothing in it', async () => {
    await expect(
      copyWeek(ctxFor('planner', PLANNER), { fromWeekStart: day('2027-01-04'), toWeekStart: day('2027-01-11') }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('visibility', () => {
  it('shows an employee only their own roster', async () => {
    const mine = await rosterFor(ctxFor('amina', STAFF), { from: day('2026-01-01'), to: day('2026-12-31') });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((entry) => entry.employeeId === employees.amina)).toBe(true);
  });

  it('refuses an employee asking for a colleague’s', async () => {
    await expect(
      rosterFor(ctxFor('amina', STAFF), { from: day('2026-01-01'), to: day('2026-12-31'), employeeId: employees.bilal }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('shift change and swap', () => {
  it('moves a swap on both sides, or not at all', async () => {
    const ctx = ctxFor('planner', PLANNER);
    const aminaEntry = await assignShift(ctx, {
      employeeId: employees.amina!,
      shiftId: shifts.early!,
      workDate: day('2026-11-02'),
    });
    const bilalEntry = await assignShift(ctx, {
      employeeId: employees.bilal!,
      shiftId: shifts.late!,
      workDate: day('2026-11-03'),
    });

    const request = await requestShiftChange(ctxFor('amina', STAFF), {
      entryId: aminaEntry.id,
      counterpartEntryId: bilalEntry.id,
      reason: 'Family commitment',
    });
    expect(request.kind).toBe('SWAP');

    await decideShiftChange(ctx, request.id, true);

    const [movedA, movedB] = await Promise.all([
      prisma.hrRosterEntry.findFirstOrThrow({ where: { tenantId, id: aminaEntry.id } }),
      prisma.hrRosterEntry.findFirstOrThrow({ where: { tenantId, id: bilalEntry.id } }),
    ]);
    // Each keeps their own date and takes the other's shift.
    expect(movedA.employeeId).toBe(employees.bilal);
    expect(movedB.employeeId).toBe(employees.amina);
    expect(movedA.source).toBe('SWAP');
  });

  it('refuses a swap whose other side has since been un-rostered', async () => {
    const ctx = ctxFor('planner', PLANNER);
    const mine = await assignShift(ctx, {
      employeeId: employees.amina!,
      shiftId: shifts.early!,
      workDate: day('2026-12-07'),
    });
    const theirs = await assignShift(ctx, {
      employeeId: employees.bilal!,
      shiftId: shifts.late!,
      workDate: day('2026-12-08'),
    });
    const request = await requestShiftChange(ctxFor('amina', STAFF), {
      entryId: mine.id,
      counterpartEntryId: theirs.id,
      reason: 'Swap please',
    });

    await removeRosterEntry(ctx, theirs.id);
    await expect(decideShiftChange(ctx, request.id, true)).rejects.toMatchObject({ status: 409 });

    // And the requester's own day is untouched by the failed approval.
    const untouched = await prisma.hrRosterEntry.findFirstOrThrow({ where: { tenantId, id: mine.id } });
    expect(untouched.employeeId).toBe(employees.amina);
  });

  it('moves a plain change onto the requested shift', async () => {
    const ctx = ctxFor('planner', PLANNER);
    const entry = await assignShift(ctx, {
      employeeId: employees.amina!,
      shiftId: shifts.early!,
      workDate: day('2026-12-14'),
    });
    const request = await requestShiftChange(ctxFor('amina', STAFF), {
      entryId: entry.id,
      requestedShiftId: shifts.late!,
      reason: 'Appointment in the morning',
    });
    await decideShiftChange(ctx, request.id, true);

    const moved = await prisma.hrRosterEntry.findFirstOrThrow({ where: { tenantId, id: entry.id } });
    expect(moved.shiftId).toBe(shifts.late);
    expect(moved.source).toBe('OVERRIDE');
  });

  it('refuses a request against somebody else’s rostered day', async () => {
    const entry = await prisma.hrRosterEntry.findFirstOrThrow({
      where: { tenantId, employeeId: employees.bilal! },
    });
    await expect(
      requestShiftChange(ctxFor('amina', STAFF), {
        entryId: entry.id,
        requestedShiftId: shifts.late!,
        reason: 'Not mine',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses to let the requester decide their own', async () => {
    const ctx = ctxFor('planner', PLANNER);
    const entry = await assignShift(ctx, {
      employeeId: employees.planner!,
      shiftId: shifts.early!,
      workDate: day('2026-12-21'),
    });
    const request = await requestShiftChange(ctxFor('planner', PLANNER), {
      entryId: entry.id,
      requestedShiftId: shifts.late!,
      reason: 'Own request',
    });
    await expect(decideShiftChange(ctxFor('planner', PLANNER), request.id, true)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('refuses a request naming both a shift and a swap', async () => {
    const entry = await prisma.hrRosterEntry.findFirstOrThrow({
      where: { tenantId, employeeId: employees.amina! },
    });
    await expect(
      requestShiftChange(ctxFor('amina', STAFF), {
        entryId: entry.id,
        requestedShiftId: shifts.late!,
        counterpartEntryId: entry.id,
        reason: 'Both',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
