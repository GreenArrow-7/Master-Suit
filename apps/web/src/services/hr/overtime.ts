/**
 * Overtime: the bridge between what the clock recorded and what payroll pays.
 *
 * The rule that shapes this whole file is §52's last line — *never automatically
 * pay questionable attendance anomalies without applicable approval*. So
 * detection and payment are deliberately separated:
 *
 *   * `detectOvertime` reads the daily roll-up, compares it with the rostered
 *     shift, and raises a PENDING claim. It pays nothing and it decides nothing.
 *   * `decideOvertime` is the only thing that makes a claim payable, and it
 *     stamps the multiplier it used onto the row at that moment.
 *   * `approvedOvertimeMinutes` is what payroll consumes. It reads APPROVED rows
 *     only, so an unreviewed queue produces an empty payroll input rather than a
 *     silently inflated one.
 *
 * Two consequences worth stating, because both were choices:
 *
 * The multiplier is snapshotted, not looked up at payslip time. A workspace that
 * lowers its weekend rate in March must not restate February's approved
 * overtime — §106 — and the only reliable way to guarantee that is to stop
 * reading the live setting once a human has committed to a number.
 *
 * Detection is idempotent by database constraint, not by convention. Re-running
 * a scan over a week already scanned updates the existing DETECTED row; it
 * cannot stack a second claim on the same day, because `@@unique([tenantId,
 * employeeId, workDate, source])` will not let it. Two scans racing each other
 * resolve to one row and one audit line.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { dayKey, toDay, zonedParts } from './rules';
import { isHrAdmin, isOvertimeAdmin, isOvertimeApprover } from './access';
import { holidaysFor, isLineManagerOf, myEmployee, reportingLine, requireEmployee } from './leave';
import { getHrPolicy, type HrPolicy } from './settings';
import { EMPLOYEE_WITH_PERSON } from './publicSelect';
import { notifyOvertimeDecided, notifyOvertimeRaised } from './notify';

export type OvertimeKind = 'NORMAL' | 'NIGHT' | 'WEEKEND' | 'HOLIDAY';

/** No claim may exceed a calendar day. Guards a fat-fingered 6000-minute request. */
const MAX_CLAIM_MINUTES = 24 * 60;

/**
 * Fallback when an employee has no shift assigned. A rostered shift is the
 * correct comparison; without one there is no schedule to exceed, so eight hours
 * is assumed rather than treating the whole day as overtime.
 */
const DEFAULT_SCHEDULED_MINUTES = 8 * 60;

// ── Pure calculation ───────────────────────────────────────────────────────
// Everything below this line is testable without a database, and is tested that
// way. The rate rules are the part a labour inspector would ask about.

/** "HH:MM" to minutes past midnight, or null when unparseable. */
function toMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Rostered length of a shift in minutes, handling the overnight case.
 *
 * A shift ending at or before it starts (22:00 → 06:00) runs past midnight and
 * is eight hours, not minus sixteen. Returning the negative here would make
 * every night-shift day look like fourteen hours of overtime.
 */
export function shiftMinutes(startTime: string, endTime: string): number | null {
  const from = toMinutes(startTime);
  const to = toMinutes(endTime);
  if (from === null || to === null) return null;
  return to > from ? to - from : to + 24 * 60 - from;
}

/** True when a local hour falls inside a night window that may wrap midnight. */
export function isNightHour(hour: number, nightStart: number, nightEnd: number): boolean {
  if (nightStart === nightEnd) return false;
  return nightStart < nightEnd ? hour >= nightStart && hour < nightEnd : hour >= nightStart || hour < nightEnd;
}

/**
 * How many minutes of an interval fall in the night window, in the workspace's
 * own timezone.
 *
 * Walks the interval a minute at a time. That is O(n) on a value bounded by
 * `MAX_CLAIM_MINUTES`, so at most 1440 cheap iterations — but `zonedParts`
 * builds an `Intl.DateTimeFormat` per call, which is not cheap, so the hour is
 * derived once per hour boundary rather than once per minute.
 */
export function nightMinutesIn(
  from: Date,
  to: Date,
  timeZone: string,
  nightStart: number,
  nightEnd: number,
): number {
  if (to <= from) return 0;
  const total = Math.min(Math.floor((to.getTime() - from.getTime()) / 60_000), MAX_CLAIM_MINUTES);
  let night = 0;
  let cursor = 0;
  while (cursor < total) {
    const at = new Date(from.getTime() + cursor * 60_000);
    const { minutes } = zonedParts(at, timeZone);
    const hour = Math.floor(minutes / 60);
    // Consume the rest of this local hour in one step instead of one minute at a
    // time: 24 formatter calls a day rather than 1440.
    const step = Math.min(60 - (minutes % 60), total - cursor);
    if (isNightHour(hour, nightStart, nightEnd)) night += step;
    cursor += step;
  }
  return night;
}

export interface ClassifyInput {
  /** Local calendar day the work belongs to. */
  workDate: Date;
  /** The overtime window itself — normally scheduled-end to actual check-out. */
  from: Date;
  to: Date;
  timeZone: string;
  weekendDays: readonly number[];
  holidayKeys: ReadonlySet<string>;
  nightStart: number;
  nightEnd: number;
}

/**
 * Which statutory rate a stretch of overtime attracts.
 *
 * Precedence is holiday, then rest day, then night, then ordinary — highest
 * entitlement first, so a public holiday that also falls on a Saturday pays the
 * holiday rate rather than whichever rule happened to be checked first.
 *
 * ponytail: one kind per claim, chosen by where the *majority* of the minutes
 * fall. Overtime that straddles 22:00 is billed entirely at one rate. Splitting
 * a claim pro-rata across two rates means more than one row per day, which the
 * unique constraint deliberately forbids; if a workspace routinely runs overtime
 * across the night boundary, add an `HrOvertimeSegment` child table and let this
 * return an array.
 */
export function classifyOvertime(input: ClassifyInput): OvertimeKind {
  if (input.holidayKeys.has(dayKey(input.workDate))) return 'HOLIDAY';

  const { weekday } = zonedParts(input.from, input.timeZone);
  if (input.weekendDays.includes(weekday)) return 'WEEKEND';

  const total = Math.max(0, Math.floor((input.to.getTime() - input.from.getTime()) / 60_000));
  const night = nightMinutesIn(input.from, input.to, input.timeZone, input.nightStart, input.nightEnd);
  return total > 0 && night * 2 > total ? 'NIGHT' : 'NORMAL';
}

/** The multiplier a kind attracts under the workspace's current policy. */
export function multiplierFor(kind: OvertimeKind, policy: HrPolicy): number {
  switch (kind) {
    case 'HOLIDAY':
      return policy.overtimeMultiplierHoliday;
    case 'WEEKEND':
      return policy.overtimeMultiplierWeekend;
    case 'NIGHT':
      return policy.overtimeMultiplierNight;
    case 'NORMAL':
      return policy.overtimeMultiplierNormal;
  }
}

// ── Detection ──────────────────────────────────────────────────────────────

export interface DetectionSummary {
  scanned: number;
  raised: number;
  updated: number;
  withdrawn: number;
  /** Days whose overrun exceeded the statutory ceiling, for the approver's attention. */
  overCap: number;
}

/**
 * Scan closed attendance days for time worked beyond the roster.
 *
 * Only days with both a check-in and a check-out are considered: an open day has
 * no end time, and inventing one would manufacture overtime out of a forgotten
 * check-out. `upsertDay` deliberately leaves those open for HR to correct.
 */
export async function detectOvertime(ctx: Ctx, range: { from: Date; to: Date }): Promise<DetectionSummary> {
  if (!isOvertimeApprover(ctx) && !isHrAdmin(ctx))
    throw Forbidden('Only an overtime approver or HR can run overtime detection.');

  const summary: DetectionSummary = { scanned: 0, raised: 0, updated: 0, withdrawn: 0, overCap: 0 };
  const policy = await getHrPolicy(ctx);
  if (!policy.overtimeDetectionEnabled) return summary;

  const from = toDay(range.from);
  const to = toDay(range.to);
  if (to < from) throw Conflict('The end of the range must be on or after its start.');

  const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { timezone: true } });
  const timeZone = tenant?.timezone ?? 'Asia/Dubai';

  const [days, holidays] = await Promise.all([
    prisma.hrAttendanceRecord.findMany({
      where: {
        tenantId: ctx.tenantId,
        workDate: { gte: from, lte: to },
        checkInAt: { not: null },
        checkOutAt: { not: null },
      },
      select: { employeeId: true, workDate: true, checkInAt: true, checkOutAt: true, workMinutes: true },
    }),
    holidaysFor(ctx, from, to),
  ]);
  summary.scanned = days.length;
  if (!days.length) return summary;

  const holidayKeys = new Set(holidays.map((holiday) => dayKey(holiday.holidayDate)));
  const scheduleFor = await scheduleLookup(
    ctx,
    days.map((day) => day.employeeId),
    to,
  );

  // One query for every DETECTED row already covering the range, so the loop
  // below makes no per-day round trip just to find out whether it may write.
  const existing = await prisma.hrOvertimeRequest.findMany({
    where: { tenantId: ctx.tenantId, source: 'DETECTED', workDate: { gte: from, lte: to } },
    select: { id: true, employeeId: true, workDate: true, status: true, minutes: true, lockedAt: true },
  });
  const existingBy = new Map(existing.map((row) => [`${row.employeeId}:${dayKey(row.workDate)}`, row]));

  for (const day of days) {
    if (!day.checkInAt || !day.checkOutAt) continue;
    const worked = day.workMinutes ?? Math.floor((day.checkOutAt.getTime() - day.checkInAt.getTime()) / 60_000);
    const scheduled = scheduleFor(day.employeeId, day.workDate) ?? DEFAULT_SCHEDULED_MINUTES;
    const overtime = Math.min(Math.max(0, worked - scheduled), MAX_CLAIM_MINUTES);
    const prior = existingBy.get(`${day.employeeId}:${dayKey(day.workDate)}`);

    // A claim already decided or already paid is evidence, not a draft. Detection
    // re-running over a closed period must not touch it.
    if (prior && (prior.status !== 'PENDING' || prior.lockedAt)) continue;

    if (overtime < policy.overtimeMinMinutes) {
      // The day was corrected — an exception approval moved the check-out, say —
      // and no longer qualifies. Withdraw the stale claim rather than leaving a
      // queue item that no longer reflects the record behind it.
      if (prior) {
        await prisma.hrOvertimeRequest.update({
          where: { tenantId: ctx.tenantId, id: prior.id },
          data: { status: 'CANCELLED', decisionNote: 'Withdrawn: the attendance day no longer shows overtime.' },
        });
        summary.withdrawn += 1;
      }
      continue;
    }

    // The overtime window runs from the end of the rostered shift to check-out.
    const overtimeStart = new Date(day.checkOutAt.getTime() - overtime * 60_000);
    const kind = classifyOvertime({
      workDate: day.workDate,
      from: overtimeStart,
      to: day.checkOutAt,
      timeZone,
      weekendDays: policy.weekendDays,
      holidayKeys,
      nightStart: policy.overtimeNightStartHour,
      nightEnd: policy.overtimeNightEndHour,
    });
    if (overtime > policy.overtimeDailyCapMinutes) summary.overCap += 1;

    if (prior) {
      if (prior.minutes === overtime) continue;
      await prisma.hrOvertimeRequest.update({
        where: { tenantId: ctx.tenantId, id: prior.id },
        data: { minutes: overtime, kind },
      });
      summary.updated += 1;
      continue;
    }

    try {
      await prisma.hrOvertimeRequest.create({
        data: {
          tenantId: ctx.tenantId,
          employeeId: day.employeeId,
          workDate: day.workDate,
          minutes: overtime,
          kind,
          source: 'DETECTED',
          status: 'PENDING',
        },
      });
      summary.raised += 1;
    } catch (error) {
      // Two scans racing over the same day. The constraint resolved it; the row
      // exists either way, which is the outcome this wanted.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
  }

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_overtime_detection',
    recordId: `${dayKey(from)}..${dayKey(to)}`,
    metadata: { action: 'overtime.detected', ...summary },
  });
  return summary;
}

/**
 * Returns a lookup of rostered minutes per employee per date.
 *
 * Assignments are effective-dated and may overlap in storage, so the one in
 * force on a given day is the latest whose window contains it.
 */
async function scheduleLookup(ctx: Ctx, employeeIds: string[], asOf: Date) {
  const assignments = await prisma.hrEmployeeShift.findMany({
    where: {
      tenantId: ctx.tenantId,
      employeeId: { in: [...new Set(employeeIds)] },
      effectiveOn: { lte: asOf },
    },
    select: { employeeId: true, effectiveOn: true, endsOn: true, shift: { select: { startTime: true, endTime: true } } },
    orderBy: { effectiveOn: 'desc' },
  });

  return (employeeId: string, on: Date): number | null => {
    const match = assignments.find(
      (row) => row.employeeId === employeeId && row.effectiveOn <= on && (!row.endsOn || row.endsOn >= on),
    );
    return match ? shiftMinutes(match.shift.startTime, match.shift.endTime) : null;
  };
}

// ── Requests ───────────────────────────────────────────────────────────────

export interface OvertimeRequestInput {
  workDate: Date;
  minutes: number;
  reason: string;
  /** Only an approver may raise a claim on someone else's behalf. */
  employeeId?: string;
}

export async function requestOvertime(ctx: Ctx, input: OvertimeRequestInput) {
  const self = await myEmployee(ctx);
  const onBehalf = Boolean(input.employeeId && input.employeeId !== self?.id);
  if (onBehalf && !isOvertimeApprover(ctx))
    throw Forbidden('Only an overtime approver can raise a claim for someone else.');

  const employee = input.employeeId ? await requireEmployee(ctx, input.employeeId) : self;
  if (!employee)
    throw Conflict(
      'Your account has no employee record in this workspace, so it cannot claim overtime. Ask HR to create one.',
    );

  const workDate = toDay(input.workDate);
  if (workDate > toDay(new Date())) throw Conflict('Overtime cannot be claimed for a future date.');
  if (employee.joinedOn && workDate < toDay(employee.joinedOn))
    throw Conflict('That date is before this employee joined.');
  if (input.minutes <= 0 || input.minutes > MAX_CLAIM_MINUTES)
    throw Conflict(`Claimed overtime must be between 1 and ${MAX_CLAIM_MINUTES} minutes.`);
  if (!input.reason.trim()) throw Conflict('Give a reason for the claim — the approver needs it to decide.');

  const policy = await getHrPolicy(ctx);
  const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { timezone: true } });
  const holidays = await holidaysFor(ctx, workDate, workDate);

  // A manual claim has no check-out to anchor it, so the window is taken as the
  // minutes immediately before midnight of the work date in workspace time. That
  // is only used to pick a rate category; the approver can see the date and
  // override by rejecting.
  const endOfDay = new Date(workDate.getTime() + 24 * 3_600_000);
  const kind = classifyOvertime({
    workDate,
    from: new Date(endOfDay.getTime() - input.minutes * 60_000),
    to: endOfDay,
    timeZone: tenant?.timezone ?? 'Asia/Dubai',
    weekendDays: policy.weekendDays,
    holidayKeys: new Set(holidays.map((holiday) => dayKey(holiday.holidayDate))),
    nightStart: policy.overtimeNightStartHour,
    nightEnd: policy.overtimeNightEndHour,
  });

  try {
    const created = await prisma.hrOvertimeRequest.create({
      data: {
        tenantId: ctx.tenantId,
        employeeId: employee.id,
        workDate,
        minutes: input.minutes,
        kind,
        source: 'REQUESTED',
        status: 'PENDING',
        reason: input.reason.trim(),
        requestedById: self?.id ?? null,
      },
    });
    await audit(ctx, {
      event: 'RECORD_CREATED',
      objectType: 'hr_overtime_request',
      recordId: created.id,
      metadata: {
        action: 'overtime.requested',
        employeeId: employee.id,
        workDate: dayKey(workDate),
        minutes: input.minutes,
        kind,
        onBehalf,
      },
    });
    await notifyOvertimeRaised(ctx, {
      employeeName: employee.employeeNumber,
      minutes: input.minutes,
      recordId: created.id,
    });
    return created;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw Conflict('A claim for that date already exists. Amend or cancel it instead of raising a second one.');
    throw error;
  }
}

export interface OvertimeDecision {
  note?: string;
  /** Settle with time off in lieu rather than pay. */
  compensatory?: boolean;
}

/**
 * Approve or reject a claim.
 *
 * Nobody decides their own — §111 — however senior. The whole value of the step
 * is that a second person looked at the hours, and an approver who can approve
 * their own overtime is a self-service pay rise.
 */
export async function decideOvertime(ctx: Ctx, id: string, approve: boolean, decision: OvertimeDecision = {}) {
  if (!isOvertimeApprover(ctx)) throw Forbidden('Your role does not allow deciding overtime claims.');

  const claim = await prisma.hrOvertimeRequest.findFirst({ where: { tenantId: ctx.tenantId, id } });
  if (!claim) throw NotFound('Overtime claim');
  if (claim.lockedAt) throw Conflict('This claim has already been taken into a payroll run and can no longer change.');
  if (claim.status !== 'PENDING') throw Conflict(`This claim is already ${claim.status.toLowerCase()}.`);

  const actor = await myEmployee(ctx);
  if (actor && actor.id === claim.employeeId) throw Conflict('You cannot decide your own overtime claim.');

  /**
   * The scope is not decoration.
   *
   * `overtime:APPROVE` is backfilled from `attendance:APPROVE` at the same
   * scope, and that permission is line-manager-constrained where it is spent —
   * see decideAttendanceException. Checking only that the role holds *some*
   * grant let a TEAM-scoped manager approve any claim in the workspace, which
   * is a signing authority nobody gave them: approving stamps the multiplier
   * and approvedOvertimeMinutes hands the result to payroll.
   */
  if (!isOvertimeAdmin(ctx) && !isHrAdmin(ctx) && !(await isLineManagerOf(ctx, claim.employeeId))) {
    throw Forbidden('You can only decide overtime for the people who report to you.');
  }

  const policy = await getHrPolicy(ctx);
  const compensatory = Boolean(decision.compensatory);
  if (compensatory && !policy.overtimeCompensatoryAllowed)
    throw Conflict('This workspace does not allow settling overtime with time off in lieu.');

  const updated = await prisma.hrOvertimeRequest.update({
    where: { tenantId: ctx.tenantId, id: claim.id },
    data: {
      status: approve ? 'APPROVED' : 'REJECTED',
      // Committed at the moment of approval and never re-read. See the file note.
      multiplier: approve ? multiplierFor(claim.kind as OvertimeKind, policy) : null,
      compensatory: approve ? compensatory : false,
      approverId: actor?.id ?? null,
      decidedAt: new Date(),
      decisionNote: decision.note?.trim() || null,
    },
  });

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_overtime_request',
    recordId: claim.id,
    metadata: {
      action: approve ? 'overtime.approved' : 'overtime.rejected',
      employeeId: claim.employeeId,
      workDate: dayKey(claim.workDate),
      minutes: claim.minutes,
      kind: claim.kind,
      multiplier: updated.multiplier,
      compensatory,
      previousStatus: claim.status,
    },
  });
  await notifyOvertimeDecided(ctx, { employeeId: claim.employeeId, approved: approve, recordId: claim.id });
  return updated;
}

/** Withdraw a claim. The person who raised it, or HR; only while it is undecided. */
export async function cancelOvertime(ctx: Ctx, id: string) {
  const claim = await prisma.hrOvertimeRequest.findFirst({ where: { tenantId: ctx.tenantId, id } });
  if (!claim) throw NotFound('Overtime claim');
  if (claim.lockedAt) throw Conflict('This claim has already been taken into a payroll run and can no longer change.');
  if (claim.status !== 'PENDING') throw Conflict(`This claim is already ${claim.status.toLowerCase()}.`);

  const self = await myEmployee(ctx);
  const mine = self && (self.id === claim.employeeId || self.id === claim.requestedById);
  if (!mine && !isHrAdmin(ctx)) throw Forbidden('You can only withdraw a claim you raised.');

  const updated = await prisma.hrOvertimeRequest.update({
    where: { tenantId: ctx.tenantId, id: claim.id },
    data: { status: 'CANCELLED' },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_overtime_request',
    recordId: claim.id,
    metadata: { action: 'overtime.cancelled', employeeId: claim.employeeId, workDate: dayKey(claim.workDate) },
  });
  return updated;
}

// ── Reads ──────────────────────────────────────────────────────────────────

export interface OvertimeFilter {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  employeeId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
}

/**
 * The claim list, scoped to what the caller may see.
 *
 * Three tiers, matching the three the decision path enforces: HR and an
 * ORGANIZATION-scoped approver see the workspace, a line manager sees their own
 * reporting line, and everyone else sees only themselves. Asking for someone
 * outside the caller's tier is refused rather than quietly re-pointed at their
 * own, so a broken client is visible instead of silently wrong.
 *
 * The queue used to widen to the whole workspace for anyone holding APPROVE at
 * any scope, which handed a TEAM-scoped manager every employee's claims and the
 * person record attached to each.
 */
export async function listOvertime(ctx: Ctx, filter: OvertimeFilter = {}) {
  const anyone = isOvertimeAdmin(ctx) || isHrAdmin(ctx);
  let scoped: string[] = [];

  if (!anyone) {
    // `reportingLine` is [self, ...reports], or empty when the caller has no
    // employee record. Someone without approval rights keeps only the first.
    const line = await reportingLine(ctx);
    scoped = isOvertimeApprover(ctx) ? line : line.slice(0, 1);
    if (!scoped.length) return { rows: [], nextCursor: null };
    if (filter.employeeId && !scoped.includes(filter.employeeId)) {
      throw Forbidden('You can only see overtime claims for yourself and the people who report to you.');
    }
  }

  const take = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const rows = await prisma.hrOvertimeRequest.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: filter.status,
      employeeId: anyone ? filter.employeeId : (filter.employeeId ?? { in: scoped }),
      workDate: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
    },
    include: {
      employee: EMPLOYEE_WITH_PERSON,
      approver: EMPLOYEE_WITH_PERSON,
    },
    orderBy: [{ workDate: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
  });

  const page = rows.slice(0, take);
  return { rows: page, nextCursor: rows.length > take ? page[page.length - 1]!.id : null };
}

export interface OvertimeTotals {
  employeeId: string;
  minutes: number;
  /**
   * Minutes already scaled by the approved multiplier — what payroll multiplies
   * by the hourly basic rate. Kept separate from raw minutes so a timesheet
   * report and a cost report do not have to agree on which one they mean.
   */
  weightedMinutes: number;
}

/**
 * Payroll's input. Approved, non-compensatory claims in the period, per employee.
 *
 * Compensatory claims are excluded because they were settled with time off — the
 * employee has already been paid in rest, and paying them again is the exact
 * double-count the flag exists to prevent.
 */
export async function approvedOvertimeMinutes(
  ctx: Ctx,
  employeeIds: string[],
  from: Date,
  to: Date,
): Promise<OvertimeTotals[]> {
  if (!employeeIds.length) return [];
  const rows = await prisma.hrOvertimeRequest.findMany({
    where: {
      tenantId: ctx.tenantId,
      employeeId: { in: [...new Set(employeeIds)] },
      status: 'APPROVED',
      compensatory: false,
      workDate: { gte: toDay(from), lte: toDay(to) },
    },
    select: { employeeId: true, minutes: true, multiplier: true },
  });

  const totals = new Map<string, OvertimeTotals>();
  for (const row of rows) {
    const entry = totals.get(row.employeeId) ?? { employeeId: row.employeeId, minutes: 0, weightedMinutes: 0 };
    entry.minutes += row.minutes;
    // A row approved before multipliers existed would have none; treating that as
    // 1.0 pays the hours flat rather than dropping them.
    entry.weightedMinutes += row.minutes * (row.multiplier ?? 1);
    totals.set(row.employeeId, entry);
  }
  return [...totals.values()];
}
