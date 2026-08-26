import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx, type TxClient } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { requireWorkspace } from '@/lib/workspace';
import { assertPermission } from '@/lib/security/rbac';
import { audit } from '@/lib/security/audit';
import { applyForLeave, myEmployee } from '@/services/hr/leave';
import { isHrAdmin } from '@/services/hr/access';
import { inviteUser } from '@/services/identity/invitations';
import { MEMBERSHIP_WITH_ROLE_PUBLIC } from '@/services/hr/publicSelect';

import { paramsSchema, querySchema, type HrResource } from '@/services/hr/dispatchContract';
import { readHrResource } from '@/services/hr/reads';

/**
 * The permission each read needs **beyond** the kernel's gate, for every
 * resource — with no gaps possible.
 *
 * The kernel gate is `employee:VIEW`, the floor for reaching HR at all, and
 * anything narrower is asserted here. Before that split, one `hrms:VIEW` opened
 * every resource below at workspace scope, so an employee who could see their
 * own payslip could also list every colleague, every attendance record and every
 * work location.
 *
 * ── Why this is a total Record and not a Partial ────────────────────────────
 *
 * It used to be `Partial<Record<string, ...>>`, which made "this resource needs
 * nothing extra" and "nobody wrote an entry for this resource" the same thing —
 * indistinguishable at the keyboard and at review. Adding a case to the switch
 * below without adding a line here compiled cleanly and silently published that
 * resource to anyone holding `employee:VIEW`.
 *
 * That is precisely the shape of F-01 in security/SECURITY_FINDINGS.md: a new
 * module re-derived an authorization decision its siblings had already made, and
 * the gap was invisible because nothing forced the question to be asked.
 *
 * Keyed by the resource union rather than by `string`, every case must now say
 * what it needs. Add a resource to the enum and this object fails to compile
 * until someone decides.
 */

/**
 * "The kernel's `employee:VIEW` is the whole route-level gate, deliberately."
 *
 * Not an absence of protection — an explicit statement that protection lives one
 * layer down, and the case body says which of the two it is:
 *
 *   * the service asserts its own permission (`listRequisitions` throws without
 *     `mayReadRecruitment`, `reviewsFor` without `performance:VIEW`, and so on); or
 *   * the query narrows to the caller (`employeeScope`, `attendanceScope`,
 *     `leaveScope`), so workspace scope is never what is returned; or
 *   * the rows are workspace reference data with no personal content —
 *     departments, shifts, holidays, leave types, the competency framework.
 *
 * A sentinel rather than `undefined`, so choosing it is a positive act.
 */
const FLOOR = Symbol('employee:VIEW is the whole gate');

type ExtraPermission = readonly [string, 'VIEW' | 'EDIT' | 'APPROVE' | 'MANAGE_CONFIGURATION'];

const RESOURCE_PERMISSION: Record<HrResource, ExtraPermission | typeof FLOOR> = {
  departments: FLOOR,
  designations: FLOOR,
  employees: FLOOR,
  attendance: FLOOR,
  shifts: FLOOR,
  leave: FLOOR,
  holidays: FLOOR,
  documents: FLOOR,
  'work-locations': FLOOR,
  'leave-types': FLOOR,
  'leave-balances': FLOOR,
  'leave-pending': ['leave', 'APPROVE'],
  'leave-calendar': FLOOR,
  checklist: FLOOR,
  lifecycle: FLOOR,
  'expiring-documents': FLOOR,
  settlement: FLOOR,
  'attendance-days': FLOOR,
  'attendance-punches': FLOOR,
  'attendance-review': ['attendance', 'APPROVE'],
  'face-status': FLOOR,
  'location-assignments': FLOOR,
  settings: ['employee', 'EDIT'],
  'temporary-requests': ['attendance', 'APPROVE'],
  'exception-requests': ['attendance', 'APPROVE'],
  'exception-reasons': FLOOR,
  overtime: FLOOR,
  'overtime-pending': ['overtime', 'APPROVE'],
  'payroll-runs': ['payroll', 'VIEW'],
  'payroll-run': ['payroll', 'VIEW'],
  payslips: FLOOR,
  compensation: FLOOR,
  roster: FLOOR,
  'shift-changes': FLOOR,
  requisitions: FLOOR,
  candidates: FLOOR,
  candidate: FLOOR,
  pipeline: FLOOR,
  'review-cycles': FLOOR,
  reviews: FLOOR,
  goals: FLOOR,
  competencies: FLOOR,
  pips: FLOOR,
  'performance-summary': FLOOR,
  reports: FLOOR,
  report: FLOOR,
};

export const GET = route(
  { module: 'employee', productModule: 'HRMS', action: 'VIEW', params: paramsSchema, query: querySchema },
  async ({ ctx, params, query }) => {
    await requireWorkspace(ctx, params.workspaceSlug, 'HRMS');
    const extra = RESOURCE_PERMISSION[params.resource];
    if (extra !== FLOOR) assertPermission(ctx, extra[0], extra[1]);

    // Everything past the permission decision lives in services/hr/reads.
    // The route keeps the decision; that module keeps the 46 answers.
    return readHrResource({ ctx, params, query });
  },
);

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
            // The form asks for both. Undeclared here, zod stripped them and the
            // accepted employee got a blank employment type and a joining date
            // of whenever they happened to click the link.
            employmentType: z.string().max(50).optional().or(z.literal('')),
            joinedOn: z.coerce.date().optional(),
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
          employmentType: input.employmentType || undefined,
          joiningDate: input.joinedOn,
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
            // Single or bulk: v21 assigns several employees to a fence at once.
            // One employee is the one-element case of the same list.
            employeeId: z.string().min(1).max(64).optional(),
            employeeIds: z.array(z.string().min(1).max(64)).min(1).max(500).optional(),
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
          .refine((body) => body.employeeId || (body.employeeIds && body.employeeIds.length), {
            message: 'Name at least one employee to assign.',
          })
          .parse(body);

        const { employeeId, employeeIds, ...shared } = input;
        const targets = [...new Set([...(employeeIds ?? []), ...(employeeId ? [employeeId] : [])])];

        const location = await prisma.hrWorkLocation.findFirst({
          where: { tenantId: ctx.tenantId, id: input.locationId },
        });
        if (!location) throw NotFound('Work location');
        for (const target of targets) await ensureEmployee(ctx.tenantId, target);

        const assigner = await myEmployee(ctx);
        const created = await prisma.$transaction(
          targets.map((target) =>
            prisma.hrEmployeeLocationAssignment.create({
              data: {
                tenantId: ctx.tenantId,
                ...shared,
                employeeId: target,
                allowedDays: shared.allowedDays ?? [],
                status: 'ACTIVE',
                assignedById: assigner?.id ?? null,
              },
            }),
          ),
        );
        return { assigned: created.length, assignmentIds: created.map((row) => row.id) };
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
            changeReason: z.string().max(240).optional(),
          })
          .parse(body);
        const { changeReason, ...data } = input;
        const existing = await prisma.hrWorkLocation.findFirst({ where: { tenantId: ctx.tenantId, id } });
        if (!existing) throw NotFound('Record');

        // Attendance is judged against this fence, so moving or resizing a live
        // one is a decision someone must own in writing. Punches snapshot the
        // geometry they were judged against, so history is safe either way —
        // this is about the next punch, not the last.
        const geometryChanged =
          (data.latitude !== undefined && data.latitude !== existing.latitude) ||
          (data.longitude !== undefined && data.longitude !== existing.longitude) ||
          (data.radiusMeters !== undefined && data.radiusMeters !== existing.radiusMeters);
        if (existing.status === 'ACTIVE' && geometryChanged && !changeReason?.trim()) {
          throw Conflict("Changing an active location's coordinates or radius requires a written reason.");
        }
        const updated = await prisma.hrWorkLocation.update({ where: { tenantId: ctx.tenantId, id }, data });
        if (geometryChanged) {
          await audit(ctx, {
            event: 'RECORD_UPDATED',
            objectType: 'hr_work_location',
            recordId: id,
            metadata: {
              action: 'location.geometry',
              before: { lat: existing.latitude, lng: existing.longitude, radiusM: existing.radiusMeters },
              after: { lat: updated.latitude, lng: updated.longitude, radiusM: updated.radiusMeters },
              reason: changeReason?.trim() || null,
            },
          });
        }
        return updated;
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
            employmentStatus: z.enum(['ACTIVE', 'NOTICE', 'SUSPENDED', 'EXITED']).optional(),
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
