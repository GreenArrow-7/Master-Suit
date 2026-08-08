/**
 * Onboarding and offboarding orchestration.
 *
 * Ported from the original HRMS `app/services/lifecycle.py` and
 * `app/api/lifecycle.py`. The checklist templates are UAE-specific: visa,
 * Emirates ID, labour card and WPS are sequenced because each one gates the
 * next. RERA/BRN steps apply to agents only — a broker selling without a valid
 * BRN exposes the firm to RERA penalties.
 *
 * Everything here fails closed. A blocking step left open means no activation
 * and no exit; that is the whole point of the checklist.
 */
import { prisma, withTx } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { revokeAllSessions } from '@/lib/auth/session';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { addDays, daysBetween, expirySeverity, gratuityUae, noticePayInLieu, toDay, type NoticeBasis } from './rules';
import { isHrAdmin, myEmployee, requireEmployee } from './leave';
import { getHrPolicy } from './settings';
import { EMPLOYEE_WITH_PERSON, MEMBERSHIP_PUBLIC } from './publicSelect';

export type ChecklistPhase = 'ONBOARDING' | 'OFFBOARDING';

/** [title, owner department, days from anchor, blocking]. Blocking gates activation/exit. */
type TemplateRow = readonly [string, string, number, boolean];

const ONBOARDING_TEMPLATE: TemplateRow[] = [
  ['Signed offer letter returned', 'HR', -7, true],
  ['MOHRE offer letter submitted', 'PRO', -5, true],
  ['Entry permit / employment visa', 'PRO', -3, true],
  ['Medical fitness test', 'PRO', 2, true],
  ['Emirates ID application', 'PRO', 3, true],
  ['Residence visa stamped', 'PRO', 10, true],
  ['Labour card issued', 'PRO', 14, true],
  ['WPS bank account opened', 'Finance', 7, true],
  ['Signed employment contract on file', 'HR', 0, true],
  ['Personal documents collected', 'HR', 0, true],
  ['Laptop and phone issued', 'IT', 0, false],
  ['Email and system accounts created', 'IT', -1, false],
  ['HRMS account and face enrolment', 'IT', 1, false],
  ['Health insurance enrolment', 'HR', 5, true],
  ['Induction and policy briefing', 'HR', 1, false],
  ['Desk and access card', 'Admin', 0, false],
];

const ONBOARDING_AGENT_EXTRAS: TemplateRow[] = [
  ['RERA certified practitioner course', 'HR', 14, true],
  ['BRN card issued and recorded', 'HR', 30, true],
  ['Listing portal accounts created', 'Marketing', 3, false],
  ['Commission structure acknowledged', 'Finance', 0, true],
];

const OFFBOARDING_TEMPLATE: TemplateRow[] = [
  ['Resignation / termination letter on file', 'HR', 0, true],
  ['Handover document completed', 'Line Mgr', 0, true],
  ['Active deals and pipeline reassigned', 'Line Mgr', 0, true],
  ['Laptop, phone and access card returned', 'IT', 0, true],
  ['System and email access revoked', 'IT', 0, true],
  ['HRMS sessions revoked', 'IT', 0, true],
  ['Company credit card and petty cash cleared', 'Finance', 0, true],
  ['Outstanding advances and loans settled', 'Finance', 0, true],
  ['Commission reconciliation signed off', 'Finance', 0, true],
  ['Final leave balance agreed', 'HR', 0, true],
  ['Gratuity calculation approved', 'Finance', 0, true],
  ['Visa cancellation submitted', 'PRO', 0, true],
  ['Labour card cancelled', 'PRO', 0, true],
  ['Health insurance cancelled', 'HR', 0, false],
  ['Experience certificate issued', 'HR', 0, false],
  ['Exit interview completed', 'HR', 0, false],
];

type EmployeeLike = {
  reraBrn: string | null;
  departmentCode: string | null;
  department?: { name: string; code: string } | null;
};

/**
 * Who gets the RERA onboarding track. The department list is workspace policy:
 * if your departments are named differently from the default, agents silently
 * miss their BRN steps, which is a regulatory exposure rather than a cosmetic one.
 */
export function isAgent(employee: EmployeeLike, agentDepartments: string[]): boolean {
  if (employee.reraBrn) return true;
  const known = new Set(agentDepartments.map((value) => value.trim().toLowerCase()));
  const names = [employee.department?.name, employee.department?.code, employee.departmentCode];
  return names.some((value) => value && known.has(value.trim().toLowerCase()));
}

function requireHr(ctx: Ctx) {
  if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can manage the employee lifecycle.');
}

// ── Checklists ─────────────────────────────────────────────────────────────

/** Anchor is the joining date for onboarding, the last working day for an exit. */
export async function buildChecklist(
  ctx: Ctx,
  employeeId: string,
  phase: ChecklistPhase,
  anchor: Date,
  agentTrack: boolean,
  db: any = prisma,
) {
  const template =
    phase === 'ONBOARDING'
      ? [...ONBOARDING_TEMPLATE, ...(agentTrack ? ONBOARDING_AGENT_EXTRAS : [])]
      : OFFBOARDING_TEMPLATE;

  // The [tenantId, employeeId, phase, title] unique key is what makes re-running
  // this safe: a second start adds only what is genuinely new.
  const created = await db.hrChecklistTask.createMany({
    data: template.map(([title, ownerDepartment, offset, blocking], sequence) => ({
      tenantId: ctx.tenantId,
      employeeId,
      phase,
      title,
      ownerDepartment,
      sequence,
      dueDate: addDays(anchor, offset),
      blocking,
    })),
    skipDuplicates: true,
  });
  return created.count as number;
}

export async function outstandingBlockers(ctx: Ctx, employeeId: string, phase: ChecklistPhase, db: any = prisma) {
  return db.hrChecklistTask.findMany({
    where: { tenantId: ctx.tenantId, employeeId, phase, blocking: true, completedAt: null },
    orderBy: { sequence: 'asc' },
  });
}

export async function checklistFor(ctx: Ctx, employeeId: string, phase?: ChecklistPhase) {
  const tasks = await prisma.hrChecklistTask.findMany({
    where: { tenantId: ctx.tenantId, employeeId, ...(phase ? { phase } : {}) },
    orderBy: [{ phase: 'asc' }, { sequence: 'asc' }],
  });
  const today = toDay(new Date());
  return tasks.map((task) => ({
    ...task,
    completed: task.completedAt !== null,
    overdue: task.completedAt === null && task.dueDate !== null && toDay(task.dueDate) < today,
  }));
}

export async function completeTask(ctx: Ctx, taskId: string, notes?: string) {
  const task = await prisma.hrChecklistTask.findFirst({ where: { tenantId: ctx.tenantId, id: taskId } });
  if (!task) throw NotFound('Checklist task');
  if (task.completedAt) throw Conflict('This task is already done.');

  const self = await myEmployee(ctx);
  const updated = await prisma.hrChecklistTask.update({
    where: { tenantId: ctx.tenantId, id: task.id },
    data: { completedAt: new Date(), completedById: self?.id ?? null, notes: notes ?? task.notes },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_checklist_task',
    recordId: task.id,
    metadata: { action: 'checklist.completed', title: task.title },
  });
  return updated;
}

/** Marking something done by mistake should not need a database edit. Audited. */
export async function reopenTask(ctx: Ctx, taskId: string) {
  requireHr(ctx);
  const task = await prisma.hrChecklistTask.findFirst({ where: { tenantId: ctx.tenantId, id: taskId } });
  if (!task) throw NotFound('Checklist task');
  if (!task.completedAt) throw Conflict('This task is already open.');

  const updated = await prisma.hrChecklistTask.update({
    where: { tenantId: ctx.tenantId, id: task.id },
    data: { completedAt: null, completedById: null },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_checklist_task',
    recordId: task.id,
    metadata: { action: 'checklist.reopened', title: task.title },
  });
  return updated;
}

export async function addTask(
  ctx: Ctx,
  input: {
    employeeId: string;
    phase: ChecklistPhase;
    title: string;
    ownerDepartment?: string;
    dueDate?: Date;
    blocking?: boolean;
  },
) {
  requireHr(ctx);
  await requireEmployee(ctx, input.employeeId);
  const last = await prisma.hrChecklistTask.findFirst({
    where: { tenantId: ctx.tenantId, employeeId: input.employeeId, phase: input.phase },
    orderBy: { sequence: 'desc' },
  });
  return prisma.hrChecklistTask.create({
    data: {
      tenantId: ctx.tenantId,
      employeeId: input.employeeId,
      phase: input.phase,
      title: input.title,
      ownerDepartment: input.ownerDepartment ?? null,
      dueDate: input.dueDate ?? null,
      blocking: input.blocking ?? false,
      sequence: (last?.sequence ?? -1) + 1,
    },
  });
}

// ── Onboarding ─────────────────────────────────────────────────────────────

export async function startOnboarding(ctx: Ctx, employeeId: string) {
  requireHr(ctx);
  const employee = await prisma.employeeProfile.findFirst({
    where: { tenantId: ctx.tenantId, id: employeeId, deletedAt: null },
    include: { department: true },
  });
  if (!employee) throw NotFound('Employee');
  if (employee.employmentStatus === 'EXITED') throw Conflict('This employee has already left.');

  const policy = await getHrPolicy(ctx);
  const agentTrack = isAgent(employee, policy.agentDepartments);
  const tasksCreated = await buildChecklist(
    ctx,
    employee.id,
    'ONBOARDING',
    employee.joinedOn ?? new Date(),
    agentTrack,
  );

  // Someone already working keeps their status — this is a checklist being
  // attached after the fact, not a demotion back into onboarding.
  if (employee.employmentStatus !== 'ACTIVE') {
    await prisma.employeeProfile.update({
      where: { tenantId: ctx.tenantId, id: employee.id },
      data: { employmentStatus: 'ONBOARDING' },
    });
  }

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'employee',
    recordId: employee.id,
    metadata: { action: 'onboarding.started', tasksCreated, agentTrack },
  });
  return { employeeId: employee.id, tasksCreated, agentTrack };
}

/**
 * Onboarding → active. Blocked while any gating task is open: an unstamped visa
 * or a missing labour card means they cannot legally work.
 */
export async function activateEmployee(ctx: Ctx, employeeId: string) {
  requireHr(ctx);
  const employee = await requireEmployee(ctx, employeeId);
  if (employee.employmentStatus === 'ACTIVE') throw Conflict('This employee is already active.');
  if (employee.employmentStatus === 'EXITED') throw Conflict('This employee has already left.');

  const blockers = await outstandingBlockers(ctx, employee.id, 'ONBOARDING');
  if (blockers.length) {
    throw Conflict(
      `${blockers.length} onboarding steps are still open: ${blockers.map((task: any) => task.title).join(', ')}.`,
    );
  }

  const updated = await prisma.employeeProfile.update({
    where: { tenantId: ctx.tenantId, id: employee.id },
    data: { employmentStatus: 'ACTIVE' },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'employee',
    recordId: employee.id,
    previousValue: { employmentStatus: employee.employmentStatus },
    newValue: { employmentStatus: 'ACTIVE' },
    metadata: { action: 'employee.activated' },
  });
  return updated;
}

// ── Documents ──────────────────────────────────────────────────────────────

/**
 * Visa, Emirates ID and BRN expiries. Feed this to a daily job: 90/60/30-day
 * windows are the useful triggers, because a UAE residence-visa renewal
 * realistically needs 30+ days of runway.
 */
export async function expiringDocuments(ctx: Ctx, withinDays?: number, employeeId?: string) {
  const days = withinDays ?? (await getHrPolicy(ctx)).documentExpiryHorizonDays;
  const horizon = addDays(new Date(), days);
  const documents = await prisma.hrEmployeeDocument.findMany({
    where: {
      tenantId: ctx.tenantId,
      expiresAt: { not: null, lte: horizon },
      ...(employeeId ? { employeeId } : {}),
      employee: { deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
    },
    include: { employee: EMPLOYEE_WITH_PERSON },
    orderBy: { expiresAt: 'asc' },
  });

  return documents.map((document) => {
    const daysRemaining = daysBetween(new Date(), document.expiresAt!);
    return {
      id: document.id,
      employeeId: document.employeeId,
      employeeName: document.employee.membership.platformUser.fullName,
      employeeNumber: document.employee.employeeNumber,
      kind: document.kind,
      number: document.number,
      expiresAt: document.expiresAt!,
      daysRemaining,
      severity: expirySeverity(daysRemaining),
    };
  });
}

// ── Offboarding and final settlement ───────────────────────────────────────

export interface StartOffboardingInput {
  employeeId: string;
  noticeGivenOn: Date;
  noticePeriodDays?: number;
  lastWorkingOn?: Date;
  separationType?: 'RESIGNATION' | 'TERMINATION';
  reason: string;
}

export async function startOffboarding(ctx: Ctx, input: StartOffboardingInput) {
  requireHr(ctx);
  const employee = await requireEmployee(ctx, input.employeeId);
  if (employee.employmentStatus === 'EXITED') throw Conflict('This employee has already left.');
  if (employee.employmentStatus === 'NOTICE') throw Conflict('Offboarding is already under way.');

  const policy = await getHrPolicy(ctx);
  const noticePeriodDays = input.noticePeriodDays ?? policy.defaultNoticeDays;
  const noticeGivenOn = toDay(input.noticeGivenOn);
  const lastWorkingOn = input.lastWorkingOn ? toDay(input.lastWorkingOn) : addDays(noticeGivenOn, noticePeriodDays);
  if (lastWorkingOn < noticeGivenOn) throw Conflict('The last working day cannot be before notice was given.');

  const served = daysBetween(noticeGivenOn, lastWorkingOn);
  const noticeShortfallDays = Math.max(noticePeriodDays - served, 0);

  const result = await withTx(ctx.tenantId, async (tx) => {
    const offboardingCase = await tx.hrOffboardingCase.create({
      data: {
        tenantId: ctx.tenantId,
        employeeId: employee.id,
        noticeGivenOn,
        noticePeriodDays,
        lastWorkingOn,
        separationType: input.separationType ?? 'RESIGNATION',
        reason: input.reason,
        noticeShortfallDays,
        startedById: (await myEmployee(ctx, tx))?.id ?? null,
      },
    });
    await tx.employeeProfile.update({
      where: { tenantId: ctx.tenantId, id: employee.id },
      data: { employmentStatus: 'NOTICE', exitedOn: lastWorkingOn },
    });
    const tasksCreated = await buildChecklist(ctx, employee.id, 'OFFBOARDING', lastWorkingOn, false, tx);
    return { offboardingCase, tasksCreated };
  });

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_offboarding_case',
    recordId: result.offboardingCase.id,
    metadata: {
      action: 'offboarding.started',
      lastWorkingOn: lastWorkingOn.toISOString().slice(0, 10),
      noticeShortfallDays,
    },
  });
  return { ...result, noticeDaysServed: served, noticeShortfallDays };
}

/** Only accruing paid types are encashable. Sick leave is not paid out. */
export async function unusedLeaveDays(ctx: Ctx, employeeId: string, asOf: Date) {
  const year = toDay(asOf).getUTCFullYear();
  const balances = await prisma.hrLeaveBalance.findMany({
    where: { tenantId: ctx.tenantId, employeeId, year, leaveType: { accrues: true, paid: true } },
  });
  const total = balances.reduce(
    (sum, row) => sum + Math.max(row.accruedDays + row.carriedForwardDays - row.takenDays, 0),
    0,
  );
  return Math.round(total * 100) / 100;
}

/**
 * Indicative final settlement: gratuity + leave encashment − notice shortfall.
 * Read-only — nothing here pays anyone.
 *
 * Gratuity and leave encashment are calculated on BASIC salary; notice in lieu
 * defaults to TOTAL remuneration. That asymmetry is deliberate and is what UAE
 * practice expects.
 */
export async function settlementFor(
  ctx: Ctx,
  employeeId: string,
  options: { noticeShortfallDays?: number; noticeBasis?: NoticeBasis; lastWorkingOn?: Date } = {},
) {
  requireHr(ctx);
  const employee = await prisma.employeeProfile.findFirst({
    where: { tenantId: ctx.tenantId, id: employeeId, deletedAt: null },
    include: { membership: MEMBERSHIP_PUBLIC },
  });
  if (!employee) throw NotFound('Employee');
  if (!employee.joinedOn) throw Conflict('This employee has no joining date on record.');

  const openCase = await prisma.hrOffboardingCase.findFirst({
    where: { tenantId: ctx.tenantId, employeeId, completedAt: null },
    orderBy: { startedAt: 'desc' },
  });
  const lastWorkingOn = options.lastWorkingOn ?? employee.exitedOn ?? openCase?.lastWorkingOn ?? new Date();
  const noticeShortfallDays = Math.max(options.noticeShortfallDays ?? openCase?.noticeShortfallDays ?? 0, 0);
  const noticeBasis = options.noticeBasis ?? (await getHrPolicy(ctx)).noticePayBasis;

  const basicSalary = Number(employee.basicSalary ?? 0);
  const totalSalary = Number(employee.totalSalary ?? employee.basicSalary ?? 0);

  const policy = await getHrPolicy(ctx);
  const gratuity = gratuityUae(basicSalary, employee.joinedOn, lastWorkingOn, policy);
  const leaveDays = await unusedLeaveDays(ctx, employee.id, lastWorkingOn);
  const leaveEncashmentAmount = Math.round(leaveDays * (basicSalary / 30) * 100) / 100;
  const notice = noticePayInLieu(basicSalary, totalSalary, noticeShortfallDays, noticeBasis);
  const blockers = await outstandingBlockers(ctx, employee.id, 'OFFBOARDING');

  return {
    employeeId: employee.id,
    employeeNumber: employee.employeeNumber,
    employeeName: employee.membership.platformUser.fullName,
    lastWorkingOn,
    serviceYears: gratuity.years,
    basicSalary,
    totalSalary,
    gratuityDays: gratuity.days,
    gratuityAmount: gratuity.amount,
    gratuityCapped: gratuity.cappedAtTwoYears,
    unusedLeaveDays: leaveDays,
    leaveEncashmentAmount,
    noticeShortfallDays: notice.days,
    noticePayBasis: notice.basis,
    noticeDeductionAmount: notice.amount,
    totalPayable: Math.round((gratuity.amount + leaveEncashmentAmount - notice.amount) * 100) / 100,
    clearanceComplete: blockers.length === 0,
    outstandingClearances: blockers.map((task: any) => task.title),
    note: 'Indicative only. Confirm against the signed MOHRE contract and any outstanding advances before payment.',
  };
}

/**
 * Closes the account. Gated on clearance so nobody walks out with a laptop and a
 * live visa, and on settlement confirmation so the exit is not recorded before
 * the money is. Revokes every session and withdraws biometric consent in the
 * same transaction — biometric data has no lawful basis once employment ends.
 */
export async function finaliseExit(ctx: Ctx, employeeId: string, confirmSettlementPaid: boolean) {
  requireHr(ctx);
  const employee = await prisma.employeeProfile.findFirst({
    where: { tenantId: ctx.tenantId, id: employeeId, deletedAt: null },
    include: { membership: MEMBERSHIP_PUBLIC },
  });
  if (!employee) throw NotFound('Employee');
  if (employee.employmentStatus === 'EXITED') throw Conflict('This employee has already left.');
  if (employee.employmentStatus !== 'NOTICE') throw Conflict('Start offboarding before finalising the exit.');

  const blockers = await outstandingBlockers(ctx, employee.id, 'OFFBOARDING');
  if (blockers.length) {
    throw Conflict(
      `${blockers.length} clearance steps are still open: ${blockers.map((task: any) => task.title).join(', ')}.`,
    );
  }
  if (!confirmSettlementPaid) throw Conflict('Confirm the final settlement has been paid before closing the account.');

  const [settlement, settlementPolicy] = await Promise.all([settlementFor(ctx, employee.id), getHrPolicy(ctx)]);
  const exitedOn = employee.exitedOn ?? toDay(new Date());

  const result = await withTx(ctx.tenantId, async (tx) => {
    const openCase = await tx.hrOffboardingCase.findFirst({
      where: { tenantId: ctx.tenantId, employeeId: employee.id, completedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    await tx.employeeProfile.update({
      where: { tenantId: ctx.tenantId, id: employee.id },
      data: { employmentStatus: 'EXITED', exitedOn },
    });

    if (openCase) {
      await tx.hrOffboardingCase.update({
        where: { tenantId: ctx.tenantId, id: openCase.id },
        data: { completedAt: new Date(), settlementPaidAt: new Date() },
      });
      await tx.hrSettlementSnapshot.create({
        data: {
          tenantId: ctx.tenantId,
          employeeId: employee.id,
          offboardingCaseId: openCase.id,
          policyVersion: 'UAE-DECREE-LAW-33-2021',
          // The full policy is stored alongside the inputs, not just a version
          // string. Gratuity and accrual rates are workspace-editable, so
          // without this a settlement cannot be re-derived after someone edits
          // them — and a past payout would read as miscalculated when it was
          // correct under the policy in force at the time.
          inputs: {
            basicSalary: settlement.basicSalary,
            totalSalary: settlement.totalSalary,
            joinedOn: employee.joinedOn,
            lastWorkingOn: settlement.lastWorkingOn,
            policy: settlementPolicy,
          },
          calculation: settlement as any,
        },
      });
    }

    // Access ends with employment, in the same transaction as the status change.
    await tx.workspaceMembership.update({ where: { id: employee.membershipId }, data: { status: 'REMOVED' } });
    if (employee.membership.salesUserId) {
      await tx.user.update({
        where: { tenantId: ctx.tenantId, id: employee.membership.salesUserId },
        data: { status: 'DEACTIVATED' },
      });
    }

    // No lawful basis to keep biometrics after employment ends.
    const withdrawn = await tx.biometricConsent.updateMany({
      where: { tenantId: ctx.tenantId, employeeId: employee.id, withdrawnAt: null },
      data: { withdrawnAt: new Date() },
    });
    return { consentsWithdrawn: withdrawn.count, settlementSnapshot: openCase !== null };
  });

  if (employee.membership.salesUserId) {
    await revokeAllSessions(ctx.tenantId, employee.membership.salesUserId, undefined, 'EMPLOYMENT_ENDED');
  }

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'employee',
    recordId: employee.id,
    previousValue: { employmentStatus: employee.employmentStatus },
    newValue: { employmentStatus: 'EXITED' },
    metadata: { action: 'employee.exited', ...result },
  });
  return { employeeId: employee.id, employmentStatus: 'EXITED', exitedOn, ...result };
}

// ── HR dashboard ───────────────────────────────────────────────────────────

/** What HR needs on a Monday morning. */
export async function lifecycleDashboard(ctx: Ctx) {
  const employeeInclude = { membership: MEMBERSHIP_PUBLIC } as const;
  const [joining, leaving, overdueTasks, documents] = await Promise.all([
    prisma.employeeProfile.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: 'ONBOARDING' },
      include: employeeInclude,
      orderBy: { joinedOn: 'asc' },
    }),
    prisma.employeeProfile.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: 'NOTICE' },
      include: employeeInclude,
      orderBy: { exitedOn: 'asc' },
    }),
    prisma.hrChecklistTask.count({
      where: { tenantId: ctx.tenantId, completedAt: null, dueDate: { lt: toDay(new Date()) } },
    }),
    expiringDocuments(ctx, 60),
  ]);

  // One grouped count for the whole dashboard rather than a query per employee:
  // the previous shape issued 1 + N queries and got slower as the workspace grew.
  const blockerCounts = await prisma.hrChecklistTask.groupBy({
    by: ['employeeId', 'phase'],
    where: {
      tenantId: ctx.tenantId,
      blocking: true,
      completedAt: null,
      employeeId: { in: [...joining, ...leaving].map((employee) => employee.id) },
    },
    _count: { _all: true },
  });
  const blockersFor = (employeeId: string, phase: ChecklistPhase) =>
    blockerCounts.find((row) => row.employeeId === employeeId && row.phase === phase)?._count._all ?? 0;

  const withBlockers = (rows: typeof joining, phase: ChecklistPhase) =>
    rows.map((employee) => ({
      employeeId: employee.id,
      name: employee.membership.platformUser.fullName,
      employeeNumber: employee.employeeNumber,
      joinedOn: employee.joinedOn,
      exitedOn: employee.exitedOn,
      openBlockers: blockersFor(employee.id, phase),
    }));

  return {
    joining: withBlockers(joining, 'ONBOARDING'),
    leaving: withBlockers(leaving, 'OFFBOARDING'),
    overdueTasks,
    documentsExpiring60d: documents.length,
    documentsExpired: documents.filter((document) => document.severity === 'expired').length,
  };
}
