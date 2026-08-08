import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { assertPermission } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import { Forbidden, NotFound } from '@/lib/errors';
import { requireWorkspace } from '@/lib/workspace';
import { applyForLeave, cancelLeave, decideLeave, isHrAdmin, myEmployee, runCarryForward } from '@/services/hr/leave';
import {
  activateEmployee,
  addTask,
  completeTask,
  finaliseExit,
  reopenTask,
  startOffboarding,
  startOnboarding,
} from '@/services/hr/lifecycle';
import { enrolFace, grantConsent, preflight, punch, requestChallenge, withdrawConsent } from '@/services/hr/attendance';
import { updateHrPolicy } from '@/services/hr/settings';
import { cancelOvertime, decideOvertime, detectOvertime, requestOvertime } from '@/services/hr/overtime';
import {
  acknowledgePip,
  acknowledgeReview,
  activatePip,
  calibrateReview,
  closePip,
  createCycle,
  createPip,
  openCycle,
  recordCheckpoint,
  seedCompetencies,
  setCycleStatus,
  setGoal,
  submitManagerReview,
  submitSelfReview,
  updateGoalProgress,
} from '@/services/hr/performance';
import {
  addCandidate,
  createOffer,
  createRequisition,
  decideOffer,
  decideRequisition,
  hireCandidate,
  moveCandidate,
  recordOfferResponse,
  scheduleInterview,
  sendOffer,
  setRequisitionStatus,
  startOnboardingForCandidate,
  submitFeedback,
  submitRequisition,
} from '@/services/hr/recruitment';
import {
  assignShift,
  bulkAssign,
  cancelShiftChange,
  copyWeek,
  decideShiftChange,
  removeRosterEntry,
  requestShiftChange,
} from '@/services/hr/roster';
import {
  addAdjustment,
  approveRun,
  calculateRun,
  createRun,
  lockRun,
  markRunPaid,
  setCompensation,
  submitRun,
} from '@/services/hr/payroll';
import { deleteDocument } from '@/services/hr/documents';
import {
  decideAttendanceException,
  decideTemporaryLocation,
  EXCEPTION_REASONS,
  requestAttendanceException,
  requestTemporaryLocation,
} from '@/services/hr/requests';

/**
 * Every HR workflow verb. The reads live in `../[resource]`; anything that moves
 * an employee, a request or a checklist through its lifecycle lands here.
 *
 * The kernel gate is `hrms:EDIT` for all of them — they all mutate HR state. The
 * finer rules (HR only, approver only, never your own leave) are enforced in the
 * service layer, because they depend on the record, not just the role.
 */
const paramsSchema = z.object({
  workspaceSlug: z.string().min(2).max(64),
  action: z.enum([
    'leave-apply',
    'leave-approve',
    'leave-reject',
    'leave-cancel',
    'leave-carry-forward',
    'onboarding-start',
    'employee-activate',
    'checklist-complete',
    'checklist-reopen',
    'checklist-add',
    'offboarding-start',
    'employee-exit',
    'consent-grant',
    'consent-withdraw',
    'face-enrol',
    'attendance-preflight',
    'attendance-challenge',
    'attendance-punch',
    'location-revoke',
    'settings-update',
    'temporary-request',
    'temporary-decide',
    'exception-request',
    'exception-decide',
    'document-delete',
    'overtime-request',
    'overtime-decide',
    'overtime-cancel',
    'overtime-detect',
    'compensation-set',
    'payroll-adjustment-add',
    'payroll-run-create',
    'payroll-run-calculate',
    'payroll-run-submit',
    'payroll-run-decide',
    'payroll-run-lock',
    'payroll-run-paid',
    'roster-assign',
    'roster-bulk-assign',
    'roster-copy-week',
    'roster-remove',
    'shift-change-request',
    'shift-change-decide',
    'shift-change-cancel',
    'requisition-create',
    'requisition-submit',
    'requisition-decide',
    'requisition-status',
    'candidate-add',
    'candidate-move',
    'interview-schedule',
    'interview-feedback',
    'offer-create',
    'offer-decide',
    'offer-send',
    'offer-response',
    'candidate-hire',
    'candidate-onboard',
    'cycle-create',
    'cycle-open',
    'cycle-status',
    'competencies-seed',
    'goal-set',
    'goal-update',
    'review-self',
    'review-manager',
    'review-calibrate',
    'review-acknowledge',
    'pip-create',
    'pip-activate',
    'pip-acknowledge',
    'pip-checkpoint',
    'pip-close',
  ]),
});

const id = z.string().min(1).max(64);
const note = z.string().max(1000).optional();

/** Verbs that need more than "may reach HR". Self-service verbs are absent. */
const ACTION_PERMISSION: Partial<Record<string, [string, 'CREATE' | 'EDIT' | 'APPROVE' | 'MANAGE_CONFIGURATION']>> = {
  'leave-approve': ['leave', 'APPROVE'],
  'leave-reject': ['leave', 'APPROVE'],
  'leave-carry-forward': ['leave', 'APPROVE'],
  'exception-decide': ['attendance', 'APPROVE'],
  // Raising and withdrawing your own claim are self-service, so they are absent
  // here and gated inside the service instead. Deciding and detecting are not.
  'overtime-decide': ['overtime', 'APPROVE'],
  'overtime-detect': ['overtime', 'APPROVE'],
  // Payroll splits preparing from signing off, and the service enforces that the
  // same person cannot do both on one run.
  'compensation-set': ['payroll', 'EDIT'],
  'payroll-adjustment-add': ['payroll', 'EDIT'],
  'payroll-run-create': ['payroll', 'CREATE'],
  'payroll-run-calculate': ['payroll', 'EDIT'],
  'payroll-run-submit': ['payroll', 'EDIT'],
  'payroll-run-decide': ['payroll', 'APPROVE'],
  'payroll-run-lock': ['payroll', 'APPROVE'],
  'payroll-run-paid': ['payroll', 'APPROVE'],
  // Requesting and withdrawing your own shift change are self-service; the
  // service checks the roster entry is actually yours.
  'roster-assign': ['shifts', 'EDIT'],
  'roster-bulk-assign': ['shifts', 'EDIT'],
  'roster-copy-week': ['shifts', 'EDIT'],
  'roster-remove': ['shifts', 'EDIT'],
  'shift-change-decide': ['shifts', 'APPROVE'],
  // Interview feedback is absent: the service restricts it to the panel, which
  // is a narrower and more meaningful gate than any role could be.
  'requisition-create': ['recruitment', 'CREATE'],
  'requisition-submit': ['recruitment', 'EDIT'],
  'requisition-decide': ['recruitment', 'APPROVE'],
  'requisition-status': ['recruitment', 'EDIT'],
  'candidate-add': ['recruitment', 'EDIT'],
  'candidate-move': ['recruitment', 'EDIT'],
  'interview-schedule': ['recruitment', 'EDIT'],
  'offer-create': ['recruitment', 'EDIT'],
  'offer-decide': ['recruitment', 'APPROVE'],
  'offer-send': ['recruitment', 'EDIT'],
  'offer-response': ['recruitment', 'EDIT'],
  'candidate-hire': ['recruitment', 'EDIT'],
  'candidate-onboard': ['employee', 'EDIT'],
  // The self-service verbs — writing your own self-assessment, acknowledging
  // your own review or plan — are absent: the service ties them to the record's
  // own employee, which no role can express.
  'cycle-create': ['performance', 'APPROVE'],
  'cycle-open': ['performance', 'APPROVE'],
  'cycle-status': ['performance', 'APPROVE'],
  'competencies-seed': ['performance', 'APPROVE'],
  'review-calibrate': ['performance', 'APPROVE'],
  'goal-set': ['performance', 'CREATE'],
  'goal-update': ['performance', 'EDIT'],
  'review-manager': ['performance', 'EDIT'],
  'pip-create': ['performance', 'CREATE'],
  'pip-activate': ['performance', 'EDIT'],
  'pip-checkpoint': ['performance', 'EDIT'],
  'pip-close': ['performance', 'EDIT'],
  'temporary-decide': ['attendance', 'APPROVE'],
  'onboarding-start': ['employee', 'EDIT'],
  'employee-activate': ['employee', 'EDIT'],
  'offboarding-start': ['employee', 'EDIT'],
  'employee-exit': ['employee', 'EDIT'],
  'checklist-add': ['employee', 'EDIT'],
  'face-enrol': ['employee', 'EDIT'],
  'location-revoke': ['employee', 'EDIT'],
  'document-delete': ['employee', 'EDIT'],
  'settings-update': ['employee', 'EDIT'],
};

export const POST = route(
  {
    module: 'employee',
    productModule: 'HRMS',
    action: 'VIEW',
    params: paramsSchema,
    body: z.record(z.string(), z.unknown()),
  },
  async ({ ctx, params, body }) => {
    await requireWorkspace(ctx, params.workspaceSlug, 'HRMS');

    // The kernel gate is only the floor for reaching HR. Each verb below asserts
    // the authority it actually needs: `hrms:EDIT` used to cover all of them, so
    // approving another person's leave and applying for your own were the same
    // permission.
    const needed = ACTION_PERMISSION[params.action];
    if (needed) assertPermission(ctx, needed[0], needed[1]);

    switch (params.action) {
      case 'leave-apply': {
        const input = z
          .object({
            employeeId: id.optional(),
            leaveTypeId: id,
            startDate: z.coerce.date(),
            endDate: z.coerce.date(),
            halfDay: z.coerce.boolean().optional(),
            reason: note,
            documentId: id.optional(),
          })
          .parse(body);
        return applyForLeave(ctx, input);
      }

      case 'leave-approve': {
        const input = z.object({ requestId: id, note }).parse(body);
        return decideLeave(ctx, input.requestId, true, input.note);
      }

      case 'leave-reject': {
        const input = z.object({ requestId: id, note: z.string().min(1).max(1000) }).parse(body);
        return decideLeave(ctx, input.requestId, false, input.note);
      }

      case 'leave-cancel': {
        const input = z.object({ requestId: id }).parse(body);
        return cancelLeave(ctx, input.requestId);
      }

      case 'overtime-request': {
        const input = z
          .object({
            employeeId: id.optional(),
            workDate: z.coerce.date(),
            minutes: z.coerce.number().int().min(1).max(1440),
            reason: z.string().min(1).max(1000),
          })
          .parse(body);
        return requestOvertime(ctx, input);
      }

      case 'overtime-decide': {
        const input = z
          .object({
            requestId: id,
            approve: z.coerce.boolean(),
            note,
            compensatory: z.coerce.boolean().optional(),
          })
          .parse(body);
        return decideOvertime(ctx, input.requestId, input.approve, {
          note: input.note,
          compensatory: input.compensatory,
        });
      }

      case 'overtime-cancel': {
        const input = z.object({ requestId: id }).parse(body);
        return cancelOvertime(ctx, input.requestId);
      }

      case 'overtime-detect': {
        const input = z.object({ from: z.coerce.date(), to: z.coerce.date() }).parse(body);
        return detectOvertime(ctx, { from: input.from, to: input.to });
      }

      case 'compensation-set': {
        const input = z
          .object({
            employeeId: id,
            effectiveFrom: z.coerce.date(),
            basic: z.coerce.number().min(0.01).max(10_000_000),
            housing: z.coerce.number().min(0).max(10_000_000).optional(),
            transport: z.coerce.number().min(0).max(10_000_000).optional(),
            otherAllowance: z.coerce.number().min(0).max(10_000_000).optional(),
            changeReason: note,
          })
          .parse(body);
        return setCompensation(ctx, input);
      }

      case 'payroll-adjustment-add': {
        const input = z
          .object({
            employeeId: id,
            effectiveOn: z.coerce.date(),
            code: z.string().min(1).max(32),
            label: z.string().min(1).max(120),
            kind: z.enum(['EARNING', 'DEDUCTION']),
            amount: z.coerce.number().min(0.01).max(10_000_000),
            reason: note,
          })
          .parse(body);
        return addAdjustment(ctx, input);
      }

      case 'payroll-run-create': {
        const input = z
          .object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date(), note })
          .parse(body);
        return createRun(ctx, input.periodStart, input.periodEnd, input.note);
      }

      case 'payroll-run-calculate': {
        const input = z.object({ runId: id }).parse(body);
        return calculateRun(ctx, input.runId);
      }

      case 'payroll-run-submit': {
        const input = z.object({ runId: id }).parse(body);
        return submitRun(ctx, input.runId);
      }

      case 'payroll-run-decide': {
        const input = z.object({ runId: id, approve: z.coerce.boolean(), note }).parse(body);
        return approveRun(ctx, input.runId, input.approve, input.note);
      }

      case 'payroll-run-lock': {
        const input = z.object({ runId: id }).parse(body);
        return lockRun(ctx, input.runId);
      }

      case 'payroll-run-paid': {
        const input = z.object({ runId: id }).parse(body);
        return markRunPaid(ctx, input.runId);
      }

      case 'roster-assign': {
        const input = z
          .object({ employeeId: id, shiftId: id, workDate: z.coerce.date(), note })
          .parse(body);
        return assignShift(ctx, input);
      }

      case 'roster-bulk-assign': {
        const input = z
          .object({
            employeeIds: z.array(id).min(1).max(500),
            shiftId: id,
            from: z.coerce.date(),
            to: z.coerce.date(),
            weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional(),
          })
          .parse(body);
        return bulkAssign(ctx, input);
      }

      case 'roster-copy-week': {
        const input = z
          .object({
            fromWeekStart: z.coerce.date(),
            toWeekStart: z.coerce.date(),
            employeeIds: z.array(id).max(500).optional(),
          })
          .parse(body);
        return copyWeek(ctx, input);
      }

      case 'roster-remove': {
        const input = z.object({ entryId: id }).parse(body);
        return removeRosterEntry(ctx, input.entryId);
      }

      case 'shift-change-request': {
        const input = z
          .object({
            entryId: id,
            reason: z.string().min(1).max(1000),
            requestedShiftId: id.optional(),
            counterpartEntryId: id.optional(),
          })
          .parse(body);
        return requestShiftChange(ctx, input);
      }

      case 'shift-change-decide': {
        const input = z.object({ requestId: id, approve: z.coerce.boolean(), note }).parse(body);
        return decideShiftChange(ctx, input.requestId, input.approve, input.note);
      }

      case 'shift-change-cancel': {
        const input = z.object({ requestId: id }).parse(body);
        return cancelShiftChange(ctx, input.requestId);
      }

      case 'requisition-create': {
        const input = z
          .object({
            title: z.string().min(2).max(160),
            departmentId: id.optional(),
            hiringManagerId: id.optional(),
            recruiterId: id.optional(),
            openings: z.coerce.number().int().min(1).max(500).optional(),
            employmentType: z.string().max(60).optional(),
            locationId: id.optional(),
            salaryMin: z.coerce.number().min(0).max(10_000_000).optional(),
            salaryMax: z.coerce.number().min(0).max(10_000_000).optional(),
            description: z.string().max(8000).optional(),
            skills: z.array(z.string().max(60)).max(50).optional(),
            reason: note,
            isInternal: z.coerce.boolean().optional(),
          })
          .parse(body);
        return createRequisition(ctx, input);
      }

      case 'requisition-submit': {
        const input = z.object({ requisitionId: id }).parse(body);
        return submitRequisition(ctx, input.requisitionId);
      }

      case 'requisition-decide': {
        const input = z.object({ requisitionId: id, approve: z.coerce.boolean(), note }).parse(body);
        return decideRequisition(ctx, input.requisitionId, input.approve, input.note);
      }

      case 'requisition-status': {
        const input = z.object({ requisitionId: id, status: z.enum(['OPEN', 'ON_HOLD', 'CLOSED']) }).parse(body);
        return setRequisitionStatus(ctx, input.requisitionId, input.status);
      }

      case 'candidate-add': {
        const input = z
          .object({
            requisitionId: id,
            fullName: z.string().min(2).max(160),
            email: z.string().email().max(254),
            phone: z.string().max(40).optional(),
            source: z.string().max(60).optional(),
            experienceYears: z.coerce.number().min(0).max(70).optional(),
            skills: z.array(z.string().max(60)).max(50).optional(),
            resumeDocumentId: id.optional(),
            notes: z.string().max(4000).optional(),
          })
          .parse(body);
        return addCandidate(ctx, input);
      }

      case 'candidate-move': {
        const input = z
          .object({
            candidateId: id,
            stage: z.enum([
              'APPLIED',
              'SCREENING',
              'SHORTLISTED',
              'INTERVIEW',
              'ASSESSMENT',
              'FINAL_INTERVIEW',
              'OFFER',
              'REJECTED',
              'WITHDRAWN',
              'ON_HOLD',
            ]),
            note,
          })
          .parse(body);
        return moveCandidate(ctx, input.candidateId, input.stage, input.note);
      }

      case 'interview-schedule': {
        const input = z
          .object({
            candidateId: id,
            scheduledAt: z.coerce.date(),
            durationMinutes: z.coerce.number().int().min(5).max(600).optional(),
            type: z.enum(['PHONE', 'VIDEO', 'ONSITE', 'PANEL', 'TECHNICAL']).optional(),
            location: z.string().max(400).optional(),
            panelIds: z.array(id).min(1).max(20),
          })
          .parse(body);
        return scheduleInterview(ctx, input);
      }

      case 'interview-feedback': {
        const input = z
          .object({
            interviewId: id,
            rating: z.coerce.number().int().min(1).max(5),
            recommendation: z.enum(['STRONG_YES', 'YES', 'NEUTRAL', 'NO', 'STRONG_NO']),
            scores: z.record(z.string().max(60), z.coerce.number().min(0).max(10)).optional(),
            notes: z.string().max(4000).optional(),
          })
          .parse(body);
        return submitFeedback(ctx, input);
      }

      case 'offer-create': {
        const input = z
          .object({
            candidateId: id,
            basic: z.coerce.number().min(0.01).max(10_000_000),
            housing: z.coerce.number().min(0).max(10_000_000).optional(),
            transport: z.coerce.number().min(0).max(10_000_000).optional(),
            otherAllowance: z.coerce.number().min(0).max(10_000_000).optional(),
            joiningDate: z.coerce.date(),
            expiresAt: z.coerce.date().optional(),
            notes: z.string().max(4000).optional(),
          })
          .parse(body);
        return createOffer(ctx, input);
      }

      case 'offer-decide': {
        const input = z.object({ offerId: id, approve: z.coerce.boolean(), note }).parse(body);
        return decideOffer(ctx, input.offerId, input.approve, input.note);
      }

      case 'offer-send': {
        const input = z.object({ offerId: id }).parse(body);
        return sendOffer(ctx, input.offerId);
      }

      case 'offer-response': {
        const input = z.object({ offerId: id, accepted: z.coerce.boolean(), note }).parse(body);
        return recordOfferResponse(ctx, input.offerId, input.accepted, input.note);
      }

      case 'candidate-hire': {
        const input = z
          .object({
            candidateId: id,
            employeeNumber: z.string().min(2).max(40),
            roleKey: z.string().min(2).max(50).optional(),
            departmentId: id.optional(),
            designation: z.string().max(120).optional(),
          })
          .parse(body);
        return hireCandidate(ctx, input);
      }

      case 'candidate-onboard': {
        const input = z.object({ candidateId: id }).parse(body);
        return startOnboardingForCandidate(ctx, input.candidateId);
      }

      case 'cycle-create': {
        const input = z
          .object({
            name: z.string().min(2).max(120),
            type: z.enum(['ANNUAL', 'SEMIANNUAL', 'QUARTERLY', 'PROBATION', 'CUSTOM']).optional(),
            periodStart: z.coerce.date(),
            periodEnd: z.coerce.date(),
            selfReviewDueAt: z.coerce.date().optional(),
            managerReviewDueAt: z.coerce.date().optional(),
          })
          .parse(body);
        return createCycle(ctx, input);
      }

      case 'cycle-open': {
        const input = z.object({ cycleId: id }).parse(body);
        return openCycle(ctx, input.cycleId);
      }

      case 'cycle-status': {
        const input = z.object({ cycleId: id, status: z.enum(['CALIBRATION', 'CLOSED']) }).parse(body);
        return setCycleStatus(ctx, input.cycleId, input.status);
      }

      case 'competencies-seed':
        return seedCompetencies(ctx);

      case 'goal-set': {
        const input = z
          .object({
            employeeId: id.optional(),
            cycleId: id.optional(),
            title: z.string().min(2).max(200),
            description: z.string().max(4000).optional(),
            metric: z.string().max(200).optional(),
            target: z.string().max(200).optional(),
            weight: z.coerce.number().int().min(0).max(100).optional(),
            dueOn: z.coerce.date().optional(),
          })
          .parse(body);
        return setGoal(ctx, input);
      }

      case 'goal-update': {
        const input = z
          .object({
            goalId: id,
            progress: z.coerce.number().int().min(0).max(100).optional(),
            status: z.enum(['ACTIVE', 'ACHIEVED', 'MISSED', 'CANCELLED']).optional(),
            evidence: z.string().max(4000).optional(),
          })
          .parse(body);
        return updateGoalProgress(ctx, input.goalId, input);
      }

      case 'review-self': {
        const input = z
          .object({
            reviewId: id,
            comments: z.string().min(1).max(8000),
            rating: z.coerce.number().int().min(1).max(5).optional(),
            competencyScores: z
              .array(
                z.object({
                  competencyId: id,
                  score: z.coerce.number().int().min(1).max(5),
                  comment: z.string().max(2000).optional(),
                }),
              )
              .max(40)
              .optional(),
          })
          .parse(body);
        return submitSelfReview(ctx, input);
      }

      case 'review-manager': {
        const input = z
          .object({
            reviewId: id,
            comments: z.string().min(1).max(8000),
            rating: z.coerce.number().int().min(1).max(5),
            competencyScores: z
              .array(z.object({ competencyId: id, score: z.coerce.number().int().min(1).max(5) }))
              .max(40)
              .optional(),
          })
          .parse(body);
        return submitManagerReview(ctx, input);
      }

      case 'review-calibrate': {
        const input = z
          .object({ reviewId: id, finalRating: z.coerce.number().int().min(1).max(5), note })
          .parse(body);
        return calibrateReview(ctx, input.reviewId, input.finalRating, input.note);
      }

      case 'review-acknowledge': {
        const input = z.object({ reviewId: id, note }).parse(body);
        return acknowledgeReview(ctx, input.reviewId, input.note);
      }

      case 'pip-create': {
        const input = z
          .object({
            employeeId: id,
            objective: z.string().min(1).max(4000),
            expectedImprovements: z.string().min(1).max(4000),
            startsOn: z.coerce.date(),
            endsOn: z.coerce.date(),
            checkpoints: z
              .array(z.object({ dueOn: z.coerce.date(), expectation: z.string().min(1).max(2000) }))
              .max(24)
              .optional(),
          })
          .parse(body);
        return createPip(ctx, input);
      }

      case 'pip-activate': {
        const input = z.object({ pipId: id }).parse(body);
        return activatePip(ctx, input.pipId);
      }

      case 'pip-acknowledge': {
        const input = z.object({ pipId: id, note }).parse(body);
        return acknowledgePip(ctx, input.pipId, input.note);
      }

      case 'pip-checkpoint': {
        const input = z
          .object({ checkpointId: id, met: z.coerce.boolean(), managerComment: z.string().max(2000).optional() })
          .parse(body);
        return recordCheckpoint(ctx, input.checkpointId, input);
      }

      case 'pip-close': {
        const input = z
          .object({ pipId: id, success: z.coerce.boolean(), outcome: z.string().min(1).max(4000) })
          .parse(body);
        return closePip(ctx, input.pipId, input.success, input.outcome);
      }

      case 'leave-carry-forward': {
        const input = z.object({ fromYear: z.coerce.number().int().min(2000).max(2100) }).parse(body);
        return runCarryForward(ctx, input.fromYear);
      }

      case 'onboarding-start': {
        const input = z.object({ employeeId: id }).parse(body);
        return startOnboarding(ctx, input.employeeId);
      }

      case 'employee-activate': {
        const input = z.object({ employeeId: id }).parse(body);
        return activateEmployee(ctx, input.employeeId);
      }

      case 'checklist-complete': {
        const input = z.object({ taskId: id, notes: note }).parse(body);
        return completeTask(ctx, input.taskId, input.notes);
      }

      case 'checklist-reopen': {
        const input = z.object({ taskId: id }).parse(body);
        return reopenTask(ctx, input.taskId);
      }

      case 'checklist-add': {
        const input = z
          .object({
            employeeId: id,
            phase: z.enum(['ONBOARDING', 'OFFBOARDING']),
            title: z.string().min(3).max(160),
            ownerDepartment: z.string().max(60).optional(),
            dueDate: z.coerce.date().optional(),
            blocking: z.coerce.boolean().optional(),
          })
          .parse(body);
        return addTask(ctx, input);
      }

      case 'offboarding-start': {
        const input = z
          .object({
            employeeId: id,
            noticeGivenOn: z.coerce.date(),
            noticePeriodDays: z.coerce.number().int().min(0).max(180).optional(),
            lastWorkingOn: z.coerce.date().optional(),
            separationType: z.enum(['RESIGNATION', 'TERMINATION']).optional(),
            reason: z.string().min(3).max(1000),
          })
          .parse(body);
        return startOffboarding(ctx, input);
      }

      case 'employee-exit': {
        const input = z.object({ employeeId: id, confirmSettlementPaid: z.coerce.boolean() }).parse(body);
        return finaliseExit(ctx, input.employeeId, input.confirmSettlementPaid);
      }

      // ── Biometrics and attendance ──────────────────────────────────────────
      case 'consent-grant': {
        const input = z.object({ policyVersion: z.string().max(40).optional() }).parse(body);
        return grantConsent(ctx, input.policyVersion);
      }

      case 'consent-withdraw': {
        const input = z.object({ employeeId: id.optional() }).parse(body);
        return withdrawConsent(ctx, input.employeeId);
      }

      case 'face-enrol': {
        const input = z.object({ employeeId: id, frames: z.array(z.string().min(16)).min(1).max(10) }).parse(body);
        return enrolFace(ctx, input.employeeId, input.frames);
      }

      case 'attendance-preflight': {
        const input = z
          .object({
            punchType: z.enum(['CHECK_IN', 'CHECK_OUT']),
            latitude: z.coerce.number().min(-90).max(90),
            longitude: z.coerce.number().min(-180).max(180),
            gpsAccuracyM: z.coerce.number().min(0).default(0),
          })
          .parse(body);
        return preflight(ctx, input.punchType, input);
      }

      case 'attendance-challenge':
        return requestChallenge(ctx);

      case 'attendance-punch': {
        const input = z
          .object({
            punchType: z.enum(['CHECK_IN', 'CHECK_OUT']),
            nonce: z.string().min(8).max(120),
            frames: z.array(z.string().min(16)).min(2).max(6),
            latitude: z.coerce.number().min(-90).max(90),
            longitude: z.coerce.number().min(-180).max(180),
            gpsAccuracyM: z.coerce.number().min(0).default(0),
            deviceFingerprint: z.string().min(4).max(120),
            mockLocationFlag: z.coerce.boolean().optional(),
            clientTime: z.coerce.date().optional(),
            clientPunchUid: z.string().max(64).optional(),
            syncedOffline: z.coerce.boolean().optional(),
          })
          .parse(body);
        return punch(ctx, input);
      }

      // Validated against the registry, not a schema written twice: an unknown
      // key is ignored and an out-of-range one is a 422 naming the field.
      case 'settings-update':
        return updateHrPolicy(ctx, body as Record<string, unknown>);

      // ── Temporary work locations and attendance exceptions ────────────────
      case 'temporary-request': {
        const input = z
          .object({
            name: z.string().min(2).max(140),
            latitude: z.coerce.number().min(-90).max(90),
            longitude: z.coerce.number().min(-180).max(180),
            radiusMeters: z.coerce.number().int().min(10).max(10_000),
            validFrom: z.coerce.date(),
            validTo: z.coerce.date(),
            reason: z.string().min(5).max(400),
            employeeIds: z.union([z.array(id), id.transform((value) => [value])]),
          })
          .parse(body);
        return requestTemporaryLocation(ctx, input);
      }

      case 'temporary-decide': {
        const input = z
          .object({ requestId: id, approve: z.coerce.boolean(), note: z.string().max(300).optional() })
          .parse(body);
        return decideTemporaryLocation(ctx, input.requestId, input.approve, input.note);
      }

      case 'exception-request': {
        const input = z
          .object({
            requestedAction: z.enum(['CHECK_IN', 'CHECK_OUT']),
            requestedFor: z.coerce.date(),
            latitude: z.coerce.number().min(-90).max(90).optional(),
            longitude: z.coerce.number().min(-180).max(180).optional(),
            reasonCode: z.enum(EXCEPTION_REASONS),
            reasonText: z.string().max(500).optional(),
            attachmentName: z.string().max(200).optional(),
          })
          .parse(body);
        return requestAttendanceException(ctx, input);
      }

      case 'exception-decide': {
        const input = z
          .object({ requestId: id, approve: z.coerce.boolean(), comment: z.string().min(2).max(300) })
          .parse(body);
        return decideAttendanceException(ctx, input.requestId, input.approve, input.comment);
      }

      case 'document-delete': {
        const input = z.object({ documentId: id }).parse(body);
        return deleteDocument(ctx, input.documentId);
      }

      case 'location-revoke': {
        const input = z.object({ assignmentId: id, reason: z.string().max(500).optional() }).parse(body);
        if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can revoke a work-location assignment.');
        const assignment = await prisma.hrEmployeeLocationAssignment.findFirst({
          where: { tenantId: ctx.tenantId, id: input.assignmentId },
        });
        if (!assignment) throw NotFound('Assignment');
        const actor = await myEmployee(ctx);
        return prisma.hrEmployeeLocationAssignment.update({
          where: { tenantId: ctx.tenantId, id: assignment.id },
          data: {
            status: 'REVOKED',
            revokedAt: new Date(),
            revokedById: actor?.id ?? null,
            revocationReason: input.reason ?? null,
          },
        });
      }
    }
  },
);
