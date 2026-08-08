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
  ]),
});

const id = z.string().min(1).max(64);
const note = z.string().max(1000).optional();

/** Verbs that need more than "may reach HR". Self-service verbs are absent. */
const ACTION_PERMISSION: Partial<Record<string, [string, 'EDIT' | 'APPROVE' | 'MANAGE_CONFIGURATION']>> = {
  'leave-approve': ['leave', 'APPROVE'],
  'leave-reject': ['leave', 'APPROVE'],
  'leave-carry-forward': ['leave', 'APPROVE'],
  'exception-decide': ['attendance', 'APPROVE'],
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
