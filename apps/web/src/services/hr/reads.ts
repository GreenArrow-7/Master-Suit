/**
 * Every read the HR dispatcher serves.
 *
 * ── Why this is not in the route ────────────────────────────────────────────
 *
 * `hr/[resource]/route.ts` was 1,089 lines and both architecture assessments
 * asked for it to be split by resource family. The obstacle was never the
 * mechanics — it was that 34 of its 46 branches had no test naming them, and
 * moving a permission-gated payroll, attendance and leave surface in that state
 * is how a regression reaches payroll. `tests/hr/dispatch-characterisation.spec.ts`
 * closed that first; this is the move it was written to make safe.
 *
 * The switch below is the route's, unchanged — same order, same cases, same
 * comments. Only its address changed. The four helpers above it came with it
 * because nothing else used them.
 *
 * ── What stays in the route, and why ────────────────────────────────────────
 *
 * The permission decision. `RESOURCE_PERMISSION` and the `assertPermission`
 * call remain beside the kernel contract that runs them, so a reader auditing
 * authorization still finds it in one place, in the file the URL maps to.
 * This module is what happens *after* that decision is made.
 *
 * Note the three resources whose real gate is not there but here:
 * `listRequisitions`, `listCandidates` and `pipelineSummary` each assert
 * `mayReadRecruitment` for themselves, and the map records them as FLOOR. That
 * is deliberate and documented, and the characterisation spec pins the set.
 */
import { prisma } from '@/lib/db';
import { Forbidden, NotFound } from '@/lib/errors';
import { type Ctx } from '@/lib/security/rbac';
import { balancesFor, myEmployee, teamCalendar } from '@/services/hr/leave';
import { isApprover, isAttendanceApprover, isHrAdmin, mayReadAllEmployees } from '@/services/hr/access';
import { checklistFor, expiringDocuments, lifecycleDashboard, settlementFor } from '@/services/hr/lifecycle';
import { attendanceDays, faceStatus, myPunches, reviewQueue } from '@/services/hr/attendance';
import { DEFAULT_POLICY, getHrPolicy, HR_SETTINGS } from '@/services/hr/settings';
import { EXCEPTION_REASONS, listExceptionRequests, listTemporaryRequests } from '@/services/hr/requests';
import { listDocuments } from '@/services/hr/documents';
import { listOvertime } from '@/services/hr/overtime';
import { compensationHistory, listRuns, payslipsFor, runDetail } from '@/services/hr/payroll';
import { listShiftChanges, rosterFor } from '@/services/hr/roster';
import { candidateDetail, listCandidates, listRequisitions, pipelineSummary } from '@/services/hr/recruitment';
import { goalsFor, listCycles, performanceSummary, pipsFor, reviewsFor } from '@/services/hr/performance';
import { availableReports, runReport } from '@/services/hr/reports';
import { EMPLOYEE_WITH_PERSON, MEMBERSHIP_WITH_ROLE_PUBLIC } from '@/services/hr/publicSelect';
import type { HrReadParams, HrReadQuery } from './dispatchContract';

/**
 * What a non-administrator may see of a work location: the fence's name and
 * size, never its centre. Latitude, longitude, address and notes stay
 * server-side — knowing the centre is exactly what a convincing GPS spoof
 * needs, and the punch flow never needed them client-side to begin with.
 */
const LOCATION_PUBLIC_SELECT = {
  id: true,
  name: true,
  code: true,
  locationType: true,
  emirate: true,
  radiusMeters: true,
  maxAccuracyMeters: true,
  openingTime: true,
  closingTime: true,
  workingDays: true,
  status: true,
  effectiveFrom: true,
  effectiveTo: true,
} as const;

/** The employee whose record is being read: your own unless you may see others'. */
async function resolveEmployeeId(ctx: Ctx, requested?: string) {
  const self = await myEmployee(ctx);
  if (!requested || requested === self?.id) {
    if (!self) throw NotFound('Employee');
    return self.id;
  }
  if (!isApprover(ctx)) throw Forbidden('You can only view your own record.');
  return requested;
}

/** Which employee records this actor may read. */
async function employeeScope(ctx: Ctx) {
  if (mayReadAllEmployees(ctx)) return {};
  const self = await myEmployee(ctx);
  return { id: self?.id ?? '' };
}

/** Attendance follows the employee records the actor may read. */
async function attendanceScope(ctx: Ctx) {
  if (mayReadAllEmployees(ctx) || isAttendanceApprover(ctx)) return {};
  const self = await myEmployee(ctx);
  return { employeeId: self?.id ?? '' };
}

async function leaveScope(ctx: Ctx) {
  if (isHrAdmin(ctx)) return {};
  const self = await myEmployee(ctx);
  const selfId = self?.id ?? '';
  return isApprover(ctx) ? { OR: [{ employeeId: selfId }, { approverId: selfId }] } : { employeeId: selfId };
}

async function approvalScope(ctx: Ctx) {
  if (isHrAdmin(ctx)) return {};
  const self = await myEmployee(ctx);
  return { approverId: self?.id ?? '' };
}

/**
 * Dispatches one read.
 *
 * The caller has already been authenticated, entitled to HRMS, and checked
 * against `RESOURCE_PERMISSION`. Anything refused below is a resource whose
 * service asserts a rule of its own.
 */
export async function readHrResource({
  ctx,
  params,
  query,
}: {
  ctx: Ctx;
  params: HrReadParams;
  query: HrReadQuery;
}): Promise<unknown> {
  switch (params.resource) {
    case 'departments':
      return prisma.department.findMany({
        where: { tenantId: ctx.tenantId, deletedAt: null },
        orderBy: { name: 'asc' },
      });
    case 'designations':
      return prisma.designation.findMany({
        where: { tenantId: ctx.tenantId, deletedAt: null },
        orderBy: { name: 'asc' },
      });

    // Scoped. A directory of everyone is not something `hrms:VIEW` should have
    // conferred: without ORGANIZATION scope you see yourself, and nothing else.
    case 'employees':
      return prisma.employeeProfile.findMany({
        where: { tenantId: ctx.tenantId, deletedAt: null, ...(await employeeScope(ctx)) },
        include: { membership: MEMBERSHIP_WITH_ROLE_PUBLIC, department: true, designationRecord: true },
        orderBy: { employeeNumber: 'asc' },
        // ponytail: hard cap, not pagination. At 10k employees this endpoint
        // needs a cursor like the CRM lists have; until then the cap keeps one
        // request from serialising the whole directory with three includes.
        take: 2000,
      });

    // Attendance is a record of where a named person was and when. Same rule.
    case 'attendance':
      return prisma.hrAttendanceRecord.findMany({
        where: { tenantId: ctx.tenantId, ...(await attendanceScope(ctx)) },
        include: {
          employee: EMPLOYEE_WITH_PERSON,
          location: isHrAdmin(ctx) ? true : { select: LOCATION_PUBLIC_SELECT },
        },
        orderBy: { workDate: 'desc' },
        take: 100,
      });
    case 'shifts':
      return prisma.hrShift.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } });
    // Leave is personal data: an employee sees their own, an approver also sees
    // what is assigned to them, and only HR sees the whole workspace.
    case 'leave':
      return prisma.hrLeaveRequest.findMany({
        where: { tenantId: ctx.tenantId, ...(await leaveScope(ctx)) },
        include: { employee: EMPLOYEE_WITH_PERSON, leaveType: true },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      });
    case 'holidays':
      return prisma.hrHoliday.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { holidayDate: 'asc' } });
    // Scoped: personal identity documents are not workspace-readable. HR sees
    // everyone, everyone else sees only their own.
    case 'documents':
      return listDocuments(ctx, query.employeeId);
    // The centre coordinate is exactly what a convincing GPS spoof needs, so
    // it never leaves the server for anyone below HR: employees get the
    // fence's name and size, never where it is.
    case 'work-locations':
      return isHrAdmin(ctx)
        ? prisma.hrWorkLocation.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } })
        : prisma.hrWorkLocation.findMany({
            where: { tenantId: ctx.tenantId },
            orderBy: { name: 'asc' },
            select: LOCATION_PUBLIC_SELECT,
          });

    case 'leave-types':
      return prisma.hrLeaveType.findMany({
        where: { tenantId: ctx.tenantId, isActive: true },
        orderBy: { name: 'asc' },
      });

    case 'leave-balances': {
      const employeeId = await resolveEmployeeId(ctx, query.employeeId);
      return balancesFor(ctx, employeeId);
    }

    case 'leave-pending':
      return prisma.hrLeaveRequest.findMany({
        where: { tenantId: ctx.tenantId, status: 'PENDING', ...(await approvalScope(ctx)) },
        include: { employee: EMPLOYEE_WITH_PERSON, leaveType: true },
        orderBy: { startDate: 'asc' },
        take: 1000,
      });

    case 'leave-calendar': {
      const start = query.start ?? new Date();
      const end = query.end ?? new Date(start.getTime() + 60 * 86_400_000);
      return teamCalendar(ctx, start, end);
    }

    case 'checklist': {
      const employeeId = await resolveEmployeeId(ctx, query.employeeId);
      return checklistFor(ctx, employeeId, query.phase);
    }

    // Own claims by default; an approver may narrow to one employee. The
    // service refuses a non-approver asking for somebody else's.
    case 'overtime':
      return listOvertime(ctx, {
        employeeId: query.employeeId,
        status: query.status,
        from: query.start,
        to: query.end,
        limit: query.limit,
        cursor: query.cursor,
      });

    case 'overtime-pending':
      return listOvertime(ctx, { status: 'PENDING', limit: query.limit, cursor: query.cursor });

    case 'payroll-runs':
      return listRuns(ctx, query.limit);

    case 'payroll-run': {
      if (!query.runId) throw NotFound('Payroll run');
      return runDetail(ctx, query.runId);
    }

    case 'payslips':
      return payslipsFor(ctx, query.employeeId);

    case 'compensation': {
      const employeeId = await resolveEmployeeId(ctx, query.employeeId);
      return compensationHistory(ctx, employeeId);
    }

    // Both scope themselves: without `shifts:EDIT` you see your own roster,
    // and without `shifts:APPROVE` you see only requests you are party to.
    case 'roster': {
      const start = query.start ?? new Date();
      const end = query.end ?? new Date(start.getTime() + 28 * 86_400_000);
      return rosterFor(ctx, { from: start, to: end, employeeId: query.employeeId });
    }

    case 'shift-changes':
      return listShiftChanges(ctx, { status: query.status });

    // Salary bands inside these are redacted by the service unless the caller
    // holds `recruitment:VIEW_SENSITIVE_FIELDS`.
    case 'requisitions':
      return listRequisitions(ctx, { status: query.requisitionStatus });
    case 'candidates':
      return listCandidates(ctx, { requisitionId: query.requisitionId, stage: query.stage });
    case 'candidate': {
      if (!query.candidateId) throw NotFound('Candidate');
      return candidateDetail(ctx, query.candidateId);
    }
    case 'pipeline':
      return pipelineSummary(ctx);

    // Each scopes itself: own record, plus your reporting line, plus the
    // workspace only with `performance:VIEW` at ORGANIZATION.
    case 'review-cycles':
      return listCycles(ctx);
    case 'reviews':
      return reviewsFor(ctx, { cycleId: query.cycleId, employeeId: query.employeeId });
    case 'goals':
      return goalsFor(ctx, query.employeeId, query.cycleId);
    case 'competencies':
      return prisma.hrCompetency.findMany({
        where: { tenantId: ctx.tenantId, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
    case 'pips':
      return pipsFor(ctx, query.employeeId);
    case 'performance-summary':
      return performanceSummary(ctx, query.cycleId);

    // `reports` returns only the definitions this caller may run, and `report`
    // re-asserts the same permission — so a key guessed from the list of
    // another role still refuses.
    case 'reports':
      return availableReports(ctx);
    case 'report': {
      if (!query.reportKey) throw NotFound('Report');
      return runReport(ctx, query.reportKey, {
        from: query.start,
        to: query.end,
        departmentId: query.departmentId,
        locationId: query.locationId,
        employeeId: query.employeeId,
        status: query.status,
        cycleId: query.cycleId,
      });
    }

    case 'lifecycle':
      return lifecycleDashboard(ctx);
    case 'expiring-documents':
      return expiringDocuments(ctx, query.withinDays ?? 90, query.employeeId);

    case 'settlement': {
      if (!query.employeeId) throw NotFound('Employee');
      return settlementFor(ctx, query.employeeId, {
        noticeShortfallDays: query.noticeShortfallDays,
        noticeBasis: query.noticeBasis,
      });
    }

    case 'attendance-days':
      return attendanceDays(ctx, {
        employeeId: query.employeeId,
        start: query.start,
        end: query.end,
        limit: query.limit,
      });
    case 'attendance-punches':
      return myPunches(ctx, query.limit ?? 30);
    case 'attendance-review':
      return reviewQueue(ctx, query.limit ?? 200);
    case 'face-status':
      return faceStatus(ctx, query.employeeId);

    // The registry travels with the values so a caller (and the admin screen)
    // always renders exactly the parameters this build supports.
    case 'settings':
      return { definitions: HR_SETTINGS, defaults: DEFAULT_POLICY, policy: await getHrPolicy(ctx) };

    case 'temporary-requests':
      return listTemporaryRequests(ctx, query.limit);
    case 'exception-requests':
      return listExceptionRequests(ctx, { mine: query.mine === 'true', limit: query.limit });
    case 'exception-reasons':
      return EXCEPTION_REASONS;

    // Who works where is HR data; everyone else sees only their own
    // assignments, and never the fence coordinates inside them.
    case 'location-assignments': {
      const hr = isHrAdmin(ctx);
      const employeeId = hr ? query.employeeId : ((await myEmployee(ctx))?.id ?? '');
      return prisma.hrEmployeeLocationAssignment.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(employeeId ? { employeeId } : {}),
          ...(query.locationId ? { locationId: query.locationId } : {}),
        },
        include: {
          location: hr ? true : { select: LOCATION_PUBLIC_SELECT },
          employee: EMPLOYEE_WITH_PERSON,
        },
        orderBy: { assignedAt: 'desc' },
        take: 1000,
      });
    }
  }
}
