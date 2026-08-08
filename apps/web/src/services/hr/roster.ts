/**
 * Rostering: putting named people on named shifts on named dates.
 *
 * `HrEmployeeShift` already expressed the *standing* assignment — "Amina works
 * the early shift from March" — which is what overtime detection compares
 * against. It cannot express "next Tuesday only", which is what a manager
 * actually publishes and what a swap moves. `HrRosterEntry` is that.
 *
 * The part worth reading is `conflictsFor`. A roster is almost always built by
 * copying a week forward, and copying is exactly how a schedule quietly breaches
 * a rest-day entitlement: nobody re-reads six weeks of history before dragging a
 * shift. So every write — single, bulk, copied or swapped — goes through the
 * same conflict check, and the check is a pure function over rows the caller
 * supplies, so the bulk paths evaluate a whole month without one query per day.
 *
 * Conflicts are refusals, not warnings. A roster that renders a conflict in
 * amber and saves it anyway is a roster nobody trusts.
 */
import { Prisma } from '@prisma/client';
import { prisma, withTx } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { addDays, dayKey, toDay } from './rules';
import { myEmployee, requireEmployee } from './leave';
import { getHrPolicy, type HrPolicy } from './settings';
import { EMPLOYEE_WITH_PERSON } from './publicSelect';
import { notifyShiftChangeDecided, notifyShiftChangeRaised } from './notify';

/** Publishes and edits the roster. */
export const isRosterPlanner = (ctx: Ctx) => SCOPE_RANK[scopeFor(ctx, 'shifts', 'EDIT')] >= SCOPE_RANK.TEAM;

/** Decides shift-change and swap requests. */
export const isRosterApprover = (ctx: Ctx) => SCOPE_RANK[scopeFor(ctx, 'shifts', 'APPROVE')] >= SCOPE_RANK.TEAM;

const DAY_MS = 86_400_000;

// ── Pure scheduling arithmetic ─────────────────────────────────────────────

function minutesOf(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours > 23 || minutes > 59 ? null : hours * 60 + minutes;
}

export interface ShiftWindow {
  /** Epoch milliseconds. */
  start: number;
  end: number;
}

/**
 * When a rostered shift actually runs, as an absolute interval.
 *
 * An end at or before the start means the shift crosses midnight and belongs
 * partly to the next day — the same rule `shiftMinutes` applies in overtime.
 * Without it, a 22:00–06:00 shift looks like a negative-length event and never
 * overlaps anything.
 */
export function shiftWindow(workDate: Date, startTime: string, endTime: string): ShiftWindow | null {
  const from = minutesOf(startTime);
  const to = minutesOf(endTime);
  if (from === null || to === null) return null;
  const base = toDay(workDate).getTime();
  const start = base + from * 60_000;
  const end = base + (to > from ? to : to + 24 * 60) * 60_000;
  return { start, end };
}

export const windowsOverlap = (a: ShiftWindow, b: ShiftWindow) => a.start < b.end && b.start < a.end;

/** Hours between the end of one shift and the start of the next. Negative when they overlap. */
export const restHoursBetween = (earlier: ShiftWindow, later: ShiftWindow) =>
  (later.start - earlier.end) / 3_600_000;

export type ConflictCode =
  | 'DUPLICATE'
  | 'OVERLAP'
  | 'INSUFFICIENT_REST'
  | 'TOO_MANY_CONSECUTIVE'
  | 'ON_LEAVE'
  | 'SHIFT_INACTIVE'
  | 'NOT_A_WORKING_DAY';

export interface RosterConflict {
  code: ConflictCode;
  message: string;
}

export interface ExistingEntry {
  workDate: Date;
  shiftId: string;
  startTime: string;
  endTime: string;
}

export interface ConflictInput {
  workDate: Date;
  shiftId: string;
  startTime: string;
  endTime: string;
  shiftActive: boolean;
  shiftWorkingDays: number[];
  /** Every other entry this employee already has, near the date being checked. */
  existing: ExistingEntry[];
  /** Days the employee is on approved leave, as `YYYY-MM-DD`. */
  leaveDays: ReadonlySet<string>;
  policy: HrPolicy;
}

/**
 * Every reason this assignment should be refused. Pure, so the bulk paths can
 * evaluate a month without a query per day.
 */
export function conflictsFor(input: ConflictInput): RosterConflict[] {
  const conflicts: RosterConflict[] = [];
  const target = shiftWindow(input.workDate, input.startTime, input.endTime);
  if (!target) return [{ code: 'OVERLAP', message: 'That shift has an unreadable start or end time.' }];

  if (!input.shiftActive) conflicts.push({ code: 'SHIFT_INACTIVE', message: 'That shift has been retired.' });

  if (input.shiftWorkingDays.length && !input.shiftWorkingDays.includes(toDay(input.workDate).getUTCDay()))
    conflicts.push({ code: 'NOT_A_WORKING_DAY', message: 'That shift does not run on that day of the week.' });

  if (input.policy.rosterBlockOnLeave && input.leaveDays.has(dayKey(input.workDate)))
    conflicts.push({ code: 'ON_LEAVE', message: 'That employee is on approved leave that day.' });

  const sameDay = dayKey(input.workDate);
  for (const entry of input.existing) {
    if (dayKey(entry.workDate) === sameDay && entry.shiftId === input.shiftId) {
      conflicts.push({ code: 'DUPLICATE', message: 'That shift is already rostered for that day.' });
      continue;
    }
    const other = shiftWindow(entry.workDate, entry.startTime, entry.endTime);
    if (!other) continue;

    if (windowsOverlap(target, other)) {
      conflicts.push({ code: 'OVERLAP', message: 'That overlaps a shift the employee is already rostered on.' });
      continue;
    }
    // Rest is directional: whichever finishes first is the earlier one.
    const [first, second] = target.start < other.start ? [target, other] : [other, target];
    const rest = restHoursBetween(first, second);
    if (rest < input.policy.rosterMinRestHours) {
      conflicts.push({
        code: 'INSUFFICIENT_REST',
        message: `That leaves ${rest.toFixed(1)} h rest between shifts; the minimum is ${input.policy.rosterMinRestHours} h.`,
      });
    }
  }

  const streak = consecutiveRunIncluding(input.workDate, input.existing);
  if (streak > input.policy.rosterMaxConsecutiveDays) {
    conflicts.push({
      code: 'TOO_MANY_CONSECUTIVE',
      message: `That would be ${streak} consecutive rostered days; the maximum is ${input.policy.rosterMaxConsecutiveDays}.`,
    });
  }

  // Two entries can each raise the same code — a split shift overlapping twice.
  // The caller wants the distinct reasons, not one per collision.
  return [...new Map(conflicts.map((conflict) => [conflict.code, conflict])).values()];
}

/** Length of the unbroken run of rostered days that `workDate` would join. */
export function consecutiveRunIncluding(workDate: Date, existing: ExistingEntry[]): number {
  const days = new Set(existing.map((entry) => dayKey(entry.workDate)));
  days.add(dayKey(workDate));
  const anchor = toDay(workDate).getTime();

  let run = 1;
  for (let cursor = anchor - DAY_MS; days.has(dayKey(new Date(cursor))); cursor -= DAY_MS) run += 1;
  for (let cursor = anchor + DAY_MS; days.has(dayKey(new Date(cursor))); cursor += DAY_MS) run += 1;
  return run;
}

// ── Context loading ────────────────────────────────────────────────────────

/**
 * Everything `conflictsFor` needs for a set of employees over a window.
 *
 * Loaded once for a bulk assign rather than per day. The window is padded so a
 * streak or a rest gap that starts just outside the range is still seen — a
 * check that only looks inside the range it is writing cannot detect the
 * seventh consecutive day when the first six were last week.
 */
async function loadContext(ctx: Ctx, employeeIds: string[], from: Date, to: Date) {
  const padded = { from: addDays(from, -14), to: addDays(to, 14) };
  const [entries, leave] = await Promise.all([
    prisma.hrRosterEntry.findMany({
      where: { tenantId: ctx.tenantId, employeeId: { in: employeeIds }, workDate: { gte: padded.from, lte: padded.to } },
      select: {
        id: true,
        employeeId: true,
        workDate: true,
        shiftId: true,
        shift: { select: { startTime: true, endTime: true } },
      },
    }),
    prisma.hrLeaveRequest.findMany({
      where: {
        tenantId: ctx.tenantId,
        employeeId: { in: employeeIds },
        status: 'APPROVED',
        startDate: { lte: padded.to },
        endDate: { gte: padded.from },
      },
      select: { employeeId: true, startDate: true, endDate: true },
    }),
  ]);

  const existingBy = new Map<string, ExistingEntry[]>();
  for (const entry of entries) {
    const list = existingBy.get(entry.employeeId) ?? [];
    list.push({
      workDate: entry.workDate,
      shiftId: entry.shiftId,
      startTime: entry.shift.startTime,
      endTime: entry.shift.endTime,
    });
    existingBy.set(entry.employeeId, list);
  }

  const leaveBy = new Map<string, Set<string>>();
  for (const request of leave) {
    const days = leaveBy.get(request.employeeId) ?? new Set<string>();
    for (let cursor = toDay(request.startDate); cursor <= toDay(request.endDate); cursor = addDays(cursor, 1)) {
      days.add(dayKey(cursor));
    }
    leaveBy.set(request.employeeId, days);
  }

  return { existingBy, leaveBy };
}

// ── Writes ─────────────────────────────────────────────────────────────────

export interface AssignInput {
  employeeId: string;
  shiftId: string;
  workDate: Date;
  note?: string;
  source?: 'ROSTER' | 'OVERRIDE' | 'SWAP';
}

export async function assignShift(ctx: Ctx, input: AssignInput) {
  if (!isRosterPlanner(ctx)) throw Forbidden('Only a roster planner can assign shifts.');
  await requireEmployee(ctx, input.employeeId);

  const shift = await prisma.hrShift.findFirst({ where: { tenantId: ctx.tenantId, id: input.shiftId } });
  if (!shift) throw NotFound('Shift');

  const policy = await getHrPolicy(ctx);
  const workDate = toDay(input.workDate);
  const { existingBy, leaveBy } = await loadContext(ctx, [input.employeeId], workDate, workDate);

  const conflicts = conflictsFor({
    workDate,
    shiftId: shift.id,
    startTime: shift.startTime,
    endTime: shift.endTime,
    shiftActive: shift.isActive,
    shiftWorkingDays: shift.workingDays,
    existing: existingBy.get(input.employeeId) ?? [],
    leaveDays: leaveBy.get(input.employeeId) ?? new Set(),
    policy,
  });
  if (conflicts.length) throw Conflict(conflicts.map((conflict) => conflict.message).join(' '));

  const actor = await myEmployee(ctx);
  const entry = await prisma.hrRosterEntry.create({
    data: {
      tenantId: ctx.tenantId,
      employeeId: input.employeeId,
      shiftId: shift.id,
      workDate,
      source: input.source ?? 'ROSTER',
      note: input.note?.trim() || null,
      createdById: actor?.id ?? null,
    },
  });

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_roster_entry',
    recordId: entry.id,
    metadata: {
      action: 'roster.assigned',
      employeeId: input.employeeId,
      shiftCode: shift.code,
      workDate: dayKey(workDate),
    },
  });
  return entry;
}

export interface BulkAssignInput {
  employeeIds: string[];
  shiftId: string;
  from: Date;
  to: Date;
  /** Days of the week to fill, 0 (Sunday) to 6. Empty means every day in range. */
  weekdays?: number[];
}

export interface BulkResult {
  created: number;
  skipped: { employeeId: string; workDate: string; reasons: ConflictCode[] }[];
}

/**
 * Fill a date range for several people at once.
 *
 * Partial success is the point: a month-long assign that hits one leave day
 * should place the other nineteen shifts and tell you about the one it could
 * not, rather than refusing the lot. Every skip is reported with its reasons.
 */
export async function bulkAssign(ctx: Ctx, input: BulkAssignInput): Promise<BulkResult> {
  if (!isRosterPlanner(ctx)) throw Forbidden('Only a roster planner can assign shifts.');
  if (!input.employeeIds.length) throw Conflict('Pick at least one employee.');

  const from = toDay(input.from);
  const to = toDay(input.to);
  if (to < from) throw Conflict('The end of the range must be on or after its start.');
  if ((to.getTime() - from.getTime()) / DAY_MS > 366) throw Conflict('Roster at most a year at a time.');

  const shift = await prisma.hrShift.findFirst({ where: { tenantId: ctx.tenantId, id: input.shiftId } });
  if (!shift) throw NotFound('Shift');

  const employees = await prisma.employeeProfile.findMany({
    where: { tenantId: ctx.tenantId, id: { in: input.employeeIds }, deletedAt: null },
    select: { id: true },
  });
  if (employees.length !== new Set(input.employeeIds).size) throw NotFound('Employee');

  const policy = await getHrPolicy(ctx);
  const { existingBy, leaveBy } = await loadContext(ctx, input.employeeIds, from, to);
  const actor = await myEmployee(ctx);
  const wanted = new Set(input.weekdays ?? []);

  const result: BulkResult = { created: 0, skipped: [] };
  const toCreate: Prisma.HrRosterEntryCreateManyInput[] = [];

  for (const employeeId of new Set(input.employeeIds)) {
    // Mutated as the loop places shifts, so day two is checked against day one
    // rather than against a snapshot that predates it. Without this a bulk
    // assign cannot see the streak it is itself building.
    const existing = existingBy.get(employeeId) ?? [];
    const leaveDays = leaveBy.get(employeeId) ?? new Set<string>();

    for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
      if (wanted.size && !wanted.has(cursor.getUTCDay())) continue;

      const conflicts = conflictsFor({
        workDate: cursor,
        shiftId: shift.id,
        startTime: shift.startTime,
        endTime: shift.endTime,
        shiftActive: shift.isActive,
        shiftWorkingDays: shift.workingDays,
        existing,
        leaveDays,
        policy,
      });
      if (conflicts.length) {
        result.skipped.push({
          employeeId,
          workDate: dayKey(cursor),
          reasons: conflicts.map((conflict) => conflict.code),
        });
        continue;
      }

      toCreate.push({
        tenantId: ctx.tenantId,
        employeeId,
        shiftId: shift.id,
        workDate: cursor,
        source: 'ROSTER',
        createdById: actor?.id ?? null,
      });
      existing.push({
        workDate: cursor,
        shiftId: shift.id,
        startTime: shift.startTime,
        endTime: shift.endTime,
      });
    }
  }

  if (toCreate.length) {
    // skipDuplicates covers a concurrent planner writing the same cell; the
    // unique key is the authority, and the count reflects what actually landed.
    const written = await prisma.hrRosterEntry.createMany({ data: toCreate, skipDuplicates: true });
    result.created = written.count;
  }

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_roster_entry',
    recordId: `${dayKey(from)}..${dayKey(to)}`,
    metadata: {
      action: 'roster.bulk_assigned',
      shiftCode: shift.code,
      employees: new Set(input.employeeIds).size,
      created: result.created,
      skipped: result.skipped.length,
    },
  });
  return result;
}

/**
 * Copy one week onto another, for everyone or a named group.
 *
 * The ordinary way a roster is built, and the ordinary way rest entitlements get
 * breached — so the copy runs every day through the same conflict check and
 * reports what it would not place.
 */
export async function copyWeek(
  ctx: Ctx,
  input: { fromWeekStart: Date; toWeekStart: Date; employeeIds?: string[] },
): Promise<BulkResult> {
  if (!isRosterPlanner(ctx)) throw Forbidden('Only a roster planner can copy a roster.');
  const sourceStart = toDay(input.fromWeekStart);
  const targetStart = toDay(input.toWeekStart);
  if (sourceStart.getTime() === targetStart.getTime()) throw Conflict('Pick a different week to copy into.');

  const sourceEnd = addDays(sourceStart, 6);
  const source = await prisma.hrRosterEntry.findMany({
    where: {
      tenantId: ctx.tenantId,
      workDate: { gte: sourceStart, lte: sourceEnd },
      ...(input.employeeIds?.length ? { employeeId: { in: input.employeeIds } } : {}),
    },
    select: {
      employeeId: true,
      shiftId: true,
      workDate: true,
      shift: { select: { startTime: true, endTime: true, isActive: true, workingDays: true } },
    },
  });
  if (!source.length) throw Conflict('That week has nothing rostered to copy.');

  const offset = Math.round((targetStart.getTime() - sourceStart.getTime()) / DAY_MS);
  const employeeIds = [...new Set(source.map((entry) => entry.employeeId))];
  const policy = await getHrPolicy(ctx);
  const { existingBy, leaveBy } = await loadContext(ctx, employeeIds, targetStart, addDays(targetStart, 6));
  const actor = await myEmployee(ctx);

  const result: BulkResult = { created: 0, skipped: [] };
  const toCreate: Prisma.HrRosterEntryCreateManyInput[] = [];

  for (const entry of source) {
    const workDate = addDays(entry.workDate, offset);
    const existing = existingBy.get(entry.employeeId) ?? [];
    const conflicts = conflictsFor({
      workDate,
      shiftId: entry.shiftId,
      startTime: entry.shift.startTime,
      endTime: entry.shift.endTime,
      shiftActive: entry.shift.isActive,
      shiftWorkingDays: entry.shift.workingDays,
      existing,
      leaveDays: leaveBy.get(entry.employeeId) ?? new Set(),
      policy,
    });
    if (conflicts.length) {
      result.skipped.push({
        employeeId: entry.employeeId,
        workDate: dayKey(workDate),
        reasons: conflicts.map((conflict) => conflict.code),
      });
      continue;
    }

    toCreate.push({
      tenantId: ctx.tenantId,
      employeeId: entry.employeeId,
      shiftId: entry.shiftId,
      workDate,
      source: 'ROSTER',
      createdById: actor?.id ?? null,
    });
    existing.push({
      workDate,
      shiftId: entry.shiftId,
      startTime: entry.shift.startTime,
      endTime: entry.shift.endTime,
    });
    existingBy.set(entry.employeeId, existing);
  }

  if (toCreate.length) {
    const written = await prisma.hrRosterEntry.createMany({ data: toCreate, skipDuplicates: true });
    result.created = written.count;
  }

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_roster_entry',
    recordId: `${dayKey(targetStart)}`,
    metadata: {
      action: 'roster.week_copied',
      from: dayKey(sourceStart),
      to: dayKey(targetStart),
      created: result.created,
      skipped: result.skipped.length,
    },
  });
  return result;
}

export async function removeRosterEntry(ctx: Ctx, entryId: string) {
  if (!isRosterPlanner(ctx)) throw Forbidden('Only a roster planner can remove a rostered shift.');
  const entry = await prisma.hrRosterEntry.findFirst({
    where: { tenantId: ctx.tenantId, id: entryId },
    include: { shift: { select: { code: true } } },
  });
  if (!entry) throw NotFound('Rostered shift');

  // Withdraw anything still waiting on this day before it disappears. A pending
  // swap against a shift that no longer exists cannot be approved — `decide`
  // would refuse it — so leaving it PENDING is a queue item nobody can clear.
  const cancelled = await withTx(ctx.tenantId, async (tx) => {
    const pending = await tx.hrShiftChangeRequest.updateMany({
      where: {
        tenantId: ctx.tenantId,
        status: 'PENDING',
        OR: [{ entryId: entry.id }, { counterpartEntryId: entry.id }],
      },
      data: {
        status: 'CANCELLED',
        decisionNote: 'Withdrawn: the rostered shift it referred to was removed.',
      },
    });
    await tx.hrRosterEntry.delete({ where: { tenantId: ctx.tenantId, id: entry.id } });
    return pending.count;
  });

  await audit(ctx, {
    event: 'RECORD_DELETED',
    objectType: 'hr_roster_entry',
    recordId: entry.id,
    metadata: {
      action: 'roster.removed',
      employeeId: entry.employeeId,
      shiftCode: entry.shift.code,
      workDate: dayKey(entry.workDate),
      requestsWithdrawn: cancelled,
    },
  });
  return { removed: true, requestsWithdrawn: cancelled };
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** The roster for a window. An employee without planning rights sees only their own. */
export async function rosterFor(ctx: Ctx, options: { from: Date; to: Date; employeeId?: string }) {
  const self = await myEmployee(ctx);
  const planner = isRosterPlanner(ctx);
  if (!planner) {
    if (!self) return [];
    if (options.employeeId && options.employeeId !== self.id)
      throw Forbidden('You can only see your own roster.');
  }

  return prisma.hrRosterEntry.findMany({
    where: {
      tenantId: ctx.tenantId,
      workDate: { gte: toDay(options.from), lte: toDay(options.to) },
      employeeId: planner ? options.employeeId : self!.id,
    },
    include: { employee: EMPLOYEE_WITH_PERSON, shift: true },
    orderBy: [{ workDate: 'asc' }, { id: 'asc' }],
    take: 2000,
  });
}

// ── Shift change and swap ──────────────────────────────────────────────────

export interface ShiftChangeInput {
  entryId: string;
  reason: string;
  /** CHANGE: the shift being asked for. */
  requestedShiftId?: string;
  /** SWAP: the colleague's rostered day being swapped into. */
  counterpartEntryId?: string;
}

export async function requestShiftChange(ctx: Ctx, input: ShiftChangeInput) {
  const self = await myEmployee(ctx);
  if (!self)
    throw Conflict('Your account has no employee record in this workspace, so it cannot request a shift change.');
  if (!input.reason.trim()) throw Conflict('Give a reason — the approver needs it to decide.');
  if (!input.requestedShiftId === !input.counterpartEntryId)
    throw Conflict('Ask for either a different shift or a swap with a colleague, not both.');

  const entry = await prisma.hrRosterEntry.findFirst({ where: { tenantId: ctx.tenantId, id: input.entryId } });
  if (!entry) throw NotFound('Rostered shift');
  if (entry.employeeId !== self.id) throw Forbidden('You can only ask to change your own rostered shift.');
  if (toDay(entry.workDate) < toDay(new Date())) throw Conflict('That shift has already passed.');

  let counterpartId: string | null = null;
  if (input.counterpartEntryId) {
    const counterpartEntry = await prisma.hrRosterEntry.findFirst({
      where: { tenantId: ctx.tenantId, id: input.counterpartEntryId },
    });
    if (!counterpartEntry) throw NotFound('Colleague’s rostered shift');
    if (counterpartEntry.employeeId === self.id) throw Conflict('Pick a colleague’s shift, not your own.');
    if (toDay(counterpartEntry.workDate) < toDay(new Date())) throw Conflict('That shift has already passed.');
    counterpartId = counterpartEntry.employeeId;
  } else {
    const shift = await prisma.hrShift.findFirst({
      where: { tenantId: ctx.tenantId, id: input.requestedShiftId!, isActive: true },
    });
    if (!shift) throw NotFound('Shift');
    if (shift.id === entry.shiftId) throw Conflict('You are already rostered on that shift.');
  }

  const request = await prisma.hrShiftChangeRequest.create({
    data: {
      tenantId: ctx.tenantId,
      kind: input.counterpartEntryId ? 'SWAP' : 'CHANGE',
      requesterId: self.id,
      entryId: entry.id,
      requestedShiftId: input.requestedShiftId ?? null,
      counterpartId,
      counterpartEntryId: input.counterpartEntryId ?? null,
      reason: input.reason.trim(),
    },
  });

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_shift_change_request',
    recordId: request.id,
    metadata: {
      action: 'roster.change_requested',
      kind: request.kind,
      workDate: dayKey(entry.workDate),
      counterpartId,
    },
  });
  await notifyShiftChangeRaised(ctx, {
    employeeName: self.employeeNumber,
    recordId: request.id,
    kind: request.kind,
  });
  return request;
}

/**
 * Decide a change or swap, and move the roster in the same transaction.
 *
 * Both sides are re-read inside the transaction rather than trusted from the
 * request: a swap raised on Monday and approved on Friday may name a day that
 * has since been re-rostered, and moving a shift that no longer belongs to the
 * person who offered it is worse than refusing late.
 */
export async function decideShiftChange(ctx: Ctx, requestId: string, approve: boolean, note?: string) {
  if (!isRosterApprover(ctx)) throw Forbidden('Your role does not allow deciding shift changes.');

  const request = await prisma.hrShiftChangeRequest.findFirst({ where: { tenantId: ctx.tenantId, id: requestId } });
  if (!request) throw NotFound('Shift change request');
  if (request.status !== 'PENDING') throw Conflict(`This request is already ${request.status.toLowerCase()}.`);

  const actor = await myEmployee(ctx);
  if (actor && actor.id === request.requesterId) throw Conflict('You cannot decide your own shift change.');

  if (!approve) {
    const rejected = await prisma.hrShiftChangeRequest.update({
      where: { tenantId: ctx.tenantId, id: request.id },
      data: { status: 'REJECTED', approverId: actor?.id ?? null, decidedAt: new Date(), decisionNote: note?.trim() || null },
    });
    await audit(ctx, {
      event: 'RECORD_UPDATED',
      objectType: 'hr_shift_change_request',
      recordId: request.id,
      metadata: { action: 'roster.change_rejected', kind: request.kind },
    });
    await notifyShiftChangeDecided(ctx, {
      employeeIds: [request.requesterId],
      approved: false,
      recordId: request.id,
    });
    return rejected;
  }

  const approved = await withTx(ctx.tenantId, async (tx) => {
    const entry = await tx.hrRosterEntry.findFirst({ where: { tenantId: ctx.tenantId, id: request.entryId } });
    if (!entry || entry.employeeId !== request.requesterId)
      throw Conflict('The rostered shift this request names has changed since it was raised.');

    if (request.kind === 'SWAP') {
      const other = await tx.hrRosterEntry.findFirst({
        where: { tenantId: ctx.tenantId, id: request.counterpartEntryId ?? '' },
      });
      if (!other || other.employeeId !== request.counterpartId)
        throw Conflict('The colleague’s shift this request names has changed since it was raised.');

      // Swap the people, not the dates: each keeps their own day and takes the
      // other's shift. Two updates, one transaction — a half-applied swap leaves
      // one person double-booked and the other unrostered.
      await tx.hrRosterEntry.update({
        where: { tenantId: ctx.tenantId, id: entry.id },
        data: { employeeId: other.employeeId, source: 'SWAP' },
      });
      await tx.hrRosterEntry.update({
        where: { tenantId: ctx.tenantId, id: other.id },
        data: { employeeId: entry.employeeId, source: 'SWAP' },
      });
    } else {
      await tx.hrRosterEntry.update({
        where: { tenantId: ctx.tenantId, id: entry.id },
        data: { shiftId: request.requestedShiftId!, source: 'OVERRIDE' },
      });
    }

    return tx.hrShiftChangeRequest.update({
      where: { tenantId: ctx.tenantId, id: request.id },
      data: { status: 'APPROVED', approverId: actor?.id ?? null, decidedAt: new Date(), decisionNote: note?.trim() || null },
    });
  });

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_shift_change_request',
    recordId: request.id,
    metadata: {
      action: 'roster.change_approved',
      kind: request.kind,
      requesterId: request.requesterId,
      counterpartId: request.counterpartId,
    },
  });
  await notifyShiftChangeDecided(ctx, {
    // Both sides of a swap are told: the colleague whose day moved did not ask
    // for the change and would otherwise find out by looking at the roster.
    employeeIds: [request.requesterId, ...(request.counterpartId ? [request.counterpartId] : [])],
    approved: true,
    recordId: request.id,
  });
  return approved;
}

export async function cancelShiftChange(ctx: Ctx, requestId: string) {
  const request = await prisma.hrShiftChangeRequest.findFirst({ where: { tenantId: ctx.tenantId, id: requestId } });
  if (!request) throw NotFound('Shift change request');
  if (request.status !== 'PENDING') throw Conflict(`This request is already ${request.status.toLowerCase()}.`);

  const self = await myEmployee(ctx);
  if (self?.id !== request.requesterId && !isRosterApprover(ctx))
    throw Forbidden('You can only withdraw a request you raised.');

  const cancelled = await prisma.hrShiftChangeRequest.update({
    where: { tenantId: ctx.tenantId, id: request.id },
    data: { status: 'CANCELLED' },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_shift_change_request',
    recordId: request.id,
    metadata: { action: 'roster.change_cancelled', kind: request.kind },
  });
  return cancelled;
}

export async function listShiftChanges(ctx: Ctx, options: { status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' } = {}) {
  const self = await myEmployee(ctx);
  const approver = isRosterApprover(ctx);
  if (!approver && !self) return [];

  return prisma.hrShiftChangeRequest.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: options.status,
      ...(approver ? {} : { OR: [{ requesterId: self!.id }, { counterpartId: self!.id }] }),
    },
    include: {
      requester: EMPLOYEE_WITH_PERSON,
      counterpart: EMPLOYEE_WITH_PERSON,
      entry: { include: { shift: true } },
      counterpartEntry: { include: { shift: true } },
      requestedShift: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}
