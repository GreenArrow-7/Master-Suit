import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx, type TxClient } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { requireWorkspace } from '@/lib/workspace';
import { assertPermission, type Ctx } from '@/lib/security/rbac';
import { applyForLeave, balancesFor, myEmployee, teamCalendar } from '@/services/hr/leave';
import { isApprover, isAttendanceApprover, isHrAdmin, mayReadAllEmployees } from '@/services/hr/access';
import { checklistFor, expiringDocuments, lifecycleDashboard, settlementFor } from '@/services/hr/lifecycle';
import { attendanceDays, faceStatus, myPunches, reviewQueue } from '@/services/hr/attendance';
import { DEFAULT_POLICY, getHrPolicy, HR_SETTINGS } from '@/services/hr/settings';
import { EXCEPTION_REASONS, listExceptionRequests, listTemporaryRequests } from '@/services/hr/requests';
import { listDocuments } from '@/services/hr/documents';
import { inviteUser } from '@/services/identity/invitations';
import { EMPLOYEE_WITH_PERSON, MEMBERSHIP_WITH_ROLE_PUBLIC } from '@/services/hr/publicSelect';

const paramsSchema = z.object({
  workspaceSlug: z.string().min(2).max(64),
  resource: z.enum([
    'departments',
    'designations',
    'employees',
    'attendance',
    'shifts',
    'leave',
    'holidays',
    'documents',
    'work-locations',
    'leave-types',
    'leave-balances',
    'leave-pending',
    'leave-calendar',
    'checklist',
    'lifecycle',
    'expiring-documents',
    'settlement',
    'attendance-days',
    'attendance-punches',
    'attendance-review',
    'face-status',
    'location-assignments',
    'settings',
    'temporary-requests',
    'exception-requests',
    'exception-reasons',
  ]),
});

const querySchema = z
  .object({
    employeeId: z.string().max(64).optional(),
    phase: z.enum(['ONBOARDING', 'OFFBOARDING']).optional(),
    withinDays: z.coerce.number().int().min(1).max(365).optional(),
    start: z.coerce.date().optional(),
    end: z.coerce.date().optional(),
    noticeShortfallDays: z.coerce.number().int().min(0).max(365).optional(),
    noticeBasis: z.enum(['total', 'basic']).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    locationId: z.string().max(64).optional(),
    mine: z.string().optional(),
  })
  .passthrough();

/**
 * What each read needs, beyond the module entitlement.
 *
 * The kernel gate is `employee:VIEW` — the floor for reaching HR at all — and
 * anything narrower is asserted here. Before this, one `hrms:VIEW` opened every
 * resource below at workspace scope, so an employee who could see their own
 * payslip could also list every colleague, every attendance record and every
 * work location.
 */
const RESOURCE_PERMISSION: Partial<Record<string, [string, 'VIEW' | 'EDIT' | 'APPROVE' | 'MANAGE_CONFIGURATION']>> = {
  'attendance-review': ['attendance', 'APPROVE'],
  'exception-requests': ['attendance', 'APPROVE'],
  'temporary-requests': ['attendance', 'APPROVE'],
  'leave-pending': ['leave', 'APPROVE'],
  settings: ['employee', 'EDIT'],
};

export const GET = route(
  { module: 'employee', productModule: 'HRMS', action: 'VIEW', params: paramsSchema, query: querySchema },
  async ({ ctx, params, query }) => {
    await requireWorkspace(ctx, params.workspaceSlug, 'HRMS');
    const extra = RESOURCE_PERMISSION[params.resource];
    if (extra) assertPermission(ctx, extra[0], extra[1]);

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
        });

      // Attendance is a record of where a named person was and when. Same rule.
      case 'attendance':
        return prisma.hrAttendanceRecord.findMany({
          where: { tenantId: ctx.tenantId, ...(await attendanceScope(ctx)) },
          include: { employee: EMPLOYEE_WITH_PERSON, location: true },
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
        });
      case 'holidays':
        return prisma.hrHoliday.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { holidayDate: 'asc' } });
      // Scoped: personal identity documents are not workspace-readable. HR sees
      // everyone, everyone else sees only their own.
      case 'documents':
        return listDocuments(ctx, query.employeeId);
      case 'work-locations':
        return prisma.hrWorkLocation.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } });

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

      case 'location-assignments':
        return prisma.hrEmployeeLocationAssignment.findMany({
          where: {
            tenantId: ctx.tenantId,
            ...(query.employeeId ? { employeeId: query.employeeId } : {}),
            ...(query.locationId ? { locationId: query.locationId } : {}),
          },
          include: { location: true, employee: EMPLOYEE_WITH_PERSON },
          orderBy: { assignedAt: 'desc' },
        });
    }
  },
);

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

const createBody = z.record(z.string(), z.unknown());

export const POST = route(
  {
    module: 'employee',
    productModule: 'HRMS',
    action: 'CREATE',
    params: paramsSchema,
    body: createBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, params, body }) => {
    const workspace = await requireWorkspace(ctx, params.workspaceSlug, 'HRMS');
    switch (params.resource) {
      case 'departments': {
        if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can change the department structure.');
        const input = z.object({ name: z.string().min(2).max(120), code: z.string().min(2).max(30) }).parse(body);
        return prisma.department.create({
          data: {
            tenantId: ctx.tenantId,
            name: input.name,
            code: input.code.trim().toUpperCase(),
            createdById: ctx.actor.id,
          },
        });
      }
      case 'designations': {
        if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can change designations.');
        const input = z.object({ name: z.string().min(2).max(120), code: z.string().min(2).max(30) }).parse(body);
        return prisma.designation.create({
          data: { tenantId: ctx.tenantId, name: input.name, code: input.code.trim().toUpperCase() },
        });
      }
      case 'employees': {
        // Hiring someone creates a *login*, so it goes through the invitation
        // flow rather than creating an account outright. That is user
        // administration, not HR data entry: `hrms:CREATE` is not sufficient,
        // because the payload names the role the new account is bound to.
        //
        // `initialPassword` used to be a required field here — the administrator
        // chose the new hire's password and communicated it out of band, so
        // every account began life with a credential someone else knew. The
        // employee record is created when the invitation is accepted, by which
        // point the person has set a password only they have seen.
        assertPermission(ctx, 'users', 'MANAGE_USERS');
        if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can add employees.');

        const input = z
          .object({
            fullName: z.string().min(2).max(160),
            email: z.string().email().max(254),
            employeeNumber: z.string().min(2).max(40),
            roleKey: z.string().min(2).max(50).default('employee'),
            departmentId: z.string().optional().or(z.literal('')),
            designation: z.string().max(120).optional(),
          })
          .parse(body);

        const employeeCount = await prisma.employeeProfile.count({
          where: { tenantId: ctx.tenantId, deletedAt: null },
        });
        if (workspace.maxEmployees && employeeCount >= workspace.maxEmployees) {
          throw Conflict('This workspace has reached its employee limit.');
        }

        // The role is caller-supplied and therefore a privilege-escalation
        // vector; inviteUser applies the same rank guard as every other path
        // that binds a person to a role. Seat limits are checked there too.
        const role = await withTx(
          ctx.tenantId,
          async (tx) =>
            (await tx.role.findFirst({ where: { tenantId: ctx.tenantId, key: input.roleKey } })) ??
            (await createDefaultEmployeeRole(tx, ctx.tenantId, input.roleKey)),
        );

        return inviteUser(ctx, {
          email: input.email,
          fullName: input.fullName,
          roleId: role.id,
          employeeNumber: input.employeeNumber,
          jobTitle: input.designation,
          departmentId: input.departmentId || undefined,
        });
      }
      // Writing attendance for someone else is a claim about where they were.
      // `hrms:CREATE` used to be enough — the same permission that adds a
      // department could mark any employee id PRESENT, which is timesheet fraud
      // with no approval step and no record of who asserted it.
      case 'attendance': {
        const input = z
          .object({
            employeeId: z.string(),
            workDate: z.coerce.date(),
            status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'REMOTE', 'ON_LEAVE']),
            checkInAt: z.coerce.date().optional(),
            checkOutAt: z.coerce.date().optional(),
            notes: z.string().max(500).optional(),
          })
          .parse(body);

        const self = await myEmployee(ctx);
        if (input.employeeId !== self?.id) {
          assertPermission(ctx, 'attendance', 'APPROVE');
        }
        await ensureEmployee(ctx.tenantId, input.employeeId);
        // Who asserted it is on the audit row the kernel writes for this route
        // (`auditEvent: 'RECORD_CREATED'`), so it is not duplicated here.
        return prisma.hrAttendanceRecord.create({ data: { tenantId: ctx.tenantId, ...input } });
      }
      case 'shifts': {
        if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can change HR configuration.');
        const input = z
          .object({
            name: z.string().min(2).max(120),
            code: z.string().min(2).max(30),
            startTime: z.string().regex(/^\d{2}:\d{2}$/),
            endTime: z.string().regex(/^\d{2}:\d{2}$/),
          })
          .parse(body);
        return prisma.hrShift.create({
          data: { tenantId: ctx.tenantId, ...input, code: input.code.toUpperCase(), workingDays: [1, 2, 3, 4, 5] },
        });
      }
      // Goes through the leave engine, not a bare insert: overlap, balance,
      // holiday-aware day counting and approver routing all apply here.
      case 'leave': {
        const input = z
          .object({
            employeeId: z.string().optional(),
            leaveTypeId: z.string(),
            startDate: z.coerce.date(),
            endDate: z.coerce.date(),
            halfDay: z.coerce.boolean().optional(),
            reason: z.string().max(1000).optional(),
          })
          .parse(body);
        return applyForLeave(ctx, input);
      }
      case 'holidays': {
        if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can change HR configuration.');
        const input = z
          .object({
            name: z.string().min(2).max(120),
            holidayDate: z.coerce.date(),
            confirmed: z.coerce.boolean().default(true),
          })
          .parse(body);
        return prisma.hrHoliday.create({ data: { tenantId: ctx.tenantId, ...input } });
      }
      case 'documents': {
        const input = z
          .object({
            employeeId: z.string(),
            kind: z.string().min(2).max(60),
            name: z.string().min(2).max(200),
            expiresAt: z.coerce.date().optional(),
          })
          .parse(body);
        await ensureEmployee(ctx.tenantId, input.employeeId);
        return prisma.hrEmployeeDocument.create({ data: { tenantId: ctx.tenantId, ...input } });
      }
      // A location left DRAFT is not a candidate for any punch, so the status
      // and working-hours fields have to be settable here or every check-in at
      // a newly created site is refused with "no active assignment".
      case 'work-locations': {
        if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can change HR configuration.');
        const input = z
          .object({
            name: z.string().min(2).max(120),
            code: z.string().min(1).max(30).optional(),
            latitude: z.coerce.number().min(-90).max(90),
            longitude: z.coerce.number().min(-180).max(180),
            radiusMeters: z.coerce.number().int().min(10).max(10000),
            maxAccuracyMeters: z.coerce.number().int().min(5).max(1000).optional(),
            locationType: z.string().max(40).optional(),
            address: z.string().max(300).optional(),
            emirate: z.string().max(60).optional(),
            openingTime: z
              .string()
              .regex(/^\d{1,2}:\d{2}$/)
              .optional(),
            closingTime: z
              .string()
              .regex(/^\d{1,2}:\d{2}$/)
              .optional(),
            /** JavaScript weekday numbering: Sunday 0 … Saturday 6. Empty means every day. */
            workingDays: z.array(z.coerce.number().int().min(0).max(6)).optional(),
            status: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']).default('ACTIVE'),
          })
          .parse(body);
        return prisma.hrWorkLocation.create({
          data: { tenantId: ctx.tenantId, ...input, code: input.code?.trim().toUpperCase() },
        });
      }

      case 'location-assignments': {
        if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can assign work locations.');
        const input = z
          .object({
            employeeId: z.string().min(1).max(64),
            locationId: z.string().min(1).max(64),
            assignmentType: z.enum(['PRIMARY', 'SECONDARY', 'TEMPORARY']).default('PRIMARY'),
            effectiveFrom: z.coerce.date().optional(),
            effectiveTo: z.coerce.date().optional(),
            checkInAllowed: z.coerce.boolean().default(true),
            checkOutAllowed: z.coerce.boolean().default(true),
            allowedDays: z.array(z.coerce.number().int().min(0).max(6)).optional(),
            allowedStartTime: z
              .string()
              .regex(/^\d{1,2}:\d{2}$/)
              .optional(),
            allowedEndTime: z
              .string()
              .regex(/^\d{1,2}:\d{2}$/)
              .optional(),
            checkoutRule: z.enum(['SAME_LOCATION', 'ANY_ASSIGNED', 'EXCEPTION_ONLY']).default('SAME_LOCATION'),
            notes: z.string().max(500).optional(),
          })
          .parse(body);
        await ensureEmployee(ctx.tenantId, input.employeeId);
        const location = await prisma.hrWorkLocation.findFirst({
          where: { tenantId: ctx.tenantId, id: input.locationId },
        });
        if (!location) throw NotFound('Work location');
        const assigner = await myEmployee(ctx);
        return prisma.hrEmployeeLocationAssignment.create({
          data: {
            tenantId: ctx.tenantId,
            ...input,
            allowedDays: input.allowedDays ?? [],
            status: 'ACTIVE',
            assignedById: assigner?.id ?? null,
          },
          include: { location: true },
        });
      }
    }
  },
);

/**
 * The rank a role gets when the employee-create payload names one that does not
 * exist yet. Deliberately the lowest privilege in the product: an auto-created
 * role must never be able to administer anything, and the number lives here
 * alone so it cannot drift away from the guard that compares against it.
 */
export const DEFAULT_EMPLOYEE_ROLE_RANK = 100;

async function createDefaultEmployeeRole(tx: TxClient, tenantId: string, key: string) {
  const role = await tx.role.create({
    data: { tenantId, key, name: title(key), rank: DEFAULT_EMPLOYEE_ROLE_RANK, defaultScope: 'OWN' },
  });
  const permissions = await tx.permission.findMany({
    where: {
      module: { in: ['leads', 'activities', 'tasks', 'calls', 'employee'] },
      action: { in: ['VIEW', 'CREATE', 'EDIT'] },
    },
  });
  await tx.rolePermission.createMany({
    data: permissions.map((permission) => ({
      tenantId,
      roleId: role.id,
      permissionId: permission.id,
      granted: true,
      scope: 'OWN' as const,
    })),
  });
  return role;
}

async function ensureEmployee(tenantId: string, employeeId: string) {
  const employee = await prisma.employeeProfile.findFirst({ where: { tenantId, id: employeeId, deletedAt: null } });
  if (!employee) throw NotFound('Employee');
}

function title(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Update and archive
//
// Neither verb existed on any HR route until 4.5 — the module was create-only,
// so a department created with a typo stayed misspelt forever, a public holiday
// entered on the wrong date could not be corrected, and someone who left could
// not be archived. `grep "export const PATCH" src/app/api/v1/workspaces`
// returned nothing at all.
//
// Archive rather than delete wherever the model can express it: HR records are
// referenced by attendance, leave and employment history, so a hard delete would
// either fail on a foreign key or take the history with it.
// ─────────────────────────────────────────────────────────────────────────────

const idParam = z.object({ id: z.string().min(1).max(64) });

export const PATCH = route(
  {
    module: 'employee',
    productModule: 'HRMS',
    action: 'EDIT',
    params: paramsSchema,
    query: idParam,
    body: createBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, query, body }) => {
    await requireWorkspace(ctx, params.workspaceSlug, 'HRMS');
    if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can change HR records.');
    const { id } = query;

    switch (params.resource) {
      case 'departments': {
        const input = z
          .object({ name: z.string().min(2).max(120).optional(), code: z.string().min(2).max(30).optional() })
          .parse(body);
        await ensureOwned(prisma.department, ctx.tenantId, id);
        return prisma.department.update({
          where: { tenantId: ctx.tenantId, id },
          data: { ...input, code: input.code?.trim().toUpperCase(), updatedById: ctx.actor.id },
        });
      }

      case 'designations': {
        const input = z
          .object({ name: z.string().min(2).max(120).optional(), code: z.string().min(2).max(30).optional() })
          .parse(body);
        await ensureOwned(prisma.designation, ctx.tenantId, id);
        return prisma.designation.update({
          where: { tenantId: ctx.tenantId, id },
          data: { ...input, code: input.code?.trim().toUpperCase() },
        });
      }

      case 'shifts': {
        const input = z
          .object({
            name: z.string().min(2).max(120).optional(),
            startTime: z
              .string()
              .regex(/^\d{2}:\d{2}$/)
              .optional(),
            endTime: z
              .string()
              .regex(/^\d{2}:\d{2}$/)
              .optional(),
            workingDays: z.array(z.coerce.number().int().min(0).max(6)).optional(),
            isActive: z.coerce.boolean().optional(),
          })
          .parse(body);
        await ensureOwned(prisma.hrShift, ctx.tenantId, id);
        return prisma.hrShift.update({ where: { tenantId: ctx.tenantId, id }, data: input });
      }

      case 'holidays': {
        const input = z
          .object({
            name: z.string().min(2).max(120).optional(),
            holidayDate: z.coerce.date().optional(),
            confirmed: z.coerce.boolean().optional(),
          })
          .parse(body);
        await ensureOwned(prisma.hrHoliday, ctx.tenantId, id);
        return prisma.hrHoliday.update({ where: { tenantId: ctx.tenantId, id }, data: input });
      }

      case 'work-locations': {
        const input = z
          .object({
            name: z.string().min(2).max(120).optional(),
            latitude: z.coerce.number().min(-90).max(90).optional(),
            longitude: z.coerce.number().min(-180).max(180).optional(),
            radiusMeters: z.coerce.number().int().min(10).max(10_000).optional(),
            maxAccuracyMeters: z.coerce.number().int().min(5).max(1000).optional(),
            address: z.string().max(300).optional(),
            emirate: z.string().max(60).optional(),
            openingTime: z
              .string()
              .regex(/^\d{1,2}:\d{2}$/)
              .optional(),
            closingTime: z
              .string()
              .regex(/^\d{1,2}:\d{2}$/)
              .optional(),
            workingDays: z.array(z.coerce.number().int().min(0).max(6)).optional(),
            status: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']).optional(),
          })
          .parse(body);
        await ensureOwned(prisma.hrWorkLocation, ctx.tenantId, id);
        return prisma.hrWorkLocation.update({ where: { tenantId: ctx.tenantId, id }, data: input });
      }

      case 'leave-types': {
        const input = z
          .object({
            name: z.string().min(2).max(120).optional(),
            annualAllowance: z.coerce.number().int().min(0).max(365).optional(),
            paid: z.coerce.boolean().optional(),
            requiresDocument: z.coerce.boolean().optional(),
            isActive: z.coerce.boolean().optional(),
          })
          .parse(body);
        await ensureOwned(prisma.hrLeaveType, ctx.tenantId, id);
        return prisma.hrLeaveType.update({ where: { tenantId: ctx.tenantId, id }, data: input });
      }

      case 'employees': {
        const input = z
          .object({
            departmentId: z.string().max(64).optional().or(z.literal('')),
            designationId: z.string().max(64).optional().or(z.literal('')),
            designation: z.string().max(120).optional(),
            employmentType: z.string().max(50).optional(),
            employmentStatus: z.enum(['ACTIVE', 'ON_NOTICE', 'SUSPENDED', 'EXITED']).optional(),
            joinedOn: z.coerce.date().optional(),
            managerMembershipId: z.string().max(64).optional().or(z.literal('')),
          })
          .parse(body);
        await ensureEmployee(ctx.tenantId, id);
        return prisma.employeeProfile.update({
          where: { tenantId: ctx.tenantId, id },
          data: {
            ...input,
            departmentId: input.departmentId === '' ? null : input.departmentId,
            designationId: input.designationId === '' ? null : input.designationId,
            managerMembershipId: input.managerMembershipId === '' ? null : input.managerMembershipId,
          },
          include: { membership: MEMBERSHIP_WITH_ROLE_PUBLIC, department: true },
        });
      }

      default:
        throw NotFound('That HR resource cannot be edited.');
    }
  },
);

export const DELETE = route(
  {
    module: 'employee',
    productModule: 'HRMS',
    action: 'DELETE',
    params: paramsSchema,
    query: idParam,
    auditEvent: 'RECORD_DELETED',
  },
  async ({ ctx, params, query }) => {
    await requireWorkspace(ctx, params.workspaceSlug, 'HRMS');
    if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can archive HR records.');
    const { id } = query;

    switch (params.resource) {
      // Soft-deleted: referenced by employment history, and the reads above
      // already exclude `deletedAt`.
      case 'departments': {
        await ensureOwned(prisma.department, ctx.tenantId, id);
        const inUse = await prisma.employeeProfile.count({
          where: { tenantId: ctx.tenantId, departmentId: id, deletedAt: null },
        });
        if (inUse > 0)
          throw Conflict(
            `${inUse} employee${inUse === 1 ? '' : 's'} still belong to that department. Move them first.`,
          );
        return prisma.department.update({ where: { tenantId: ctx.tenantId, id }, data: { deletedAt: new Date() } });
      }
      case 'designations': {
        await ensureOwned(prisma.designation, ctx.tenantId, id);
        return prisma.designation.update({ where: { tenantId: ctx.tenantId, id }, data: { deletedAt: new Date() } });
      }
      case 'employees': {
        await ensureEmployee(ctx.tenantId, id);
        return prisma.employeeProfile.update({
          where: { tenantId: ctx.tenantId, id },
          data: { deletedAt: new Date(), employmentStatus: 'EXITED' },
        });
      }

      // Deactivated rather than removed: attendance and leave rows point at
      // these, and the flag is what the reads filter on.
      case 'shifts': {
        await ensureOwned(prisma.hrShift, ctx.tenantId, id);
        return prisma.hrShift.update({ where: { tenantId: ctx.tenantId, id }, data: { isActive: false } });
      }
      case 'leave-types': {
        await ensureOwned(prisma.hrLeaveType, ctx.tenantId, id);
        return prisma.hrLeaveType.update({ where: { tenantId: ctx.tenantId, id }, data: { isActive: false } });
      }
      case 'work-locations': {
        await ensureOwned(prisma.hrWorkLocation, ctx.tenantId, id);
        return prisma.hrWorkLocation.update({
          where: { tenantId: ctx.tenantId, id },
          data: { status: 'RETIRED', isActive: false },
        });
      }

      // A holiday is referenced by nothing, so it really is removed. Entering
      // the wrong date is the common case and a tombstone helps nobody.
      case 'holidays': {
        await ensureOwned(prisma.hrHoliday, ctx.tenantId, id);
        return prisma.hrHoliday.delete({ where: { tenantId: ctx.tenantId, id } });
      }

      default:
        throw NotFound('That HR resource cannot be archived.');
    }
  },
);

/** Confirms the row exists in this workspace before an update names it. */
async function ensureOwned(model: { findFirst: (args: any) => Promise<unknown> }, tenantId: string, id: string) {
  const found = await model.findFirst({ where: { tenantId, id } });
  if (!found) throw NotFound('Record');
}
