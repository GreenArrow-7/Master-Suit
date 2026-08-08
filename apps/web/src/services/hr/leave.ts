/**
 * Leave engine: entitlement, accrual, balance, overlap, approval chain.
 *
 * Ported from the original HRMS `app/services/leave.py` and `app/api/leave.py`.
 * The rules that matter and are easy to lose in a port:
 *   - weekends and public holidays never consume balance;
 *   - a paid request cannot exceed available balance, checked again at approval
 *     time because the balance moves between request and decision;
 *   - nobody approves their own leave.
 */
import { prisma, type TxClient } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { annualLeaveAccrued, dayKey, daysBetween, toDay, workingDays } from './rules';
import { getHrPolicy, type HrPolicy } from './settings';
import { isApprover, isHrAdmin } from './access';
import { EMPLOYEE_WITH_PERSON } from './publicSelect';

// Re-exported so the many existing call sites keep one import for HR access.
export { isApprover, isHrAdmin };

/** Statuses that consume balance and block an overlapping request. */
export const BLOCKING_STATUSES = ['PENDING', 'APPROVED'] as const;

/** Roles at or above this rank can be the fallback approver. 10 is company_admin. */
const ADMIN_ROLE_RANK = 10;

type Db = TxClient | typeof prisma;

// ── Actor helpers ──────────────────────────────────────────────────────────

/** The acting user's own employee record. Not every workspace user has one. */
export async function myEmployee(ctx: Ctx, db: Db = prisma) {
  return db.employeeProfile.findFirst({
    where: { tenantId: ctx.tenantId, deletedAt: null, membership: { salesUserId: ctx.actor.id } },
  });
}

export async function requireEmployee(ctx: Ctx, employeeId: string, db: Db = prisma) {
  const employee = await db.employeeProfile.findFirst({
    where: { tenantId: ctx.tenantId, id: employeeId, deletedAt: null },
  });
  if (!employee) throw NotFound('Employee');
  return employee;
}

// ── Calendar ───────────────────────────────────────────────────────────────

export async function holidaysFor(ctx: Ctx, start: Date, end: Date, db: Db = prisma) {
  const rows = await db.hrHoliday.findMany({
    where: { tenantId: ctx.tenantId, holidayDate: { gte: toDay(start), lte: toDay(end) } },
    orderBy: { holidayDate: 'asc' },
  });
  return rows;
}

export async function countLeaveDays(
  ctx: Ctx,
  start: Date,
  end: Date,
  halfDay: boolean,
  db: Db = prisma,
  known?: HrPolicy,
) {
  const [holidayRows, policy] = await Promise.all([holidaysFor(ctx, start, end, db), known ?? getHrPolicy(ctx)]);
  const holidays = holidayRows.map((holiday) => holiday.holidayDate);
  if (halfDay) {
    if (dayKey(start) !== dayKey(end)) throw new Error('A half day must start and end on the same date.');
    return workingDays(start, end, holidays, policy.weekendDays) ? 0.5 : 0;
  }
  return workingDays(start, end, holidays, policy.weekendDays);
}

// ── Balances ───────────────────────────────────────────────────────────────

export async function ensureBalanceRow(
  ctx: Ctx,
  employeeId: string,
  leaveTypeId: string,
  year: number,
  db: Db = prisma,
) {
  const leaveType = await db.hrLeaveType.findFirst({ where: { tenantId: ctx.tenantId, id: leaveTypeId } });
  if (!leaveType) throw NotFound('Leave type');
  return db.hrLeaveBalance.upsert({
    where: { tenantId_employeeId_leaveTypeId_year: { tenantId: ctx.tenantId, employeeId, leaveTypeId, year } },
    update: {},
    create: { tenantId: ctx.tenantId, employeeId, leaveTypeId, year, entitledDays: leaveType.annualAllowance },
  });
}

/**
 * Accruing types (annual) build up month by month. Non-accruing types (sick,
 * maternity) are available in full from day one — they are event-driven, not earned.
 */
export async function recomputeAccrual(
  ctx: Ctx,
  employee: { id: string; joinedOn: Date | null },
  leaveType: { id: string; accrues: boolean; annualAllowance: number },
  asOf: Date,
  db: Db = prisma,
  known?: HrPolicy,
) {
  const year = toDay(asOf).getUTCFullYear();
  await ensureBalanceRow(ctx, employee.id, leaveType.id, year, db);
  const policy = known ?? (await getHrPolicy(ctx));
  const accruedDays = leaveType.accrues
    ? employee.joinedOn
      ? annualLeaveAccrued(employee.joinedOn, asOf, policy)
      : 0
    : leaveType.annualAllowance;

  return db.hrLeaveBalance.update({
    where: {
      tenantId_employeeId_leaveTypeId_year: {
        tenantId: ctx.tenantId,
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        year,
      },
    },
    data: { accruedDays },
  });
}

/** Accrued + carried forward − consumed, recomputed from the requests themselves. */
export async function availableDays(
  ctx: Ctx,
  employee: { id: string; joinedOn: Date | null },
  leaveType: { id: string; accrues: boolean; annualAllowance: number },
  asOf: Date = new Date(),
  db: Db = prisma,
  known?: HrPolicy,
) {
  const year = toDay(asOf).getUTCFullYear();
  const balance = await recomputeAccrual(ctx, employee, leaveType, asOf, db, known);

  const consuming = await db.hrLeaveRequest.findMany({
    where: {
      tenantId: ctx.tenantId,
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      status: { in: [...BLOCKING_STATUSES] },
      startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
    },
    select: { days: true },
  });
  const takenDays = consuming.reduce((total, row) => total + row.days, 0);

  const updated = await db.hrLeaveBalance.update({
    where: {
      tenantId_employeeId_leaveTypeId_year: {
        tenantId: ctx.tenantId,
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        year,
      },
    },
    data: { takenDays },
  });

  return {
    balance: updated,
    available: round2(balance.accruedDays + updated.carriedForwardDays - takenDays),
  };
}

/** Every leave type with the employee's live position against it. */
export async function balancesFor(ctx: Ctx, employeeId: string, asOf: Date = new Date()) {
  const [employee, types, policy] = await Promise.all([
    requireEmployee(ctx, employeeId),
    prisma.hrLeaveType.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, orderBy: { name: 'asc' } }),
    getHrPolicy(ctx),
  ]);

  return Promise.all(
    types.map(async (leaveType) => {
      const { balance, available } = await availableDays(ctx, employee, leaveType, asOf, prisma, policy);
      return {
        leaveTypeId: leaveType.id,
        code: leaveType.code,
        name: leaveType.name,
        paid: leaveType.paid,
        entitledDays: balance.entitledDays,
        accruedDays: balance.accruedDays,
        carriedForwardDays: balance.carriedForwardDays,
        takenDays: balance.takenDays,
        availableDays: available,
      };
    }),
  );
}

// ── Approval chain ─────────────────────────────────────────────────────────

/**
 * Line manager first. If there is none, or they have left, the highest-ranking
 * active administrator picks it up — a request with no approver can never be
 * decided, so falling back is not optional.
 */
export async function approverFor(
  ctx: Ctx,
  employee: { id: string; managerMembershipId: string | null },
  db: Db = prisma,
) {
  if (employee.managerMembershipId) {
    const manager = await db.employeeProfile.findFirst({
      where: {
        tenantId: ctx.tenantId,
        membershipId: employee.managerMembershipId,
        deletedAt: null,
        employmentStatus: { notIn: ['EXITED'] },
        membership: { status: 'ACTIVE' },
      },
    });
    if (manager) return manager;
  }

  // Filtered and ordered in the database. Loading every active employee to pick
  // one administrator in JavaScript is fine at ten staff and a problem at a
  // thousand, and it is the same query either way.
  return db.employeeProfile.findFirst({
    where: {
      tenantId: ctx.tenantId,
      deletedAt: null,
      id: { not: employee.id },
      employmentStatus: { notIn: ['EXITED'] },
      membership: {
        status: 'ACTIVE',
        salesUser: { status: 'ACTIVE', deletedAt: null, role: { rank: { lte: ADMIN_ROLE_RANK } } },
      },
    },
    orderBy: { membership: { salesUser: { role: { rank: 'asc' } } } },
  });
}

export async function findOverlap(
  ctx: Ctx,
  employeeId: string,
  start: Date,
  end: Date,
  excludeId?: string,
  db: Db = prisma,
) {
  return db.hrLeaveRequest.findFirst({
    where: {
      tenantId: ctx.tenantId,
      employeeId,
      status: { in: [...BLOCKING_STATUSES] },
      startDate: { lte: toDay(end) },
      endDate: { gte: toDay(start) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

// ── Workflows ──────────────────────────────────────────────────────────────

export interface ApplyLeaveInput {
  employeeId?: string;
  leaveTypeId: string;
  startDate: Date;
  endDate: Date;
  halfDay?: boolean;
  reason?: string;
  documentId?: string;
}

export async function applyForLeave(ctx: Ctx, input: ApplyLeaveInput) {
  // An employee applies for themselves; HR may record leave on anyone's behalf.
  const self = await myEmployee(ctx);
  const employeeId = input.employeeId ?? self?.id;
  if (!employeeId) throw NotFound('Employee');
  if (employeeId !== self?.id && !isHrAdmin(ctx)) throw Forbidden('You can only apply for your own leave.');

  const employee = await requireEmployee(ctx, employeeId);
  if (employee.employmentStatus === 'EXITED') throw Forbidden('This account is closed. Contact HR.');

  const leaveType = await prisma.hrLeaveType.findFirst({ where: { tenantId: ctx.tenantId, id: input.leaveTypeId } });
  if (!leaveType) throw NotFound('Leave type');

  const start = toDay(input.startDate);
  const end = toDay(input.endDate);
  if (end < start) throw new Error('End date must be on or after the start date.');

  const policy = await getHrPolicy(ctx);
  const backdated = daysBetween(start, new Date());
  if (backdated > policy.leaveMaxBackdateDays && !isHrAdmin(ctx)) {
    throw Conflict(
      `You cannot apply more than ${policy.leaveMaxBackdateDays} days after the leave started. Ask HR to record it for you.`,
    );
  }
  if (leaveType.requiresDocument && !input.documentId) {
    throw Conflict(`${leaveType.name} needs a supporting document.`);
  }

  const clash = await findOverlap(ctx, employee.id, start, end);
  if (clash)
    throw Conflict(
      `Leave already exists from ${dayKey(clash.startDate)} to ${dayKey(clash.endDate)}. Cancel it first.`,
    );

  const days = await countLeaveDays(ctx, start, end, input.halfDay ?? false, prisma, policy);
  if (days <= 0) throw Conflict('Those dates are all weekends or public holidays — no leave is needed.');

  if (leaveType.paid) {
    const { available } = await availableDays(ctx, employee, leaveType, start, prisma, policy);
    if (days > available)
      throw Conflict(`${available} days of ${leaveType.name} are available and ${days} were requested.`);
  }

  const approver = await approverFor(ctx, employee);
  if (!approver) throw Conflict('No approver is set up for this employee. Contact HR.');

  const request = await prisma.hrLeaveRequest.create({
    data: {
      tenantId: ctx.tenantId,
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      startDate: start,
      endDate: end,
      days,
      halfDay: input.halfDay ?? false,
      reason: input.reason ?? null,
      documentId: input.documentId ?? null,
      status: 'PENDING',
      approverId: approver.id,
    },
    include: { leaveType: true, employee: EMPLOYEE_WITH_PERSON },
  });

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_leave_request',
    recordId: request.id,
    metadata: { action: 'leave.applied', leaveType: leaveType.code, days, from: dayKey(start), to: dayKey(end) },
  });
  return request;
}

export async function decideLeave(ctx: Ctx, requestId: string, approve: boolean, note?: string) {
  if (!approve && !note) throw Conflict('Give a reason so the employee knows why the request was rejected.');
  if (!isApprover(ctx)) throw Forbidden('Your role does not allow leave decisions.');

  const request = await prisma.hrLeaveRequest.findFirst({
    where: { tenantId: ctx.tenantId, id: requestId },
    include: { employee: true, leaveType: true },
  });
  if (!request) throw NotFound('Leave request');
  if (request.status !== 'PENDING') throw Conflict(`This request is already ${request.status.toLowerCase()}.`);

  const self = await myEmployee(ctx);
  if (self && request.employeeId === self.id) throw Forbidden('You cannot approve your own leave.');
  if (!isHrAdmin(ctx) && request.approverId !== self?.id) throw Forbidden('This request is not assigned to you.');

  // The balance moves between application and decision — re-check before approving.
  if (approve && request.leaveType.paid) {
    const { available } = await availableDays(ctx, request.employee, request.leaveType, request.startDate);
    if (request.days > available) {
      throw Conflict(
        `Only ${available} days of ${request.leaveType.name} remain. Reject the request or ask for it to be shortened.`,
      );
    }
  }

  const decided = await prisma.hrLeaveRequest.update({
    where: { tenantId: ctx.tenantId, id: request.id },
    data: {
      status: approve ? 'APPROVED' : 'REJECTED',
      approverId: self?.id ?? request.approverId,
      decidedAt: new Date(),
      decisionNote: note ?? null,
    },
    include: { leaveType: true, employee: EMPLOYEE_WITH_PERSON },
  });

  // Keep the stored balance in step with the decision straight away.
  await availableDays(ctx, request.employee, request.leaveType, request.startDate);

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_leave_request',
    recordId: decided.id,
    previousValue: { status: request.status },
    newValue: { status: decided.status },
    metadata: { action: approve ? 'leave.approved' : 'leave.rejected', days: decided.days },
  });
  return decided;
}

export async function cancelLeave(ctx: Ctx, requestId: string) {
  const request = await prisma.hrLeaveRequest.findFirst({
    where: { tenantId: ctx.tenantId, id: requestId },
    include: { employee: true, leaveType: true },
  });
  if (!request) throw NotFound('Leave request');

  const self = await myEmployee(ctx);
  const own = self && request.employeeId === self.id;
  if (!own && !isHrAdmin(ctx)) throw Forbidden('You can only cancel your own leave.');
  if (request.status === 'CANCELED' || request.status === 'REJECTED') throw Conflict('This request is already closed.');
  if (request.status === 'APPROVED' && toDay(request.endDate) < toDay(new Date()) && !isHrAdmin(ctx)) {
    throw Conflict('This leave has already been taken. Ask HR to amend it.');
  }

  const cancelled = await prisma.hrLeaveRequest.update({
    where: { tenantId: ctx.tenantId, id: request.id },
    data: { status: 'CANCELED', cancelledAt: new Date(), cancelledById: self?.id ?? null },
    include: { leaveType: true, employee: EMPLOYEE_WITH_PERSON },
  });

  // Cancelling releases the days it was holding.
  await availableDays(ctx, request.employee, request.leaveType, request.startDate);

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_leave_request',
    recordId: cancelled.id,
    previousValue: { status: request.status },
    newValue: { status: 'CANCELED' },
    metadata: { action: 'leave.cancelled' },
  });
  return cancelled;
}

/**
 * Year end: unused annual leave rolls into the next year up to the policy cap.
 * Only accruing types carry forward — sick leave does not bank.
 */
export async function runCarryForward(ctx: Ctx, fromYear: number) {
  if (!isHrAdmin(ctx)) throw Forbidden('Only an administrator can run year-end carry-forward.');

  const [types, employees] = await Promise.all([
    prisma.hrLeaveType.findMany({ where: { tenantId: ctx.tenantId, accrues: true, isActive: true } }),
    prisma.employeeProfile.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
    }),
  ]);

  const rolled: { employeeId: string; leaveType: string; days: number }[] = [];
  for (const employee of employees) {
    for (const leaveType of types) {
      const previous = await prisma.hrLeaveBalance.findFirst({
        where: { tenantId: ctx.tenantId, employeeId: employee.id, leaveTypeId: leaveType.id, year: fromYear },
      });
      if (!previous) continue;

      const unused = Math.max(previous.accruedDays + previous.carriedForwardDays - previous.takenDays, 0);
      const days = round2(Math.min(unused, leaveType.maxCarryForward));
      if (days <= 0) continue;

      await ensureBalanceRow(ctx, employee.id, leaveType.id, fromYear + 1);
      await prisma.hrLeaveBalance.update({
        where: {
          tenantId_employeeId_leaveTypeId_year: {
            tenantId: ctx.tenantId,
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            year: fromYear + 1,
          },
        },
        data: { carriedForwardDays: days },
      });
      rolled.push({ employeeId: employee.id, leaveType: leaveType.code, days });
    }
  }

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_leave_balance',
    metadata: { action: 'leave.carry_forward', fromYear, balancesRolled: rolled.length },
  });
  return { fromYear, rolled };
}

/** Who is out and when, plus the holidays in the window. */
export async function teamCalendar(ctx: Ctx, start: Date, end: Date) {
  const self = await myEmployee(ctx);
  const scope = isHrAdmin(ctx)
    ? {}
    : isApprover(ctx)
      ? { OR: [{ approverId: self?.id ?? '' }, { employeeId: self?.id ?? '' }] }
      : { employeeId: self?.id ?? '' };

  const [leave, holidays] = await Promise.all([
    prisma.hrLeaveRequest.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: 'APPROVED',
        startDate: { lte: toDay(end) },
        endDate: { gte: toDay(start) },
        ...scope,
      },
      include: { leaveType: true, employee: EMPLOYEE_WITH_PERSON },
      orderBy: { startDate: 'asc' },
    }),
    holidaysFor(ctx, start, end),
  ]);
  return { leave, holidays };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
