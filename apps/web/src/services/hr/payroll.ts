/**
 * Payroll: effective-dated pay, a maker-checker run, and payslips that stay
 * reproducible after the policy behind them changes.
 *
 * The integration rule from §108 is the one that shapes this file: payroll
 * consumes *approved* HR state, never raw client input and never raw attendance.
 * Concretely —
 *
 *   * pay comes from `HrCompensation`, the effective-dated history, not from the
 *     mutable `EmployeeProfile.basicSalary` column;
 *   * overtime comes from `approvedOvertimeMinutes`, so an unreviewed approval
 *     queue produces zero overtime rather than a silently inflated payslip;
 *   * unpaid absence comes from APPROVED leave on an unpaid type;
 *   * one-off money comes from `HrPayrollAdjustment` rows entered and audited
 *     before the run, and each is stamped as consumed so it cannot be paid twice.
 *
 * Recalculation is destructive by design, and only DRAFT runs allow it: the
 * payslips are rebuilt from scratch each time so a run can never be a mix of two
 * calculations. Once approved the figures are evidence; LOCKED additionally
 * freezes the overtime claims the run consumed, so a payslip already issued
 * keeps reconciling against the hours behind it.
 */
import { Prisma } from '@prisma/client';
import { prisma, withTx } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { dayKey, toDay } from './rules';
import { myEmployee, requireEmployee } from './leave';
import { approvedOvertimeMinutes } from './overtime';
import { getHrPolicy, type HrPolicy } from './settings';
import { EMPLOYEE_WITH_PERSON } from './publicSelect';
import { notifyPayrollDecided, notifyPayrollSubmitted, notifyPayslipsAvailable } from './notify';

/** Prepares runs and enters compensation. Does not approve them. */
export const isPayrollOfficer = (ctx: Ctx) => SCOPE_RANK[scopeFor(ctx, 'payroll', 'EDIT')] >= SCOPE_RANK.ORGANIZATION;

/** Signs a run off. Deliberately separate from preparing it — see `approveRun`. */
export const isPayrollApprover = (ctx: Ctx) =>
  SCOPE_RANK[scopeFor(ctx, 'payroll', 'APPROVE')] >= SCOPE_RANK.ORGANIZATION;

/** Reads other people's pay. Everyone can read their own without this. */
export const mayReadPayroll = (ctx: Ctx) => SCOPE_RANK[scopeFor(ctx, 'payroll', 'VIEW')] >= SCOPE_RANK.ORGANIZATION;

const money = (value: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(value ?? 0);

/** The period as people say it, used in notifications. */
const periodLabel = (run: { periodStart: Date; periodEnd: Date }) =>
  `${dayKey(run.periodStart)} – ${dayKey(run.periodEnd)}`;
const round2 = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

// ── Compensation history ───────────────────────────────────────────────────

export interface CompensationInput {
  employeeId: string;
  effectiveFrom: Date;
  basic: number;
  housing?: number;
  transport?: number;
  otherAllowance?: number;
  changeReason?: string;
}

/**
 * Record a salary as of a date. A raise is a new row; nothing is ever edited.
 *
 * The profile's `basicSalary`/`totalSalary` columns are updated alongside only
 * when this is the *latest* record, because the rest of the application (the
 * gratuity calculation especially) still reads them as "current pay". Writing
 * them from a backdated correction would make today's gratuity use last year's
 * salary.
 */
export async function setCompensation(ctx: Ctx, input: CompensationInput) {
  if (!isPayrollOfficer(ctx)) throw Forbidden('Only payroll can record compensation.');
  await requireEmployee(ctx, input.employeeId);

  if (input.basic <= 0) throw Conflict('Basic pay must be greater than zero.');
  for (const [label, value] of [
    ['Housing', input.housing],
    ['Transport', input.transport],
    ['Other allowances', input.otherAllowance],
  ] as const) {
    if (value !== undefined && value < 0) throw Conflict(`${label} cannot be negative.`);
  }

  const effectiveFrom = toDay(input.effectiveFrom);
  const actor = await myEmployee(ctx);

  const created = await withTx(ctx.tenantId, async (tx) => {
    const row = await tx.hrCompensation.upsert({
      where: {
        tenantId_employeeId_effectiveFrom: { tenantId: ctx.tenantId, employeeId: input.employeeId, effectiveFrom },
      },
      update: {
        basic: input.basic,
        housing: input.housing ?? 0,
        transport: input.transport ?? 0,
        otherAllowance: input.otherAllowance ?? 0,
        changeReason: input.changeReason?.trim() || null,
      },
      create: {
        tenantId: ctx.tenantId,
        employeeId: input.employeeId,
        effectiveFrom,
        basic: input.basic,
        housing: input.housing ?? 0,
        transport: input.transport ?? 0,
        otherAllowance: input.otherAllowance ?? 0,
        changeReason: input.changeReason?.trim() || null,
        createdById: actor?.id ?? null,
      },
    });

    const latest = await tx.hrCompensation.findFirst({
      where: { tenantId: ctx.tenantId, employeeId: input.employeeId },
      orderBy: { effectiveFrom: 'desc' },
      select: { id: true, basic: true, housing: true, transport: true, otherAllowance: true },
    });
    if (latest?.id === row.id) {
      await tx.employeeProfile.update({
        where: { tenantId: ctx.tenantId, id: input.employeeId },
        data: {
          basicSalary: row.basic,
          totalSalary: money(row.basic).plus(row.housing).plus(row.transport).plus(row.otherAllowance),
        },
      });
    }
    return row;
  });

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_compensation',
    recordId: created.id,
    metadata: {
      action: 'payroll.compensation.set',
      employeeId: input.employeeId,
      effectiveFrom: dayKey(effectiveFrom),
      reason: created.changeReason,
    },
  });
  return created;
}

/** The salary in force on a date — the latest record starting on or before it. */
export async function compensationAsOf(ctx: Ctx, employeeId: string, asOf: Date) {
  return prisma.hrCompensation.findFirst({
    where: { tenantId: ctx.tenantId, employeeId, effectiveFrom: { lte: toDay(asOf) } },
    orderBy: { effectiveFrom: 'desc' },
  });
}

export async function compensationHistory(ctx: Ctx, employeeId: string) {
  const self = await myEmployee(ctx);
  // Pay is the most sensitive field in HR. Managing someone does not confer it —
  // that is §90, and it is why this checks `payroll:VIEW` rather than a
  // reporting-line helper.
  if (!mayReadPayroll(ctx) && self?.id !== employeeId)
    throw Forbidden('You can only see your own compensation history.');
  return prisma.hrCompensation.findMany({
    where: { tenantId: ctx.tenantId, employeeId },
    orderBy: { effectiveFrom: 'desc' },
  });
}

// ── Adjustments ────────────────────────────────────────────────────────────

export interface AdjustmentInput {
  employeeId: string;
  effectiveOn: Date;
  code: string;
  label: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: number;
  reason?: string;
}

export async function addAdjustment(ctx: Ctx, input: AdjustmentInput) {
  if (!isPayrollOfficer(ctx)) throw Forbidden('Only payroll can enter an adjustment.');
  await requireEmployee(ctx, input.employeeId);
  if (input.amount <= 0) throw Conflict('Enter the amount as a positive number and pick earning or deduction.');

  const actor = await myEmployee(ctx);
  const created = await prisma.hrPayrollAdjustment.create({
    data: {
      tenantId: ctx.tenantId,
      employeeId: input.employeeId,
      effectiveOn: toDay(input.effectiveOn),
      code: input.code.trim().toUpperCase(),
      label: input.label.trim(),
      kind: input.kind,
      amount: input.amount,
      reason: input.reason?.trim() || null,
      createdById: actor?.id ?? null,
    },
  });
  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_payroll_adjustment',
    recordId: created.id,
    metadata: {
      action: 'payroll.adjustment.added',
      employeeId: input.employeeId,
      kind: input.kind,
      amount: input.amount,
      code: created.code,
    },
  });
  return created;
}

// ── Runs ───────────────────────────────────────────────────────────────────

export async function createRun(ctx: Ctx, periodStart: Date, periodEnd: Date, note?: string) {
  if (!isPayrollOfficer(ctx)) throw Forbidden('Only payroll can open a run.');
  const start = toDay(periodStart);
  const end = toDay(periodEnd);
  if (end < start) throw Conflict('The end of the period must be on or after its start.');

  const actor = await myEmployee(ctx);
  try {
    const run = await prisma.hrPayrollRun.create({
      data: {
        tenantId: ctx.tenantId,
        periodStart: start,
        periodEnd: end,
        note: note?.trim() || null,
        preparedById: actor?.id ?? null,
      },
    });
    await audit(ctx, {
      event: 'RECORD_CREATED',
      objectType: 'hr_payroll_run',
      recordId: run.id,
      metadata: { action: 'payroll.run.created', period: `${dayKey(start)}..${dayKey(end)}` },
    });
    return run;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw Conflict('A run already exists for that period. Open it instead of creating a second one.');
    throw error;
  }
}

interface PayslipDraft {
  employeeId: string;
  basic: Prisma.Decimal;
  gross: Prisma.Decimal;
  deductions: Prisma.Decimal;
  net: Prisma.Decimal;
  unpaidDays: number;
  overtimeMinutes: number;
  ibanSnapshot: string | null;
  lines: { code: string; label: string; kind: 'EARNING' | 'DEDUCTION'; amount: Prisma.Decimal; sortOrder: number }[];
  inputs: Prisma.InputJsonValue;
  adjustmentIds: string[];
}

/**
 * Rebuild every payslip in a DRAFT run.
 *
 * Destructive and idempotent together: existing payslips are deleted and
 * recalculated inside one transaction, so a run is never half of one
 * calculation and half of another, and running it twice gives the same answer.
 */
export async function calculateRun(ctx: Ctx, runId: string) {
  if (!isPayrollOfficer(ctx)) throw Forbidden('Only payroll can calculate a run.');
  const run = await prisma.hrPayrollRun.findFirst({ where: { tenantId: ctx.tenantId, id: runId } });
  if (!run) throw NotFound('Payroll run');
  if (run.status !== 'DRAFT')
    throw Conflict(`A ${run.status.toLowerCase().replace('_', ' ')} run cannot be recalculated.`);

  const policy = await getHrPolicy(ctx);
  const employees = await prisma.employeeProfile.findMany({
    where: {
      tenantId: ctx.tenantId,
      deletedAt: null,
      employmentStatus: { notIn: ['EXITED'] },
      // Anyone who had not joined by the end of the period has nothing to be
      // paid for; anyone who left before it started is handled by settlement.
      //
      // Compared against the *end* of that last day, not its midnight.
      // `createRun` normalises periodEnd with toDay, while joinedOn carries the
      // time somebody was hired — so `joinedOn <= periodEnd` excluded anyone
      // hired on the final day of the period, who had nonetheless worked it.
      OR: [{ joinedOn: null }, { joinedOn: { lt: new Date(toDay(run.periodEnd).getTime() + 86_400_000) } }],
    },
    select: { id: true, joinedOn: true, iban: true, basicSalary: true, totalSalary: true },
  });
  if (!employees.length) throw Conflict('There are no employees to pay in this period.');

  const employeeIds = employees.map((employee) => employee.id);
  const [overtimeTotals, unpaidLeave, adjustments] = await Promise.all([
    approvedOvertimeMinutes(ctx, employeeIds, run.periodStart, run.periodEnd),
    unpaidLeaveDays(ctx, employeeIds, run.periodStart, run.periodEnd),
    prisma.hrPayrollAdjustment.findMany({
      where: {
        tenantId: ctx.tenantId,
        employeeId: { in: employeeIds },
        consumedByRunId: null,
        effectiveOn: { gte: run.periodStart, lte: run.periodEnd },
      },
    }),
  ]);

  const overtimeBy = new Map(overtimeTotals.map((total) => [total.employeeId, total]));
  const adjustmentsBy = new Map<string, typeof adjustments>();
  for (const adjustment of adjustments) {
    const list = adjustmentsBy.get(adjustment.employeeId) ?? [];
    list.push(adjustment);
    adjustmentsBy.set(adjustment.employeeId, list);
  }

  const drafts: PayslipDraft[] = [];
  for (const employee of employees) {
    const compensation = await compensationAsOf(ctx, employee.id, run.periodEnd);
    // Falling back to the profile keeps a workspace that never entered a
    // compensation record payable, rather than silently paying them nothing.
    const basic = money(compensation?.basic ?? employee.basicSalary);
    if (basic.lessThanOrEqualTo(0)) continue;

    const housing = money(compensation?.housing);
    const transport = money(compensation?.transport);
    const other = money(compensation?.otherAllowance);
    const draft = buildPayslip({
      employeeId: employee.id,
      basic,
      housing,
      transport,
      other,
      unpaidDays: unpaidLeave.get(employee.id) ?? 0,
      overtime: overtimeBy.get(employee.id) ?? { employeeId: employee.id, minutes: 0, weightedMinutes: 0 },
      adjustments: adjustmentsBy.get(employee.id) ?? [],
      iban: employee.iban ?? null,
      policy,
    });
    drafts.push(draft);
  }

  const totals = drafts.reduce(
    (accumulator, draft) => ({
      gross: accumulator.gross.plus(draft.gross),
      net: accumulator.net.plus(draft.net),
    }),
    { gross: money(0), net: money(0) },
  );

  await withTx(ctx.tenantId, async (tx) => {
    await tx.hrPayslip.deleteMany({ where: { tenantId: ctx.tenantId, runId: run.id } });
    for (const draft of drafts) {
      await tx.hrPayslip.create({
        data: {
          tenantId: ctx.tenantId,
          runId: run.id,
          employeeId: draft.employeeId,
          currency: run.currency,
          basic: draft.basic,
          grossEarnings: draft.gross,
          totalDeductions: draft.deductions,
          netPay: draft.net,
          unpaidDays: draft.unpaidDays,
          overtimeMinutes: draft.overtimeMinutes,
          ibanSnapshot: draft.ibanSnapshot,
          inputs: draft.inputs,
          lines: {
            create: draft.lines.map((line) => ({
              tenantId: ctx.tenantId,
              code: line.code,
              label: line.label,
              kind: line.kind,
              amount: line.amount,
              sortOrder: line.sortOrder,
            })),
          },
        },
      });
    }
    await tx.hrPayrollRun.update({
      where: { tenantId: ctx.tenantId, id: run.id },
      data: {
        calculatedAt: new Date(),
        grossTotal: round2(totals.gross),
        netTotal: round2(totals.net),
        policySnapshot: policy as unknown as Prisma.InputJsonValue,
      },
    });
  });

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_payroll_run',
    recordId: run.id,
    metadata: {
      action: 'payroll.run.calculated',
      payslips: drafts.length,
      gross: round2(totals.gross).toString(),
      net: round2(totals.net).toString(),
    },
  });
  return { payslips: drafts.length, gross: round2(totals.gross), net: round2(totals.net) };
}

interface BuildInput {
  employeeId: string;
  basic: Prisma.Decimal;
  housing: Prisma.Decimal;
  transport: Prisma.Decimal;
  other: Prisma.Decimal;
  unpaidDays: number;
  overtime: { minutes: number; weightedMinutes: number };
  adjustments: { id: string; code: string; label: string; kind: 'EARNING' | 'DEDUCTION'; amount: Prisma.Decimal }[];
  iban: string | null;
  policy: HrPolicy;
}

/**
 * One payslip, as pure arithmetic. Exported for the tests, which assert the
 * money without needing a database.
 *
 * The daily rate divides by a configured number of days (30 in the UAE) rather
 * than the real month length, so an unpaid day costs the same in February as in
 * March. The hourly rate for overtime divides the *basic* daily rate by the
 * contracted hours, because UAE law bases overtime on basic wage — configurable,
 * because a contract may be more generous.
 */
export function buildPayslip(input: BuildInput): PayslipDraft {
  const gross = input.basic.plus(input.housing).plus(input.transport).plus(input.other);
  const lines: PayslipDraft['lines'] = [
    { code: 'BASIC', label: 'Basic salary', kind: 'EARNING', amount: round2(input.basic), sortOrder: 0 },
  ];
  if (input.housing.greaterThan(0))
    lines.push({
      code: 'HOUSING',
      label: 'Housing allowance',
      kind: 'EARNING',
      amount: round2(input.housing),
      sortOrder: 1,
    });
  if (input.transport.greaterThan(0))
    lines.push({
      code: 'TRANSPORT',
      label: 'Transport allowance',
      kind: 'EARNING',
      amount: round2(input.transport),
      sortOrder: 2,
    });
  if (input.other.greaterThan(0))
    lines.push({
      code: 'OTHER',
      label: 'Other allowances',
      kind: 'EARNING',
      amount: round2(input.other),
      sortOrder: 3,
    });

  const dailyRate = gross.dividedBy(input.policy.payrollDaysPerMonth);
  const overtimeBase = input.policy.payrollOvertimeOnBasic ? input.basic : gross;
  const hourlyRate = overtimeBase
    .dividedBy(input.policy.payrollDaysPerMonth)
    .dividedBy(input.policy.payrollHoursPerDay);

  let earnings = gross;
  let deductions = money(0);

  const overtimeAmount = round2(hourlyRate.times(input.overtime.weightedMinutes).dividedBy(60));
  if (overtimeAmount.greaterThan(0)) {
    lines.push({
      code: 'OVERTIME',
      label: `Overtime (${(input.overtime.minutes / 60).toFixed(2)} h approved)`,
      kind: 'EARNING',
      amount: overtimeAmount,
      sortOrder: 10,
    });
    earnings = earnings.plus(overtimeAmount);
  }

  const unpaidAmount = round2(dailyRate.times(input.unpaidDays));
  if (unpaidAmount.greaterThan(0)) {
    lines.push({
      code: 'UNPAID',
      label: `Unpaid leave (${input.unpaidDays} d)`,
      kind: 'DEDUCTION',
      amount: unpaidAmount,
      sortOrder: 20,
    });
    deductions = deductions.plus(unpaidAmount);
  }

  let sortOrder = 30;
  for (const adjustment of input.adjustments) {
    const amount = round2(money(adjustment.amount));
    lines.push({
      code: adjustment.code,
      label: adjustment.label,
      kind: adjustment.kind,
      amount,
      sortOrder: sortOrder++,
    });
    if (adjustment.kind === 'EARNING') earnings = earnings.plus(amount);
    else deductions = deductions.plus(amount);
  }

  // Net can legitimately reach zero — a month of unpaid leave — but never below
  // it. A negative payslip means the company is invoicing the employee, which is
  // a recovery process, not a salary transfer.
  const net = round2(earnings.minus(deductions));
  return {
    employeeId: input.employeeId,
    basic: round2(input.basic),
    gross: round2(earnings),
    deductions: round2(deductions),
    net: net.greaterThan(0) ? net : money(0),
    unpaidDays: input.unpaidDays,
    overtimeMinutes: input.overtime.minutes,
    ibanSnapshot: input.iban,
    lines,
    adjustmentIds: input.adjustments.map((adjustment) => adjustment.id),
    inputs: {
      basic: input.basic.toString(),
      housing: input.housing.toString(),
      transport: input.transport.toString(),
      other: input.other.toString(),
      dailyRate: round2(dailyRate).toString(),
      hourlyRate: round2(hourlyRate).toString(),
      overtimeMinutes: input.overtime.minutes,
      overtimeWeightedMinutes: input.overtime.weightedMinutes,
      unpaidDays: input.unpaidDays,
      negativeNetClamped: net.lessThan(0),
      policy: {
        payrollDaysPerMonth: input.policy.payrollDaysPerMonth,
        payrollHoursPerDay: input.policy.payrollHoursPerDay,
        payrollOvertimeOnBasic: input.policy.payrollOvertimeOnBasic,
      },
    },
  };
}

/**
 * Unpaid days per employee in the period, from APPROVED leave on unpaid types.
 *
 * Counted by overlap rather than by the request's own `days` figure, because a
 * request may straddle the period boundary and only the part inside it belongs
 * to this run.
 */
async function unpaidLeaveDays(ctx: Ctx, employeeIds: string[], from: Date, to: Date): Promise<Map<string, number>> {
  const requests = await prisma.hrLeaveRequest.findMany({
    where: {
      tenantId: ctx.tenantId,
      employeeId: { in: employeeIds },
      status: 'APPROVED',
      leaveType: { paid: false },
      startDate: { lte: to },
      endDate: { gte: from },
    },
    select: { employeeId: true, startDate: true, endDate: true, days: true, halfDay: true },
  });

  const totals = new Map<string, number>();
  for (const request of requests) {
    const overlapStart = request.startDate > from ? request.startDate : from;
    const overlapEnd = request.endDate < to ? request.endDate : to;
    const requestSpan = Math.max(
      1,
      Math.round((toDay(request.endDate).getTime() - toDay(request.startDate).getTime()) / 86_400_000) + 1,
    );
    const overlapSpan = Math.max(
      0,
      Math.round((toDay(overlapEnd).getTime() - toDay(overlapStart).getTime()) / 86_400_000) + 1,
    );
    // Pro-rate the working-day count by how much of the request lands inside the
    // period. Exact for the common case of a request wholly inside one month.
    const share = overlapSpan >= requestSpan ? request.days : (request.days * overlapSpan) / requestSpan;
    totals.set(request.employeeId, (totals.get(request.employeeId) ?? 0) + share);
  }
  return totals;
}

// ── Workflow ───────────────────────────────────────────────────────────────

export async function submitRun(ctx: Ctx, runId: string) {
  if (!isPayrollOfficer(ctx)) throw Forbidden('Only payroll can submit a run for approval.');
  const run = await prisma.hrPayrollRun.findFirst({ where: { tenantId: ctx.tenantId, id: runId } });
  if (!run) throw NotFound('Payroll run');
  if (run.status !== 'DRAFT') throw Conflict('Only a draft run can be submitted.');
  if (!run.calculatedAt) throw Conflict('Calculate the run before submitting it.');

  const updated = await prisma.hrPayrollRun.update({
    where: { tenantId: ctx.tenantId, id: run.id },
    data: { status: 'PENDING_APPROVAL' },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_payroll_run',
    recordId: run.id,
    metadata: { action: 'payroll.run.submitted', previousStatus: run.status, net: run.netTotal.toString() },
  });
  await notifyPayrollSubmitted(ctx, {
    period: periodLabel(run),
    net: run.currency + ' ' + run.netTotal.toString(),
    recordId: run.id,
  });
  return updated;
}

/**
 * Sign a run off, or send it back.
 *
 * Maker-checker: whoever prepared the run cannot approve it. This is the control
 * that makes payroll auditable at all, so it is enforced on the record rather
 * than on the role — an officer who also holds the approval permission still
 * cannot approve their own work.
 */
export async function approveRun(ctx: Ctx, runId: string, approve: boolean, note?: string) {
  if (!isPayrollApprover(ctx)) throw Forbidden('Your role does not allow approving payroll.');
  const run = await prisma.hrPayrollRun.findFirst({ where: { tenantId: ctx.tenantId, id: runId } });
  if (!run) throw NotFound('Payroll run');
  if (run.status !== 'PENDING_APPROVAL') throw Conflict('Only a run awaiting approval can be decided.');

  const actor = await myEmployee(ctx);
  if (actor && run.preparedById && actor.id === run.preparedById)
    throw Conflict('You prepared this run, so somebody else must approve it.');

  const updated = await prisma.hrPayrollRun.update({
    where: { tenantId: ctx.tenantId, id: run.id },
    data: approve
      ? { status: 'APPROVED', approvedById: actor?.id ?? null, approvedAt: new Date(), note: note?.trim() || run.note }
      : { status: 'DRAFT', note: note?.trim() || run.note },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_payroll_run',
    recordId: run.id,
    metadata: {
      action: approve ? 'payroll.run.approved' : 'payroll.run.returned',
      previousStatus: run.status,
      preparedById: run.preparedById,
      net: run.netTotal.toString(),
    },
  });
  await notifyPayrollDecided(ctx, {
    preparedById: run.preparedById,
    approved: approve,
    period: periodLabel(run),
    recordId: run.id,
  });
  return updated;
}

/**
 * Lock an approved run.
 *
 * This is the step that reaches back into overtime: every claim the run paid is
 * stamped with `lockedAt` and the run id, so it can no longer be re-decided or
 * withdrawn. Consumed adjustments are stamped too, so the same bonus cannot
 * appear in next month's run.
 */
export async function lockRun(ctx: Ctx, runId: string) {
  if (!isPayrollApprover(ctx)) throw Forbidden('Your role does not allow locking payroll.');
  const run = await prisma.hrPayrollRun.findFirst({ where: { tenantId: ctx.tenantId, id: runId } });
  if (!run) throw NotFound('Payroll run');
  if (run.status !== 'APPROVED') throw Conflict('Only an approved run can be locked.');

  const locked = await withTx(ctx.tenantId, async (tx) => {
    const payslips = await tx.hrPayslip.findMany({
      where: { tenantId: ctx.tenantId, runId: run.id },
      select: { employeeId: true },
    });
    const employeeIds = payslips.map((payslip) => payslip.employeeId);

    const claims = await tx.hrOvertimeRequest.updateMany({
      where: {
        tenantId: ctx.tenantId,
        employeeId: { in: employeeIds },
        status: 'APPROVED',
        compensatory: false,
        lockedAt: null,
        workDate: { gte: run.periodStart, lte: run.periodEnd },
      },
      data: { lockedAt: new Date(), payrollRunId: run.id },
    });
    const consumed = await tx.hrPayrollAdjustment.updateMany({
      where: {
        tenantId: ctx.tenantId,
        employeeId: { in: employeeIds },
        consumedByRunId: null,
        effectiveOn: { gte: run.periodStart, lte: run.periodEnd },
      },
      data: { consumedByRunId: run.id },
    });
    const updated = await tx.hrPayrollRun.update({
      where: { tenantId: ctx.tenantId, id: run.id },
      data: { status: 'LOCKED', lockedAt: new Date() },
    });
    return { updated, claims: claims.count, consumed: consumed.count, employeeIds };
  });

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_payroll_run',
    recordId: run.id,
    metadata: {
      action: 'payroll.run.locked',
      overtimeClaimsLocked: locked.claims,
      adjustmentsConsumed: locked.consumed,
    },
  });
  // Locking is the point at which a payslip stops being able to change, so it is
  // the honest moment to tell people theirs is ready.
  await notifyPayslipsAvailable(ctx, {
    employeeIds: locked.employeeIds,
    period: periodLabel(run),
    recordId: run.id,
  });
  return locked.updated;
}

export async function markRunPaid(ctx: Ctx, runId: string) {
  if (!isPayrollApprover(ctx)) throw Forbidden('Your role does not allow marking payroll paid.');
  const run = await prisma.hrPayrollRun.findFirst({ where: { tenantId: ctx.tenantId, id: runId } });
  if (!run) throw NotFound('Payroll run');
  if (run.status !== 'LOCKED') throw Conflict('Lock the run before marking it paid.');

  const updated = await prisma.hrPayrollRun.update({
    where: { tenantId: ctx.tenantId, id: run.id },
    data: { status: 'PAID', paidAt: new Date() },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_payroll_run',
    recordId: run.id,
    metadata: { action: 'payroll.run.paid', net: run.netTotal.toString() },
  });
  return updated;
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function listRuns(ctx: Ctx, limit = 24) {
  if (!mayReadPayroll(ctx)) throw Forbidden('Your role does not allow reading payroll.');
  return prisma.hrPayrollRun.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { periodStart: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    include: {
      preparedBy: EMPLOYEE_WITH_PERSON,
      approvedBy: EMPLOYEE_WITH_PERSON,
      _count: { select: { payslips: true } },
    },
  });
}

export async function runDetail(ctx: Ctx, runId: string) {
  if (!mayReadPayroll(ctx)) throw Forbidden('Your role does not allow reading payroll.');
  const run = await prisma.hrPayrollRun.findFirst({
    where: { tenantId: ctx.tenantId, id: runId },
    include: {
      payslips: {
        include: { employee: EMPLOYEE_WITH_PERSON, lines: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { netPay: 'desc' },
      },
    },
  });
  if (!run) throw NotFound('Payroll run');
  return run;
}

/**
 * Payslips for one employee.
 *
 * Self-service by default: anyone may read their own without a payroll
 * permission, and nobody reaches anyone else's without `payroll:VIEW`. Only runs
 * that have been approved are visible to the employee — a draft is a working
 * figure, and showing it invites a conversation about a number that may change.
 */
export async function payslipsFor(ctx: Ctx, employeeId?: string) {
  const self = await myEmployee(ctx);
  const target = employeeId ?? self?.id;
  if (!target) return [];
  const mine = self?.id === target;
  if (!mine && !mayReadPayroll(ctx)) throw Forbidden('You can only see your own payslips.');

  return prisma.hrPayslip.findMany({
    where: {
      tenantId: ctx.tenantId,
      employeeId: target,
      ...(mine && !mayReadPayroll(ctx) ? { run: { status: { in: ['APPROVED', 'LOCKED', 'PAID'] } } } : {}),
    },
    include: { run: true, lines: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { createdAt: 'desc' },
    take: 36,
  });
}

/** One payslip, with the same rule as the list above. Used by the PDF route. */
export async function payslipDetail(ctx: Ctx, payslipId: string) {
  const payslip = await prisma.hrPayslip.findFirst({
    where: { tenantId: ctx.tenantId, id: payslipId },
    include: {
      run: true,
      lines: { orderBy: { sortOrder: 'asc' } },
      employee: EMPLOYEE_WITH_PERSON,
    },
  });
  if (!payslip) throw NotFound('Payslip');

  const self = await myEmployee(ctx);
  const mine = self?.id === payslip.employeeId;
  if (!mine && !mayReadPayroll(ctx)) throw Forbidden('You can only see your own payslips.');
  if (mine && !mayReadPayroll(ctx) && !['APPROVED', 'LOCKED', 'PAID'].includes(payslip.run.status))
    throw NotFound('Payslip');

  await audit(ctx, {
    event: 'DOCUMENT_ACCESSED',
    objectType: 'hr_payslip',
    recordId: payslip.id,
    metadata: { action: 'payroll.payslip.viewed', employeeId: payslip.employeeId, own: mine },
  });
  return payslip;
}
