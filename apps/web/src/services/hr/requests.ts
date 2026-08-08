/**
 * Temporary work locations and attendance exceptions — the two authorised ways
 * around the geofence.
 *
 * Ported from the original HRMS `app/api/locations.py`. Both exist because a
 * geofence that can only say no is a geofence people work around: an agent at a
 * client site, or someone whose phone died at the door, needs a route that ends
 * in a human decision rather than a support call.
 *
 * Neither route weakens the fence itself:
 *   - an approved temporary request materialises a *real* work location with
 *     hard start and end dates, so every punch is still measured against a
 *     geofence — it is just pointed somewhere new for a fixed window;
 *   - an approved exception writes an accepted punch at the requested time and
 *     leaves the original rejection in the log, because deleting the rejection
 *     would erase the evidence of what actually happened.
 */
import { prisma, withTx } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { haversineM, toDay } from './rules';
import { isApprover, isHrAdmin } from './access';
import { isLineManagerOf, myEmployee, requireEmployee } from './leave';
import { upsertDay } from './attendance';
import { EMPLOYEE_WITH_PERSON } from './publicSelect';

/** Why someone is asking for an attendance correction. Fixed list so the queue is sortable. */
export const EXCEPTION_REASONS = [
  'client_meeting',
  'emergency_site_visit',
  'gps_failure',
  'device_failure',
  'temporary_assignment',
  'business_travel',
  'remote_work_authorised',
] as const;

export type ExceptionReason = (typeof EXCEPTION_REASONS)[number];

// ── H16: temporary work locations ──────────────────────────────────────────

export interface TemporaryRequestInput {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  validFrom: Date;
  validTo: Date;
  reason: string;
  employeeIds: string[];
}

export async function requestTemporaryLocation(ctx: Ctx, input: TemporaryRequestInput) {
  // A request needs a named requester: the "nobody approves their own" rule has
  // nothing to compare against otherwise. A workspace administrator who is not
  // themselves an employee (a platform bootstrap account, say) therefore cannot
  // raise one, and should be told that rather than shown a bare 404.
  const requester = await myEmployee(ctx);
  if (!requester)
    throw Conflict(
      'Your account has no employee record in this workspace, so it cannot raise a temporary-location request. Ask HR to create one, or have an employee raise it.',
    );
  if (input.validTo <= input.validFrom) throw Conflict('The end of the window must be after its start.');
  if (!input.employeeIds.length) throw Conflict('Name at least one employee the temporary site should cover.');

  // Every named employee must exist in this workspace before a location is
  // requested for them; a typo here becomes a site nobody can check in at.
  const employees = await prisma.employeeProfile.findMany({
    where: { tenantId: ctx.tenantId, id: { in: input.employeeIds }, deletedAt: null },
    select: { id: true },
  });
  if (employees.length !== new Set(input.employeeIds).size) throw NotFound('Employee');

  const request = await prisma.hrTemporaryLocationRequest.create({
    data: {
      tenantId: ctx.tenantId,
      name: input.name,
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters,
      validFrom: input.validFrom,
      validTo: input.validTo,
      reason: input.reason,
      employeeIds: [...new Set(input.employeeIds)],
      requestedById: requester.id,
    },
  });

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_temporary_location_request',
    recordId: request.id,
    metadata: { action: 'location.temp.requested', name: input.name, covers: request.employeeIds.length },
  });
  return request;
}

/**
 * Approving creates the location and the assignments in one transaction: a
 * location with nobody assigned to it is not a working outcome, and neither is
 * an assignment pointing at a location that failed to save.
 */
export async function decideTemporaryLocation(ctx: Ctx, requestId: string, approve: boolean, note?: string) {
  if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can decide a temporary-location request.');

  const request = await prisma.hrTemporaryLocationRequest.findFirst({
    where: { tenantId: ctx.tenantId, id: requestId },
  });
  if (!request) throw NotFound('Temporary-location request');
  if (request.status !== 'PENDING') throw Conflict(`This request is already ${request.status.toLowerCase()}.`);

  const actor = await myEmployee(ctx);
  // Nobody approves their own request, however senior. The whole point of the
  // approval is that a second person looked at it.
  if (actor && actor.id === request.requestedById)
    throw Conflict('You cannot approve your own temporary-location request.');

  if (!approve) {
    const rejected = await prisma.hrTemporaryLocationRequest.update({
      where: { tenantId: ctx.tenantId, id: request.id },
      data: { status: 'REJECTED', approverId: actor?.id ?? null, decidedAt: new Date(), decisionNote: note ?? null },
    });
    await audit(ctx, {
      event: 'RECORD_UPDATED',
      objectType: 'hr_temporary_location_request',
      recordId: request.id,
      newValue: { status: 'REJECTED' },
      metadata: { action: 'location.temp.rejected', note },
    });
    return rejected;
  }

  const result = await withTx(ctx.tenantId, async (tx) => {
    const location = await tx.hrWorkLocation.create({
      data: {
        tenantId: ctx.tenantId,
        name: request.name,
        locationType: 'TEMPORARY_SITE',
        latitude: request.latitude,
        longitude: request.longitude,
        radiusMeters: request.radiusMeters,
        status: 'ACTIVE',
        effectiveFrom: toDay(request.validFrom),
        effectiveTo: toDay(request.validTo),
        workingDays: [],
        notes: `Temporary — request ${request.id}: ${request.reason}`,
      },
    });

    await tx.hrEmployeeLocationAssignment.createMany({
      data: request.employeeIds.map((employeeId) => ({
        tenantId: ctx.tenantId,
        employeeId,
        locationId: location.id,
        assignmentType: 'TEMPORARY',
        effectiveFrom: toDay(request.validFrom),
        effectiveTo: toDay(request.validTo),
        allowedDays: [],
        checkoutRule: 'SAME_LOCATION',
        status: 'ACTIVE',
        assignedById: actor?.id ?? null,
        notes: `Temporary request ${request.id}`,
      })),
    });

    const approved = await tx.hrTemporaryLocationRequest.update({
      where: { tenantId: ctx.tenantId, id: request.id },
      data: {
        status: 'APPROVED',
        approverId: actor?.id ?? null,
        decidedAt: new Date(),
        decisionNote: note ?? null,
        createdLocationId: location.id,
      },
    });
    return { request: approved, location };
  });

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_temporary_location_request',
    recordId: request.id,
    newValue: { status: 'APPROVED' },
    metadata: {
      action: 'location.temp.approved',
      locationId: result.location.id,
      assignments: request.employeeIds.length,
    },
  });
  return result.request;
}

export async function listTemporaryRequests(ctx: Ctx, limit = 200) {
  const self = await myEmployee(ctx);
  // A requester sees their own; approvers see the queue.
  const scope = isHrAdmin(ctx) || isApprover(ctx) ? {} : { requestedById: self?.id ?? '' };
  return prisma.hrTemporaryLocationRequest.findMany({
    where: { tenantId: ctx.tenantId, ...scope },
    include: {
      requestedBy: EMPLOYEE_WITH_PERSON,
      approver: EMPLOYEE_WITH_PERSON,
      createdLocation: true,
    },
    orderBy: { requestedAt: 'desc' },
    take: Math.min(limit, 500),
  });
}

// ── H17: attendance exceptions ─────────────────────────────────────────────

export interface ExceptionRequestInput {
  requestedAction: 'CHECK_IN' | 'CHECK_OUT';
  requestedFor: Date;
  latitude?: number;
  longitude?: number;
  reasonCode: string;
  reasonText?: string;
  attachmentName?: string;
}

/**
 * Raised by the employee for themselves. The nearest approved location and the
 * distance to it are measured here, not accepted from the client: they are the
 * evidence the manager and HR will judge, so they must not be forgeable.
 */
export async function requestAttendanceException(ctx: Ctx, input: ExceptionRequestInput) {
  const employee = await myEmployee(ctx);
  if (!employee)
    throw Conflict('Your account has no employee record in this workspace, so there is no attendance to correct.');
  if (!EXCEPTION_REASONS.includes(input.reasonCode as ExceptionReason)) throw Conflict('Unknown reason code.');

  let nearestLocationId: string | null = null;
  let distanceM: number | null = null;
  if (input.latitude !== undefined && input.longitude !== undefined) {
    const locations = await prisma.hrWorkLocation.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { id: true, latitude: true, longitude: true },
    });
    for (const location of locations) {
      const distance = haversineM(input.latitude, input.longitude, location.latitude, location.longitude);
      if (distanceM === null || distance < distanceM) {
        distanceM = distance;
        nearestLocationId = location.id;
      }
    }
  }

  const request = await prisma.hrAttendanceExceptionRequest.create({
    data: {
      tenantId: ctx.tenantId,
      employeeId: employee.id,
      requestedAction: input.requestedAction,
      requestedFor: input.requestedFor,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      nearestLocationId,
      distanceM,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText ?? null,
      attachmentName: input.attachmentName ?? null,
      status: 'PENDING_MANAGER',
    },
  });

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_attendance_exception_request',
    recordId: request.id,
    metadata: {
      action: 'attendance.exception.requested',
      reasonCode: input.reasonCode,
      distanceM: distanceM === null ? null : Math.round(distanceM),
    },
  });
  return request;
}

/**
 * Two stages, in order. The line manager knows whether the employee was really
 * at the client site; HR owns the attendance record. HR can act at either stage
 * so a request is never stuck behind an absent manager, but a manager cannot
 * reach into the HR stage.
 */
export async function decideAttendanceException(ctx: Ctx, requestId: string, approve: boolean, comment: string) {
  if (!comment.trim()) throw Conflict('Give a comment so the employee knows the basis for the decision.');

  const request = await prisma.hrAttendanceExceptionRequest.findFirst({
    where: { tenantId: ctx.tenantId, id: requestId },
  });
  if (!request) throw NotFound('Attendance exception request');

  const actor = await myEmployee(ctx);
  if (actor && actor.id === request.employeeId) throw Forbidden('You cannot decide your own attendance exception.');

  const hr = isHrAdmin(ctx);
  const now = new Date();

  if (request.status === 'PENDING_MANAGER') {
    if (!hr && !(await isLineManagerOf(ctx, request.employeeId))) {
      throw Forbidden("Only the employee's line manager can act at this stage.");
    }
    const updated = await prisma.hrAttendanceExceptionRequest.update({
      where: { tenantId: ctx.tenantId, id: request.id },
      data: {
        managerId: actor?.id ?? null,
        managerComment: comment,
        managerAt: now,
        status: approve ? 'PENDING_HR' : 'REJECTED',
      },
    });
    await audit(ctx, {
      event: 'RECORD_UPDATED',
      objectType: 'hr_attendance_exception_request',
      recordId: request.id,
      previousValue: { status: request.status },
      newValue: { status: updated.status },
      metadata: { action: 'attendance.exception.manager_decision', comment },
    });
    return updated;
  }

  if (request.status === 'PENDING_HR') {
    if (!hr) throw Forbidden('The final stage of an attendance exception is HR only.');

    if (!approve) {
      const rejected = await prisma.hrAttendanceExceptionRequest.update({
        where: { tenantId: ctx.tenantId, id: request.id },
        data: { hrId: actor?.id ?? null, hrComment: comment, hrAt: now, status: 'REJECTED' },
      });
      await audit(ctx, {
        event: 'RECORD_UPDATED',
        objectType: 'hr_attendance_exception_request',
        recordId: request.id,
        previousValue: { status: request.status },
        newValue: { status: 'REJECTED' },
        metadata: { action: 'attendance.exception.hr_decision', comment },
      });
      return rejected;
    }

    // The correction is a new accepted punch, marked as an exception so it is
    // never mistaken for a verified face check-in. The original rejected punch
    // stays exactly where it is.
    const approved = await withTx(ctx.tenantId, async (tx) => {
      const punch = await tx.hrAttendancePunch.create({
        data: {
          tenantId: ctx.tenantId,
          employeeId: request.employeeId,
          punchType: request.requestedAction,
          result: 'ACCEPTED',
          method: 'exception',
          serverTime: request.requestedFor,
          latitude: request.latitude,
          longitude: request.longitude,
          distanceM: request.distanceM,
          locationId: request.nearestLocationId,
          rejectReason: null,
          rejectCode: null,
        },
      });
      return tx.hrAttendanceExceptionRequest.update({
        where: { tenantId: ctx.tenantId, id: request.id },
        data: { hrId: actor?.id ?? null, hrComment: comment, hrAt: now, status: 'APPROVED', createdPunchId: punch.id },
      });
    });

    // Roll the correction into the day record, otherwise an approved exception
    // shows in the queue but never appears on the employee's attendance — which
    // is the only reason they raised it.
    await upsertDay(ctx, request.employeeId, {
      punchType: request.requestedAction,
      serverTime: request.requestedFor,
      locationId: request.nearestLocationId,
    });

    await audit(ctx, {
      event: 'RECORD_UPDATED',
      objectType: 'hr_attendance_exception_request',
      recordId: request.id,
      previousValue: { status: request.status },
      newValue: { status: 'APPROVED' },
      metadata: { action: 'attendance.exception.hr_decision', punchId: approved.createdPunchId, comment },
    });
    return approved;
  }

  throw Conflict(`This request is already ${request.status.toLowerCase().replace(/_/g, ' ')}.`);
}

export async function listExceptionRequests(ctx: Ctx, options: { mine?: boolean; limit?: number } = {}) {
  const self = await myEmployee(ctx);

  // Visibility follows the same rule as the decision, deliberately. The manager
  // stage is granted by the reporting line, not by an hrms permission scope, so
  // scoping this list by permission instead left line managers able to decide a
  // request they could not see.
  const scope: Record<string, unknown> =
    isHrAdmin(ctx) && !options.mine
      ? {}
      : options.mine
        ? { employeeId: self?.id ?? '' }
        : { OR: [{ employeeId: self?.id ?? '' }, { employee: { managerMembershipId: self?.membershipId ?? '' } }] };

  return prisma.hrAttendanceExceptionRequest.findMany({
    where: { tenantId: ctx.tenantId, ...scope },
    include: {
      employee: EMPLOYEE_WITH_PERSON,
      nearestLocation: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(options.limit ?? 200, 500),
  });
}

/** Marks temporary requests whose window has closed, so the queue stays honest. */
export async function expireTemporaryRequests(ctx: Ctx) {
  const { count } = await prisma.hrTemporaryLocationRequest.updateMany({
    where: { tenantId: ctx.tenantId, status: 'PENDING', validTo: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  });
  return count;
}

export async function requireExceptionTarget(ctx: Ctx, employeeId: string) {
  return requireEmployee(ctx, employeeId);
}
