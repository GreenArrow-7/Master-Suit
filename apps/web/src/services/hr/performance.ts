/**
 * Performance: cycles, goals, reviews and improvement plans.
 *
 * §53 asks for "strict permissions on performance data", and that phrase is
 * doing most of the work in this file. A performance review is the most
 * politically sensitive record in HR after salary: it decides promotions, it is
 * quoted in disputes, and an employee reading their manager's draft rating
 * before it is finalised changes the conversation permanently. So visibility is
 * three-way rather than a single permission —
 *
 *   * an employee reads their own, and writes only the self-assessment section;
 *   * a line manager reads and writes the manager section for their own reports
 *     and nobody else's, via `reportingLine`;
 *   * HR reads the workspace, and is the only party that can calibrate.
 *
 * The review moves in one direction: the employee writes first so the manager's
 * rating is informed by it rather than the reverse, and the employee
 * acknowledges last so nothing is closed behind their back. `advance` is the
 * only thing that moves the status, and it refuses to skip.
 */
import { Prisma } from '@prisma/client';
import { prisma, withTx } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { toDay } from './rules';
import { isLineManagerOf, myEmployee, reportingLine, requireEmployee } from './leave';
import { EMPLOYEE_WITH_PERSON } from './publicSelect';
import { notifyPipOpened, notifyReviewCycleOpened, notifyReviewReleased, notifySelfReviewSubmitted } from './notify';

export type ReviewStatus = 'PENDING_SELF' | 'PENDING_MANAGER' | 'CALIBRATION' | 'AWAITING_ACKNOWLEDGEMENT' | 'COMPLETE';

/** Reads everyone's performance data and runs calibration. HR, in practice. */
export const isPerformanceAdmin = (ctx: Ctx) =>
  SCOPE_RANK[scopeFor(ctx, 'performance', 'APPROVE')] >= SCOPE_RANK.ORGANIZATION;

/** May run cycles and see performance beyond their own reporting line. */
export const mayReadAllPerformance = (ctx: Ctx) =>
  SCOPE_RANK[scopeFor(ctx, 'performance', 'VIEW')] >= SCOPE_RANK.ORGANIZATION;

/** The default competency framework a workspace starts from. Editable afterwards. */
export const DEFAULT_COMPETENCIES = [
  ['Communication', 'Clarity in writing and conversation, with colleagues and with clients.'],
  ['Teamwork', 'Contribution to the people around them, not only to their own objectives.'],
  ['Leadership', 'Direction, delegation and developing others. Applies at every grade, not only to managers.'],
  ['Sales effectiveness', 'Pipeline discipline, conversion and client relationships.'],
  ['Compliance', 'Adherence to policy, RERA obligations and data-protection duties.'],
  ['Technical skill', 'Depth in the craft the role is actually paid for.'],
] as const;

/**
 * The people whose performance this actor may read.
 *
 * `null` means "everyone" — the caller is HR. Anything else is an explicit list,
 * which is what keeps a manager inside their own reporting line.
 */
async function visibleEmployeeIds(ctx: Ctx): Promise<string[] | null> {
  if (mayReadAllPerformance(ctx) || isPerformanceAdmin(ctx)) return null;
  return reportingLine(ctx);
}

async function assertMayRead(ctx: Ctx, employeeId: string) {
  const visible = await visibleEmployeeIds(ctx);
  if (visible === null) return;
  if (!visible.includes(employeeId)) throw Forbidden('You can only see performance records for your own team.');
}

// ── Cycles and competencies ────────────────────────────────────────────────

export interface CycleInput {
  name: string;
  type?: 'ANNUAL' | 'SEMIANNUAL' | 'QUARTERLY' | 'PROBATION' | 'CUSTOM';
  periodStart: Date;
  periodEnd: Date;
  selfReviewDueAt?: Date;
  managerReviewDueAt?: Date;
}

export async function createCycle(ctx: Ctx, input: CycleInput) {
  if (!isPerformanceAdmin(ctx)) throw Forbidden('Only HR can open a review cycle.');
  if (toDay(input.periodEnd) < toDay(input.periodStart))
    throw Conflict('The end of the period must be on or after its start.');

  const actor = await myEmployee(ctx);
  try {
    const cycle = await prisma.hrReviewCycle.create({
      data: {
        tenantId: ctx.tenantId,
        name: input.name.trim(),
        type: input.type ?? 'ANNUAL',
        periodStart: toDay(input.periodStart),
        periodEnd: toDay(input.periodEnd),
        selfReviewDueAt: input.selfReviewDueAt ?? null,
        managerReviewDueAt: input.managerReviewDueAt ?? null,
        createdById: actor?.id ?? null,
      },
    });
    await audit(ctx, {
      event: 'RECORD_CREATED',
      objectType: 'hr_review_cycle',
      recordId: cycle.id,
      metadata: { action: 'performance.cycle.created', name: cycle.name, type: cycle.type },
    });
    return cycle;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw Conflict('A cycle with that name already exists.');
    throw error;
  }
}

/**
 * Open a cycle and create one review per active employee.
 *
 * Materialising the reviews up front is what makes "overdue reviews" answerable:
 * a missing row is indistinguishable from a manager who has not started, so
 * every eligible person gets a PENDING_SELF row the moment the cycle opens.
 */
export async function openCycle(ctx: Ctx, cycleId: string) {
  if (!isPerformanceAdmin(ctx)) throw Forbidden('Only HR can open a review cycle.');
  const cycle = await prisma.hrReviewCycle.findFirst({ where: { tenantId: ctx.tenantId, id: cycleId } });
  if (!cycle) throw NotFound('Review cycle');
  if (cycle.status !== 'DRAFT') throw Conflict('Only a draft cycle can be opened.');

  const employees = await prisma.employeeProfile.findMany({
    where: {
      tenantId: ctx.tenantId,
      deletedAt: null,
      employmentStatus: { notIn: ['EXITED'] },
      // Someone who joined after the period closed has nothing to be reviewed on.
      OR: [{ joinedOn: null }, { joinedOn: { lte: cycle.periodEnd } }],
    },
    select: { id: true, managerMembershipId: true },
  });

  const managerIds = await prisma.employeeProfile.findMany({
    where: { tenantId: ctx.tenantId, membershipId: { in: employees.map((e) => e.managerMembershipId ?? '') } },
    select: { id: true, membershipId: true },
  });
  const managerByMembership = new Map(managerIds.map((row) => [row.membershipId, row.id]));

  const created = await withTx(ctx.tenantId, async (tx) => {
    const rows = await tx.hrReview.createMany({
      data: employees.map((employee) => ({
        tenantId: ctx.tenantId,
        cycleId: cycle.id,
        employeeId: employee.id,
        managerId: employee.managerMembershipId
          ? (managerByMembership.get(employee.managerMembershipId) ?? null)
          : null,
      })),
      skipDuplicates: true,
    });
    await tx.hrReviewCycle.update({ where: { tenantId: ctx.tenantId, id: cycle.id }, data: { status: 'OPEN' } });
    return rows.count;
  });

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_review_cycle',
    recordId: cycle.id,
    metadata: { action: 'performance.cycle.opened', reviewsCreated: created },
  });
  await notifyReviewCycleOpened(ctx, {
    employeeIds: employees.map((employee) => employee.id),
    cycleName: cycle.name,
    recordId: cycle.id,
  });
  return { reviewsCreated: created };
}

export async function setCycleStatus(ctx: Ctx, cycleId: string, status: 'CALIBRATION' | 'CLOSED') {
  if (!isPerformanceAdmin(ctx)) throw Forbidden('Only HR can change a cycle.');
  const cycle = await prisma.hrReviewCycle.findFirst({ where: { tenantId: ctx.tenantId, id: cycleId } });
  if (!cycle) throw NotFound('Review cycle');
  if (cycle.status === 'DRAFT') throw Conflict('Open the cycle first.');

  const updated = await prisma.hrReviewCycle.update({
    where: { tenantId: ctx.tenantId, id: cycle.id },
    data: { status },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_review_cycle',
    recordId: cycle.id,
    metadata: { action: 'performance.cycle.status', from: cycle.status, to: status },
  });
  return updated;
}

/** Idempotent: a workspace that already has competencies keeps them. */
export async function seedCompetencies(ctx: Ctx) {
  if (!isPerformanceAdmin(ctx)) throw Forbidden('Only HR can manage the competency framework.');
  const result = await prisma.hrCompetency.createMany({
    data: DEFAULT_COMPETENCIES.map(([name, description], index) => ({
      tenantId: ctx.tenantId,
      name,
      description,
      sortOrder: index,
    })),
    skipDuplicates: true,
  });
  return { created: result.count };
}

export async function listCycles(ctx: Ctx) {
  return prisma.hrReviewCycle.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { periodStart: 'desc' },
    include: { _count: { select: { reviews: true } } },
    take: 50,
  });
}

// ── Goals ──────────────────────────────────────────────────────────────────

export interface GoalInput {
  employeeId?: string;
  cycleId?: string;
  title: string;
  description?: string;
  metric?: string;
  target?: string;
  weight?: number;
  dueOn?: Date;
}

/**
 * Set an objective.
 *
 * An employee may set their own; a manager may set one for a report. The weight
 * check is against the whole set for the cycle, because a goal sheet carrying
 * 140% of weight produces a rating nobody can defend, and it is only visible by
 * looking at the set rather than the row being added.
 */
export async function setGoal(ctx: Ctx, input: GoalInput) {
  const self = await myEmployee(ctx);
  const employeeId = input.employeeId ?? self?.id;
  if (!employeeId) throw Conflict('Your account has no employee record in this workspace.');

  const mine = self?.id === employeeId;
  if (!mine && !(await isLineManagerOf(ctx, employeeId)) && !isPerformanceAdmin(ctx))
    throw Forbidden('You can only set goals for yourself or your own reports.');
  await requireEmployee(ctx, employeeId);

  const weight = input.weight ?? 0;
  if (weight < 0 || weight > 100) throw Conflict('A goal weight is a percentage between 0 and 100.');

  if (weight > 0 && input.cycleId) {
    const existing = await prisma.hrGoal.aggregate({
      where: {
        tenantId: ctx.tenantId,
        employeeId,
        cycleId: input.cycleId,
        status: { notIn: ['CANCELLED'] },
      },
      _sum: { weight: true },
    });
    const total = (existing._sum.weight ?? 0) + weight;
    if (total > 100)
      throw Conflict(`That would take this cycle's goal weighting to ${total}%. Keep the total at or below 100%.`);
  }

  const goal = await prisma.hrGoal.create({
    data: {
      tenantId: ctx.tenantId,
      employeeId,
      cycleId: input.cycleId || null,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      metric: input.metric?.trim() || null,
      target: input.target?.trim() || null,
      weight,
      dueOn: input.dueOn ?? null,
      createdById: self?.id ?? null,
    },
  });

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_goal',
    recordId: goal.id,
    metadata: { action: 'performance.goal.set', employeeId, weight, cycleId: input.cycleId ?? null },
  });
  return goal;
}

export async function updateGoalProgress(
  ctx: Ctx,
  goalId: string,
  input: { progress?: number; status?: 'ACTIVE' | 'ACHIEVED' | 'MISSED' | 'CANCELLED'; evidence?: string },
) {
  const goal = await prisma.hrGoal.findFirst({ where: { tenantId: ctx.tenantId, id: goalId } });
  if (!goal) throw NotFound('Goal');

  const self = await myEmployee(ctx);
  const mine = self?.id === goal.employeeId;
  if (!mine && !(await isLineManagerOf(ctx, goal.employeeId)) && !isPerformanceAdmin(ctx))
    throw Forbidden('You can only update goals for yourself or your own reports.');
  if (input.progress != null && (input.progress < 0 || input.progress > 100))
    throw Conflict('Progress is a percentage between 0 and 100.');

  const updated = await prisma.hrGoal.update({
    where: { tenantId: ctx.tenantId, id: goal.id },
    data: {
      progress: input.progress ?? goal.progress,
      status: input.status ?? goal.status,
      evidence: input.evidence?.trim() ?? goal.evidence,
    },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_goal',
    recordId: goal.id,
    metadata: { action: 'performance.goal.updated', progress: updated.progress, status: updated.status },
  });
  return updated;
}

export async function goalsFor(ctx: Ctx, employeeId?: string, cycleId?: string) {
  const self = await myEmployee(ctx);
  const target = employeeId ?? self?.id;
  if (!target) return [];
  await assertMayRead(ctx, target);
  return prisma.hrGoal.findMany({
    where: { tenantId: ctx.tenantId, employeeId: target, cycleId: cycleId || undefined },
    orderBy: [{ createdAt: 'desc' }],
  });
}

// ── Reviews ────────────────────────────────────────────────────────────────

/** The one place a review's status moves. Refuses to skip a step. */
const NEXT: Record<ReviewStatus, ReviewStatus | null> = {
  PENDING_SELF: 'PENDING_MANAGER',
  PENDING_MANAGER: 'CALIBRATION',
  CALIBRATION: 'AWAITING_ACKNOWLEDGEMENT',
  AWAITING_ACKNOWLEDGEMENT: 'COMPLETE',
  COMPLETE: null,
};

async function loadReview(ctx: Ctx, reviewId: string) {
  const review = await prisma.hrReview.findFirst({ where: { tenantId: ctx.tenantId, id: reviewId } });
  if (!review) throw NotFound('Review');
  return review;
}

export interface SelfReviewInput {
  reviewId: string;
  comments: string;
  rating?: number;
  competencyScores?: { competencyId: string; score: number; comment?: string }[];
}

/** The employee's own assessment. Only they can write it, and only once. */
export async function submitSelfReview(ctx: Ctx, input: SelfReviewInput) {
  const review = await loadReview(ctx, input.reviewId);
  const self = await myEmployee(ctx);
  if (!self || self.id !== review.employeeId) throw Forbidden('Only the employee can write their self-assessment.');
  if (review.status !== 'PENDING_SELF')
    throw Conflict('The self-assessment for this review has already been submitted.');
  if (input.rating != null && (input.rating < 1 || input.rating > 5)) throw Conflict('Rate between 1 and 5.');

  const updated = await withTx(ctx.tenantId, async (tx) => {
    for (const score of input.competencyScores ?? []) {
      await tx.hrReviewCompetencyScore.upsert({
        where: {
          tenantId_reviewId_competencyId: {
            tenantId: ctx.tenantId,
            reviewId: review.id,
            competencyId: score.competencyId,
          },
        },
        update: { selfScore: score.score, comment: score.comment?.trim() || null },
        create: {
          tenantId: ctx.tenantId,
          reviewId: review.id,
          competencyId: score.competencyId,
          selfScore: score.score,
          comment: score.comment?.trim() || null,
        },
      });
    }
    return tx.hrReview.update({
      where: { tenantId: ctx.tenantId, id: review.id },
      data: {
        selfComments: input.comments.trim(),
        selfRating: input.rating ?? null,
        selfSubmittedAt: new Date(),
        status: NEXT.PENDING_SELF!,
      },
    });
  });

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_review',
    recordId: review.id,
    metadata: { action: 'performance.review.self_submitted', cycleId: review.cycleId },
  });
  await notifySelfReviewSubmitted(ctx, {
    managerId: review.managerId,
    employeeName: self.employeeNumber,
    recordId: review.id,
  });
  return updated;
}

export interface ManagerReviewInput {
  reviewId: string;
  comments: string;
  rating: number;
  competencyScores?: { competencyId: string; score: number; comment?: string }[];
}

/**
 * The manager's assessment.
 *
 * Restricted to the person's actual line manager, or HR. Notably it cannot be
 * written before the self-assessment exists: the ordering is the point of having
 * two, and a manager who rates first is simply rating without the input.
 */
export async function submitManagerReview(ctx: Ctx, input: ManagerReviewInput) {
  const review = await loadReview(ctx, input.reviewId);
  const self = await myEmployee(ctx);
  const isManager = self?.id === review.managerId || (await isLineManagerOf(ctx, review.employeeId));
  if (!isManager && !isPerformanceAdmin(ctx))
    throw Forbidden('Only this employee’s manager or HR can write the manager review.');
  if (self && self.id === review.employeeId) throw Conflict('You cannot write the manager review of your own record.');
  if (review.status !== 'PENDING_MANAGER')
    throw Conflict(
      review.status === 'PENDING_SELF'
        ? 'The employee has not submitted their self-assessment yet.'
        : 'The manager review for this record has already been submitted.',
    );
  if (input.rating < 1 || input.rating > 5) throw Conflict('Rate between 1 and 5.');

  const updated = await withTx(ctx.tenantId, async (tx) => {
    for (const score of input.competencyScores ?? []) {
      await tx.hrReviewCompetencyScore.upsert({
        where: {
          tenantId_reviewId_competencyId: {
            tenantId: ctx.tenantId,
            reviewId: review.id,
            competencyId: score.competencyId,
          },
        },
        update: { managerScore: score.score },
        create: {
          tenantId: ctx.tenantId,
          reviewId: review.id,
          competencyId: score.competencyId,
          managerScore: score.score,
        },
      });
    }
    return tx.hrReview.update({
      where: { tenantId: ctx.tenantId, id: review.id },
      data: {
        managerComments: input.comments.trim(),
        managerRating: input.rating,
        managerSubmittedAt: new Date(),
        managerId: review.managerId ?? self?.id ?? null,
        status: NEXT.PENDING_MANAGER!,
      },
    });
  });

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_review',
    recordId: review.id,
    metadata: { action: 'performance.review.manager_submitted', rating: input.rating },
  });
  return updated;
}

/**
 * Calibration: HR settles the final rating.
 *
 * Separate from the manager's rating on purpose. Calibration exists so ratings
 * mean the same thing across teams, and recording only the final number would
 * erase the fact that a manager said something different — which is exactly what
 * an employee disputing a rating needs to see.
 */
export async function calibrateReview(ctx: Ctx, reviewId: string, finalRating: number, note?: string) {
  if (!isPerformanceAdmin(ctx)) throw Forbidden('Only HR can calibrate a rating.');
  const review = await loadReview(ctx, reviewId);
  if (review.status !== 'CALIBRATION') throw Conflict('This review is not awaiting calibration.');
  if (finalRating < 1 || finalRating > 5) throw Conflict('Rate between 1 and 5.');

  const actor = await myEmployee(ctx);
  const updated = await prisma.hrReview.update({
    where: { tenantId: ctx.tenantId, id: review.id },
    data: {
      finalRating,
      calibratedById: actor?.id ?? null,
      calibratedAt: new Date(),
      calibrationNote: note?.trim() || null,
      status: NEXT.CALIBRATION!,
    },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_review',
    recordId: review.id,
    metadata: {
      action: 'performance.review.calibrated',
      managerRating: review.managerRating,
      finalRating,
      moved: review.managerRating !== finalRating,
    },
  });
  // Calibration is the release point - before it the employee is deliberately
  // not shown the manager's assessment, so this is the first honest moment.
  await notifyReviewReleased(ctx, { employeeId: review.employeeId, rating: finalRating, recordId: review.id });
  return updated;
}

/** The employee closes their own review. Nobody else can acknowledge for them. */
export async function acknowledgeReview(ctx: Ctx, reviewId: string, note?: string) {
  const review = await loadReview(ctx, reviewId);
  const self = await myEmployee(ctx);
  if (!self || self.id !== review.employeeId) throw Forbidden('Only the employee can acknowledge their review.');
  if (review.status !== 'AWAITING_ACKNOWLEDGEMENT') throw Conflict('This review is not ready to be acknowledged yet.');

  const updated = await prisma.hrReview.update({
    where: { tenantId: ctx.tenantId, id: review.id },
    data: {
      acknowledgedAt: new Date(),
      acknowledgementNote: note?.trim() || null,
      status: NEXT.AWAITING_ACKNOWLEDGEMENT!,
    },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_review',
    recordId: review.id,
    metadata: { action: 'performance.review.acknowledged', finalRating: review.finalRating },
  });
  return updated;
}

/**
 * Reviews the caller may see.
 *
 * A manager's own review is included — they are somebody's report too — but
 * their manager's draft is not readable until it reaches them, because the
 * status gate below hides the manager section while it is still being written.
 */
export async function reviewsFor(ctx: Ctx, options: { cycleId?: string; employeeId?: string } = {}) {
  const self = await myEmployee(ctx);
  const visible = await visibleEmployeeIds(ctx);
  if (visible !== null && !visible.length) return [];
  if (options.employeeId) await assertMayRead(ctx, options.employeeId);

  const rows = await prisma.hrReview.findMany({
    where: {
      tenantId: ctx.tenantId,
      cycleId: options.cycleId || undefined,
      employeeId: options.employeeId ?? (visible === null ? undefined : { in: visible }),
    },
    include: { employee: EMPLOYEE_WITH_PERSON, cycle: true, competencyScores: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  // An employee must not read the manager's assessment of them before it has
  // been calibrated and released. Hiding it here rather than refusing the row
  // keeps their own self-assessment readable throughout.
  const admin = isPerformanceAdmin(ctx) || mayReadAllPerformance(ctx);
  return rows.map((row) => {
    const own = self?.id === row.employeeId;
    const released = ['AWAITING_ACKNOWLEDGEMENT', 'COMPLETE'].includes(row.status);
    if (!own || admin || released) return row;
    return { ...row, managerComments: null, managerRating: null, finalRating: null, calibrationNote: null };
  });
}

// ── Improvement plans ──────────────────────────────────────────────────────

export interface PipInput {
  employeeId: string;
  objective: string;
  expectedImprovements: string;
  startsOn: Date;
  endsOn: Date;
  checkpoints?: { dueOn: Date; expectation: string }[];
}

export async function createPip(ctx: Ctx, input: PipInput) {
  const self = await myEmployee(ctx);
  if (!(await isLineManagerOf(ctx, input.employeeId)) && !isPerformanceAdmin(ctx))
    throw Forbidden('Only this employee’s manager or HR can open an improvement plan.');
  await requireEmployee(ctx, input.employeeId);
  if (toDay(input.endsOn) <= toDay(input.startsOn)) throw Conflict('The plan must end after it starts.');
  if (!input.objective.trim() || !input.expectedImprovements.trim())
    throw Conflict('State the objective and what improvement is expected — a plan without them is not actionable.');

  const pip = await prisma.hrPip.create({
    data: {
      tenantId: ctx.tenantId,
      employeeId: input.employeeId,
      managerId: self?.id ?? null,
      objective: input.objective.trim(),
      expectedImprovements: input.expectedImprovements.trim(),
      startsOn: toDay(input.startsOn),
      endsOn: toDay(input.endsOn),
      createdById: self?.id ?? null,
      checkpoints: {
        create: (input.checkpoints ?? []).map((checkpoint) => ({
          tenantId: ctx.tenantId,
          dueOn: toDay(checkpoint.dueOn),
          expectation: checkpoint.expectation.trim(),
        })),
      },
    },
    include: { checkpoints: true },
  });

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_pip',
    recordId: pip.id,
    metadata: { action: 'performance.pip.created', employeeId: input.employeeId, checkpoints: pip.checkpoints.length },
  });
  return pip;
}

export async function activatePip(ctx: Ctx, pipId: string) {
  const pip = await prisma.hrPip.findFirst({ where: { tenantId: ctx.tenantId, id: pipId } });
  if (!pip) throw NotFound('Improvement plan');
  if (!(await isLineManagerOf(ctx, pip.employeeId)) && !isPerformanceAdmin(ctx))
    throw Forbidden('Only this employee’s manager or HR can start an improvement plan.');
  if (pip.status !== 'DRAFT') throw Conflict('That plan is not a draft.');

  const updated = await prisma.hrPip.update({
    where: { tenantId: ctx.tenantId, id: pip.id },
    data: { status: 'ACTIVE' },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_pip',
    recordId: pip.id,
    metadata: { action: 'performance.pip.activated', employeeId: pip.employeeId },
  });
  await notifyPipOpened(ctx, { employeeId: pip.employeeId, recordId: pip.id });
  return updated;
}

/** The employee confirms they have been told. Only they can. */
export async function acknowledgePip(ctx: Ctx, pipId: string, note?: string) {
  const pip = await prisma.hrPip.findFirst({ where: { tenantId: ctx.tenantId, id: pipId } });
  if (!pip) throw NotFound('Improvement plan');
  const self = await myEmployee(ctx);
  if (!self || self.id !== pip.employeeId) throw Forbidden('Only the employee can acknowledge their plan.');
  if (pip.status !== 'ACTIVE') throw Conflict('That plan is not active.');

  const updated = await prisma.hrPip.update({
    where: { tenantId: ctx.tenantId, id: pip.id },
    data: { acknowledgedAt: new Date(), acknowledgementNote: note?.trim() || null },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_pip',
    recordId: pip.id,
    metadata: { action: 'performance.pip.acknowledged' },
  });
  return updated;
}

export async function recordCheckpoint(
  ctx: Ctx,
  checkpointId: string,
  input: { met: boolean; managerComment?: string },
) {
  const checkpoint = await prisma.hrPipCheckpoint.findFirst({
    where: { tenantId: ctx.tenantId, id: checkpointId },
    include: { pip: { select: { employeeId: true, status: true } } },
  });
  if (!checkpoint) throw NotFound('Checkpoint');
  if (!(await isLineManagerOf(ctx, checkpoint.pip.employeeId)) && !isPerformanceAdmin(ctx))
    throw Forbidden('Only this employee’s manager or HR can record a checkpoint.');
  if (checkpoint.pip.status !== 'ACTIVE') throw Conflict('That plan is not active.');

  const updated = await prisma.hrPipCheckpoint.update({
    where: { tenantId: ctx.tenantId, id: checkpoint.id },
    data: { met: input.met, managerComment: input.managerComment?.trim() || null, completedAt: new Date() },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_pip_checkpoint',
    recordId: checkpoint.id,
    metadata: { action: 'performance.pip.checkpoint', met: input.met },
  });
  return updated;
}

/**
 * Close a plan.
 *
 * An unacknowledged plan cannot be closed as a failure. A plan the employee was
 * never recorded as having been told about is not a plan they failed, and
 * closing one that way is the single most expensive thing a manager can do here.
 */
export async function closePip(ctx: Ctx, pipId: string, success: boolean, outcome: string) {
  const pip = await prisma.hrPip.findFirst({ where: { tenantId: ctx.tenantId, id: pipId } });
  if (!pip) throw NotFound('Improvement plan');
  if (!(await isLineManagerOf(ctx, pip.employeeId)) && !isPerformanceAdmin(ctx))
    throw Forbidden('Only this employee’s manager or HR can close an improvement plan.');
  if (pip.status !== 'ACTIVE') throw Conflict('That plan is not active.');
  if (!outcome.trim()) throw Conflict('Record the outcome.');
  if (!success && !pip.acknowledgedAt)
    throw Conflict(
      'This plan was never acknowledged by the employee, so it cannot be closed as a failure. Record the acknowledgement first.',
    );

  const updated = await prisma.hrPip.update({
    where: { tenantId: ctx.tenantId, id: pip.id },
    data: {
      status: success ? 'COMPLETED_SUCCESS' : 'COMPLETED_FAILED',
      outcome: outcome.trim(),
      closedAt: new Date(),
    },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_pip',
    recordId: pip.id,
    metadata: { action: 'performance.pip.closed', employeeId: pip.employeeId, success },
  });
  return updated;
}

export async function pipsFor(ctx: Ctx, employeeId?: string) {
  const self = await myEmployee(ctx);
  const target = employeeId ?? self?.id;
  if (target) await assertMayRead(ctx, target);

  const visible = await visibleEmployeeIds(ctx);
  return prisma.hrPip.findMany({
    where: {
      tenantId: ctx.tenantId,
      employeeId: employeeId ?? (visible === null ? undefined : { in: visible }),
    },
    include: { employee: EMPLOYEE_WITH_PERSON, checkpoints: { orderBy: { dueOn: 'asc' } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

// ── Reporting ──────────────────────────────────────────────────────────────

export async function performanceSummary(ctx: Ctx, cycleId?: string) {
  const visible = await visibleEmployeeIds(ctx);
  const where = {
    tenantId: ctx.tenantId,
    cycleId: cycleId || undefined,
    ...(visible === null ? {} : { employeeId: { in: visible } }),
  };

  const [byStatus, ratings, activePips] = await Promise.all([
    prisma.hrReview.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.hrReview.groupBy({ by: ['finalRating'], where, _count: { _all: true } }),
    prisma.hrPip.count({
      where: {
        tenantId: ctx.tenantId,
        status: 'ACTIVE',
        ...(visible === null ? {} : { employeeId: { in: visible } }),
      },
    }),
  ]);

  return {
    byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    ratingDistribution: Object.fromEntries(
      ratings.filter((row) => row.finalRating !== null).map((row) => [String(row.finalRating), row._count._all]),
    ),
    // Anything not yet acknowledged is still owed by somebody.
    outstanding: byStatus.filter((row) => row.status !== 'COMPLETE').reduce((total, row) => total + row._count._all, 0),
    activePips,
  };
}
