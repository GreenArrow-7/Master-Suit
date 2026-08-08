/**
 * Telling people that something is waiting for them.
 *
 * Every approval queue the HR modules added was pull-only: overtime, shift
 * changes, payroll runs, requisitions, offers and reviews all had a page and a
 * dashboard tile, and nothing that told anyone they existed. An approval nobody
 * knows about is an approval that sits.
 *
 * The shape here is deliberately not an event bus. §107 suggests publishing
 * domain events, and a bus is the general answer, but a bus needs a subscriber
 * registry, delivery guarantees and a debugging story of its own. What these
 * modules actually need is one function that answers three questions — who cares,
 * what does it say, where does it go — so that is what this is: a registry keyed
 * by event, in the same shape as the settings and report registries.
 *
 * Two rules from §58 are structural rather than incidental:
 *
 * The in-app row is written synchronously and the email is queued. A payroll
 * approval must not fail because an SMTP host is slow, and it must not take
 * 800 ms either. The insert is one round trip; the mail is somebody else's
 * problem a moment later.
 *
 * Recipients are resolved by *permission*, not by role name. "Whoever can
 * approve overtime" is the honest description of who should hear about an
 * overtime claim, and it stays correct when a workspace invents its own roles.
 */
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import type { Action, Ctx } from '@/lib/security/rbac';

export type HrEventKey =
  | 'overtime.requested'
  | 'overtime.decided'
  | 'leave.requested'
  | 'leave.decided'
  | 'shift_change.requested'
  | 'shift_change.decided'
  | 'payroll.submitted'
  | 'payroll.decided'
  | 'payslip.available'
  | 'requisition.submitted'
  | 'requisition.decided'
  | 'interview.scheduled'
  | 'offer.responded'
  | 'review.opened'
  | 'review.self_submitted'
  | 'review.released'
  | 'pip.opened'
  | 'document.expiring';

interface Audience {
  /** Everyone holding this permission — "whoever can approve overtime". */
  permission?: [string, Action];
  /** Specific employees, by EmployeeProfile id. Resolved to their login. */
  employeeIds?: string[];
}

export interface HrNotification {
  event: HrEventKey;
  audience: Audience;
  title: string;
  body?: string;
  /** Relative to the workspace root; the client prefixes the slug. */
  actionPath?: string;
  objectType?: string;
  recordId?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}

/**
 * Everyone in the workspace holding a permission, as login ids.
 *
 * Reads through RolePermission rather than any role-name convention: a
 * workspace that renamed "HR Administrator" or built its own approval role
 * still gets told.
 */
async function usersWithPermission(tenantId: string, module: string, action: Action): Promise<string[]> {
  const grants = await prisma.rolePermission.findMany({
    where: { tenantId, granted: true, permission: { module, action } },
    select: { roleId: true },
  });
  if (!grants.length) return [];
  const users = await prisma.user.findMany({
    where: { tenantId, status: 'ACTIVE', roleId: { in: [...new Set(grants.map((grant) => grant.roleId))] } },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

/** EmployeeProfile ids to the logins behind them. */
async function usersForEmployees(tenantId: string, employeeIds: string[]): Promise<string[]> {
  if (!employeeIds.length) return [];
  const rows = await prisma.employeeProfile.findMany({
    where: { tenantId, id: { in: [...new Set(employeeIds)] }, deletedAt: null },
    select: { membership: { select: { salesUserId: true } } },
  });
  return rows.map((row) => row.membership.salesUserId).filter((id): id is string => Boolean(id));
}

/**
 * Write the in-app notifications and queue the emails.
 *
 * Never throws. A notification failing must not roll back the approval that
 * caused it — the decision is the durable thing, and a missing email is a
 * smaller problem than a decision that silently did not happen. Failures are
 * logged with the event so they are diagnosable rather than invisible.
 */
export async function notifyHr(ctx: Ctx, notification: HrNotification): Promise<{ recipients: number }> {
  try {
    const [byPermission, byEmployee] = await Promise.all([
      notification.audience.permission
        ? usersWithPermission(ctx.tenantId, notification.audience.permission[0], notification.audience.permission[1])
        : Promise.resolve([]),
      usersForEmployees(ctx.tenantId, notification.audience.employeeIds ?? []),
    ]);

    // The actor is excluded: being told about the thing you just did is noise,
    // and it is how an approval queue becomes something people mute.
    const recipients = [...new Set([...byPermission, ...byEmployee])].filter((id) => id !== ctx.actor.id);
    if (!recipients.length) return { recipients: 0 };

    await prisma.notification.createMany({
      data: recipients.map((userId) => ({
        tenantId: ctx.tenantId,
        userId,
        kind: notification.event,
        title: notification.title,
        body: notification.body ?? null,
        objectType: notification.objectType ?? null,
        recordId: notification.recordId ?? null,
        actionUrl: notification.actionPath ?? null,
        priority: notification.priority ?? 'MEDIUM',
        channels: ['in_app', 'email'],
      })),
    });

    // Queued, not sent: an SMTP host having a bad minute must not slow a payroll
    // approval, and retries belong to the queue rather than to this call.
    await enqueue('notifications', 'hr-event', {
      tenantId: ctx.tenantId,
      event: notification.event,
      userIds: recipients,
      title: notification.title,
      body: notification.body ?? '',
    });

    return { recipients: recipients.length };
  } catch (error) {
    logger.error({ err: error, event: notification.event, tenantId: ctx.tenantId }, 'hr notification failed');
    return { recipients: 0 };
  }
}

// ── Event helpers ──────────────────────────────────────────────────────────
// One per call site, so the wording of an event lives in one place rather than
// being retyped at each of the six queues.

export const notifyOvertimeRaised = (ctx: Ctx, input: { employeeName: string; minutes: number; recordId: string }) =>
  notifyHr(ctx, {
    event: 'overtime.requested',
    audience: { permission: ['overtime', 'APPROVE'] },
    title: `Overtime to approve — ${input.employeeName}`,
    body: `${(input.minutes / 60).toFixed(2)} hours awaiting a decision.`,
    actionPath: '/people/overtime',
    objectType: 'hr_overtime_request',
    recordId: input.recordId,
  });

export const notifyOvertimeDecided = (
  ctx: Ctx,
  input: { employeeId: string; approved: boolean; recordId: string },
) =>
  notifyHr(ctx, {
    event: 'overtime.decided',
    audience: { employeeIds: [input.employeeId] },
    title: `Your overtime claim was ${input.approved ? 'approved' : 'rejected'}`,
    actionPath: '/people/overtime',
    objectType: 'hr_overtime_request',
    recordId: input.recordId,
  });

export const notifyLeaveRaised = (ctx: Ctx, input: { employeeName: string; days: number; recordId: string }) =>
  notifyHr(ctx, {
    event: 'leave.requested',
    audience: { permission: ['leave', 'APPROVE'] },
    title: `Leave to approve — ${input.employeeName}`,
    body: `${input.days} day(s) requested.`,
    actionPath: '/people/leave',
    objectType: 'hr_leave_request',
    recordId: input.recordId,
  });

export const notifyLeaveDecided = (ctx: Ctx, input: { employeeId: string; approved: boolean; recordId: string }) =>
  notifyHr(ctx, {
    event: 'leave.decided',
    audience: { employeeIds: [input.employeeId] },
    title: `Your leave request was ${input.approved ? 'approved' : 'rejected'}`,
    actionPath: '/people/leave',
    objectType: 'hr_leave_request',
    recordId: input.recordId,
  });

export const notifyShiftChangeRaised = (ctx: Ctx, input: { employeeName: string; recordId: string; kind: string }) =>
  notifyHr(ctx, {
    event: 'shift_change.requested',
    audience: { permission: ['shifts', 'APPROVE'] },
    title: `Shift ${input.kind.toLowerCase()} request — ${input.employeeName}`,
    actionPath: '/people/roster',
    objectType: 'hr_shift_change_request',
    recordId: input.recordId,
  });

export const notifyShiftChangeDecided = (
  ctx: Ctx,
  input: { employeeIds: string[]; approved: boolean; recordId: string },
) =>
  notifyHr(ctx, {
    event: 'shift_change.decided',
    audience: { employeeIds: input.employeeIds },
    title: `Your shift change was ${input.approved ? 'approved' : 'rejected'}`,
    actionPath: '/people/roster',
    objectType: 'hr_shift_change_request',
    recordId: input.recordId,
  });

export const notifyPayrollSubmitted = (ctx: Ctx, input: { period: string; net: string; recordId: string }) =>
  notifyHr(ctx, {
    event: 'payroll.submitted',
    audience: { permission: ['payroll', 'APPROVE'] },
    title: `Payroll awaiting approval — ${input.period}`,
    body: `Net total ${input.net}.`,
    actionPath: '/people/payroll',
    objectType: 'hr_payroll_run',
    recordId: input.recordId,
    priority: 'HIGH',
  });

export const notifyPayrollDecided = (
  ctx: Ctx,
  input: { preparedById: string | null; approved: boolean; period: string; recordId: string },
) =>
  notifyHr(ctx, {
    event: 'payroll.decided',
    audience: { employeeIds: input.preparedById ? [input.preparedById] : [] },
    title: `Payroll for ${input.period} was ${input.approved ? 'approved' : 'sent back'}`,
    actionPath: '/people/payroll',
    objectType: 'hr_payroll_run',
    recordId: input.recordId,
    priority: 'HIGH',
  });

export const notifyPayslipsAvailable = (ctx: Ctx, input: { employeeIds: string[]; period: string; recordId: string }) =>
  notifyHr(ctx, {
    event: 'payslip.available',
    audience: { employeeIds: input.employeeIds },
    title: `Your payslip for ${input.period} is available`,
    actionPath: '/people/payslips',
    objectType: 'hr_payroll_run',
    recordId: input.recordId,
  });

export const notifyRequisitionSubmitted = (ctx: Ctx, input: { title: string; recordId: string }) =>
  notifyHr(ctx, {
    event: 'requisition.submitted',
    audience: { permission: ['recruitment', 'APPROVE'] },
    title: `Requisition to approve — ${input.title}`,
    actionPath: '/people/recruitment',
    objectType: 'hr_requisition',
    recordId: input.recordId,
  });

export const notifyRequisitionDecided = (
  ctx: Ctx,
  input: { recruiterId: string | null; approved: boolean; title: string; recordId: string },
) =>
  notifyHr(ctx, {
    event: 'requisition.decided',
    audience: { employeeIds: input.recruiterId ? [input.recruiterId] : [] },
    title: `Requisition "${input.title}" was ${input.approved ? 'approved' : 'rejected'}`,
    actionPath: '/people/recruitment',
    objectType: 'hr_requisition',
    recordId: input.recordId,
  });

export const notifyInterviewScheduled = (
  ctx: Ctx,
  input: { panelIds: string[]; candidateName: string; when: Date; recordId: string; candidateId: string },
) =>
  notifyHr(ctx, {
    event: 'interview.scheduled',
    audience: { employeeIds: input.panelIds },
    title: `Interview scheduled — ${input.candidateName}`,
    body: input.when.toISOString(),
    actionPath: `/people/recruitment/${input.candidateId}`,
    objectType: 'hr_interview',
    recordId: input.recordId,
  });

export const notifyOfferResponded = (
  ctx: Ctx,
  input: { accepted: boolean; candidateName: string; recordId: string; candidateId: string },
) =>
  notifyHr(ctx, {
    event: 'offer.responded',
    audience: { permission: ['recruitment', 'EDIT'] },
    title: `${input.candidateName} ${input.accepted ? 'accepted' : 'declined'} the offer`,
    actionPath: `/people/recruitment/${input.candidateId}`,
    objectType: 'hr_offer',
    recordId: input.recordId,
    priority: input.accepted ? 'HIGH' : 'MEDIUM',
  });

export const notifyReviewCycleOpened = (
  ctx: Ctx,
  input: { employeeIds: string[]; cycleName: string; recordId: string },
) =>
  notifyHr(ctx, {
    event: 'review.opened',
    audience: { employeeIds: input.employeeIds },
    title: `${input.cycleName}: your self-assessment is open`,
    body: 'Your manager cannot complete their review until you have written yours.',
    actionPath: '/people/performance',
    objectType: 'hr_review_cycle',
    recordId: input.recordId,
  });

export const notifySelfReviewSubmitted = (
  ctx: Ctx,
  input: { managerId: string | null; employeeName: string; recordId: string },
) =>
  notifyHr(ctx, {
    event: 'review.self_submitted',
    audience: { employeeIds: input.managerId ? [input.managerId] : [] },
    title: `${input.employeeName} submitted their self-assessment`,
    body: 'Their review is now waiting on you.',
    actionPath: '/people/performance',
    objectType: 'hr_review',
    recordId: input.recordId,
  });

export const notifyReviewReleased = (ctx: Ctx, input: { employeeId: string; rating: number; recordId: string }) =>
  notifyHr(ctx, {
    event: 'review.released',
    audience: { employeeIds: [input.employeeId] },
    title: 'Your review is ready to read',
    body: `Final rating ${input.rating}/5. It is not closed until you acknowledge it.`,
    actionPath: '/people/performance',
    objectType: 'hr_review',
    recordId: input.recordId,
    priority: 'HIGH',
  });

export const notifyPipOpened = (ctx: Ctx, input: { employeeId: string; recordId: string }) =>
  notifyHr(ctx, {
    event: 'pip.opened',
    audience: { employeeIds: [input.employeeId] },
    title: 'An improvement plan has been opened with you',
    body: 'Read it and acknowledge that it has been discussed with you.',
    actionPath: '/people/performance',
    objectType: 'hr_pip',
    recordId: input.recordId,
    priority: 'HIGH',
  });
