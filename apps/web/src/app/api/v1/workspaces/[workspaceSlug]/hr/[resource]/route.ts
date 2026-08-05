import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { hashPassword } from '@/lib/auth/password';
import { requireWorkspace } from '@/lib/workspace';
import type { Ctx } from '@/lib/security/rbac';
import { applyForLeave, balancesFor, isApprover, isHrAdmin, myEmployee, teamCalendar } from '@/services/hr/leave';
import { checklistFor, expiringDocuments, lifecycleDashboard, settlementFor } from '@/services/hr/lifecycle';
import { attendanceDays, faceStatus, myPunches, reviewQueue } from '@/services/hr/attendance';
import { DEFAULT_POLICY, getHrPolicy, HR_SETTINGS } from '@/services/hr/settings';
import { EXCEPTION_REASONS, listExceptionRequests, listTemporaryRequests } from '@/services/hr/requests';
import { listDocuments } from '@/services/hr/documents';

const paramsSchema = z.object({
  workspaceSlug: z.string().min(2).max(64),
  resource: z.enum([
    'departments', 'employees', 'attendance', 'shifts', 'leave', 'holidays', 'documents', 'work-locations',
    'leave-types', 'leave-balances', 'leave-pending', 'leave-calendar',
    'checklist', 'lifecycle', 'expiring-documents', 'settlement',
    'attendance-days', 'attendance-punches', 'attendance-review', 'face-status',
    'location-assignments', 'settings',
    'temporary-requests', 'exception-requests', 'exception-reasons',
  ]),
});

const querySchema = z.object({
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
}).passthrough();

export const GET = route(
  { module: 'hrms', productModule: 'HRMS', action: 'VIEW', params: paramsSchema, query: querySchema },
  async ({ ctx, params, query }) => {
    await requireWorkspace(ctx, params.workspaceSlug, 'HRMS');
    switch (params.resource) {
      case 'departments': return prisma.department.findMany({ where: { tenantId: ctx.tenantId, deletedAt: null }, orderBy: { name: 'asc' } });
      case 'employees': return prisma.employeeProfile.findMany({
        where: { tenantId: ctx.tenantId, deletedAt: null },
        include: { membership: { include: { platformUser: true, salesUser: { include: { role: true } } } }, department: true, designationRecord: true },
        orderBy: { employeeNumber: 'asc' },
      });
      case 'attendance': return prisma.hrAttendanceRecord.findMany({ where: { tenantId: ctx.tenantId }, include: { employee: { include: { membership: { include: { platformUser: true } } } }, location: true }, orderBy: { workDate: 'desc' }, take: 100 });
      case 'shifts': return prisma.hrShift.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } });
      // Leave is personal data: an employee sees their own, an approver also sees
      // what is assigned to them, and only HR sees the whole workspace.
      case 'leave': return prisma.hrLeaveRequest.findMany({ where: { tenantId: ctx.tenantId, ...(await leaveScope(ctx)) }, include: { employee: { include: { membership: { include: { platformUser: true } } } }, leaveType: true }, orderBy: { createdAt: 'desc' } });
      case 'holidays': return prisma.hrHoliday.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { holidayDate: 'asc' } });
      // Scoped: personal identity documents are not workspace-readable. HR sees
      // everyone, everyone else sees only their own.
      case 'documents': return listDocuments(ctx, query.employeeId);
      case 'work-locations': return prisma.hrWorkLocation.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } });

      case 'leave-types': return prisma.hrLeaveType.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, orderBy: { name: 'asc' } });

      case 'leave-balances': {
        const employeeId = await resolveEmployeeId(ctx, query.employeeId);
        return balancesFor(ctx, employeeId);
      }

      case 'leave-pending': return prisma.hrLeaveRequest.findMany({ where: { tenantId: ctx.tenantId, status: 'PENDING', ...(await approvalScope(ctx)) }, include: { employee: { include: { membership: { include: { platformUser: true } } } }, leaveType: true }, orderBy: { startDate: 'asc' } });

      case 'leave-calendar': {
        const start = query.start ?? new Date();
        const end = query.end ?? new Date(start.getTime() + 60 * 86_400_000);
        return teamCalendar(ctx, start, end);
      }

      case 'checklist': {
        const employeeId = await resolveEmployeeId(ctx, query.employeeId);
        return checklistFor(ctx, employeeId, query.phase);
      }

      case 'lifecycle': return lifecycleDashboard(ctx);
      case 'expiring-documents': return expiringDocuments(ctx, query.withinDays ?? 90, query.employeeId);

      case 'settlement': {
        if (!query.employeeId) throw NotFound('Employee');
        return settlementFor(ctx, query.employeeId, { noticeShortfallDays: query.noticeShortfallDays, noticeBasis: query.noticeBasis });
      }

      case 'attendance-days': return attendanceDays(ctx, { employeeId: query.employeeId, start: query.start, end: query.end, limit: query.limit });
      case 'attendance-punches': return myPunches(ctx, query.limit ?? 30);
      case 'attendance-review': return reviewQueue(ctx, query.limit ?? 200);
      case 'face-status': return faceStatus(ctx, query.employeeId);

      // The registry travels with the values so a caller (and the admin screen)
      // always renders exactly the parameters this build supports.
      case 'settings': return { definitions: HR_SETTINGS, defaults: DEFAULT_POLICY, policy: await getHrPolicy(ctx) };

      case 'temporary-requests': return listTemporaryRequests(ctx, query.limit);
      case 'exception-requests': return listExceptionRequests(ctx, { mine: query.mine === 'true', limit: query.limit });
      case 'exception-reasons': return EXCEPTION_REASONS;

      case 'location-assignments': return prisma.hrEmployeeLocationAssignment.findMany({
        where: { tenantId: ctx.tenantId, ...(query.employeeId ? { employeeId: query.employeeId } : {}), ...(query.locationId ? { locationId: query.locationId } : {}) },
        include: { location: true, employee: { include: { membership: { include: { platformUser: true } } } } },
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
  { module: 'hrms', productModule: 'HRMS', action: 'CREATE', params: paramsSchema, body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, params, body }) => {
    const workspace = await requireWorkspace(ctx, params.workspaceSlug, 'HRMS');
    switch (params.resource) {
      case 'departments': {
        const input = z.object({ name: z.string().min(2).max(120), code: z.string().min(2).max(30) }).parse(body);
        return prisma.department.create({ data: { tenantId: ctx.tenantId, name: input.name, code: input.code.trim().toUpperCase(), createdById: ctx.actor.id } });
      }
      case 'employees': {
        const input = z.object({
          fullName: z.string().min(2).max(160),
          email: z.string().email().max(254),
          initialPassword: z.string().min(12).max(200),
          employeeNumber: z.string().min(2).max(40),
          roleKey: z.string().min(2).max(50).default('employee'),
          departmentId: z.string().optional().or(z.literal('')),
          designation: z.string().max(120).optional(),
          employmentType: z.string().max(50).optional(),
          joinedOn: z.coerce.date().optional(),
        }).parse(body);
        const [employeeCount, userCount] = await Promise.all([
          prisma.employeeProfile.count({ where: { tenantId: ctx.tenantId, deletedAt: null } }),
          prisma.workspaceMembership.count({ where: { tenantId: ctx.tenantId, status: { in: ['ACTIVE', 'INVITED'] } } }),
        ]);
        if (workspace.maxEmployees && employeeCount >= workspace.maxEmployees) throw Conflict('This workspace has reached its employee limit.');
        if (workspace.maxUsers && userCount >= workspace.maxUsers) throw Conflict('This workspace has reached its user limit.');
        const email = input.email.trim().toLowerCase();
        const passwordHash = await hashPassword(input.initialPassword);
        return withTx(async (tx) => {
          let role = await tx.role.findFirst({ where: { tenantId: ctx.tenantId, key: input.roleKey } });
          if (!role) {
            role = await tx.role.create({ data: { tenantId: ctx.tenantId, key: input.roleKey, name: title(input.roleKey), rank: 100, defaultScope: 'OWN' } });
            const permissions = await tx.permission.findMany({ where: { module: { in: ['leads', 'activities', 'tasks', 'calls', 'hrms'] }, action: { in: ['VIEW', 'CREATE', 'EDIT'] } } });
            await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ tenantId: ctx.tenantId, roleId: role!.id, permissionId: permission.id, granted: true, scope: 'OWN' })) });
          }
          const platformUser = await tx.platformUser.upsert({
            where: { normalizedEmail: email },
            update: { fullName: input.fullName, status: 'ACTIVE' },
            create: { email, normalizedEmail: email, fullName: input.fullName, passwordHash, emailVerifiedAt: new Date(), status: 'ACTIVE' },
          });
          const existing = await tx.workspaceMembership.findFirst({ where: { tenantId: ctx.tenantId, platformUserId: platformUser.id } });
          if (existing) throw Conflict('That user already belongs to this workspace.');
          const salesUser = await tx.user.create({
            data: { tenantId: ctx.tenantId, email, fullName: input.fullName, passwordHash, emailVerifiedAt: new Date(), status: 'ACTIVE', roleId: role.id, employeeCode: input.employeeNumber, jobTitle: input.designation },
          });
          const membership = await tx.workspaceMembership.create({
            data: { tenantId: ctx.tenantId, platformUserId: platformUser.id, salesUserId: salesUser.id, status: 'ACTIVE', roleSnapshot: role.key, joinedAt: new Date() },
          });
          await tx.membershipRole.create({ data: { tenantId: ctx.tenantId, membershipId: membership.id, roleId: role.id } });
          const employee = await tx.employeeProfile.create({
            data: { tenantId: ctx.tenantId, membershipId: membership.id, employeeNumber: input.employeeNumber, departmentId: input.departmentId || null, designation: input.designation, employmentType: input.employmentType, joinedOn: input.joinedOn ?? new Date(), employmentStatus: 'ACTIVE' },
            include: { membership: { include: { platformUser: true, salesUser: { include: { role: true } } } }, department: true },
          });
          await tx.workspaceUsage.updateMany({ where: { tenantId: ctx.tenantId, metric: 'employees' }, data: { used: employeeCount + 1, measuredAt: new Date() } });
          await tx.workspaceUsage.updateMany({ where: { tenantId: ctx.tenantId, metric: 'users' }, data: { used: userCount + 1, measuredAt: new Date() } });
          return employee;
        });
      }
      case 'attendance': {
        const input = z.object({ employeeId: z.string(), workDate: z.coerce.date(), status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'REMOTE', 'ON_LEAVE']), checkInAt: z.coerce.date().optional(), checkOutAt: z.coerce.date().optional(), notes: z.string().max(500).optional() }).parse(body);
        await ensureEmployee(ctx.tenantId, input.employeeId);
        return prisma.hrAttendanceRecord.create({ data: { tenantId: ctx.tenantId, ...input } });
      }
      case 'shifts': {
        const input = z.object({ name: z.string().min(2).max(120), code: z.string().min(2).max(30), startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/) }).parse(body);
        return prisma.hrShift.create({ data: { tenantId: ctx.tenantId, ...input, code: input.code.toUpperCase(), workingDays: [1, 2, 3, 4, 5] } });
      }
      // Goes through the leave engine, not a bare insert: overlap, balance,
      // holiday-aware day counting and approver routing all apply here.
      case 'leave': {
        const input = z.object({
          employeeId: z.string().optional(),
          leaveTypeId: z.string(),
          startDate: z.coerce.date(),
          endDate: z.coerce.date(),
          halfDay: z.coerce.boolean().optional(),
          reason: z.string().max(1000).optional(),
        }).parse(body);
        return applyForLeave(ctx, input);
      }
      case 'holidays': {
        const input = z.object({ name: z.string().min(2).max(120), holidayDate: z.coerce.date(), confirmed: z.coerce.boolean().default(true) }).parse(body);
        return prisma.hrHoliday.create({ data: { tenantId: ctx.tenantId, ...input } });
      }
      case 'documents': {
        const input = z.object({ employeeId: z.string(), kind: z.string().min(2).max(60), name: z.string().min(2).max(200), expiresAt: z.coerce.date().optional() }).parse(body);
        await ensureEmployee(ctx.tenantId, input.employeeId);
        return prisma.hrEmployeeDocument.create({ data: { tenantId: ctx.tenantId, ...input } });
      }
      // A location left DRAFT is not a candidate for any punch, so the status
      // and working-hours fields have to be settable here or every check-in at
      // a newly created site is refused with "no active assignment".
      case 'work-locations': {
        const input = z.object({
          name: z.string().min(2).max(120),
          code: z.string().min(1).max(30).optional(),
          latitude: z.coerce.number().min(-90).max(90),
          longitude: z.coerce.number().min(-180).max(180),
          radiusMeters: z.coerce.number().int().min(10).max(10000),
          maxAccuracyMeters: z.coerce.number().int().min(5).max(1000).optional(),
          locationType: z.string().max(40).optional(),
          address: z.string().max(300).optional(),
          emirate: z.string().max(60).optional(),
          openingTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
          closingTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
          /** JavaScript weekday numbering: Sunday 0 … Saturday 6. Empty means every day. */
          workingDays: z.array(z.coerce.number().int().min(0).max(6)).optional(),
          status: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']).default('ACTIVE'),
        }).parse(body);
        return prisma.hrWorkLocation.create({ data: { tenantId: ctx.tenantId, ...input, code: input.code?.trim().toUpperCase() } });
      }

      case 'location-assignments': {
        if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can assign work locations.');
        const input = z.object({
          employeeId: z.string().min(1).max(64),
          locationId: z.string().min(1).max(64),
          assignmentType: z.enum(['PRIMARY', 'SECONDARY', 'TEMPORARY']).default('PRIMARY'),
          effectiveFrom: z.coerce.date().optional(),
          effectiveTo: z.coerce.date().optional(),
          checkInAllowed: z.coerce.boolean().default(true),
          checkOutAllowed: z.coerce.boolean().default(true),
          allowedDays: z.array(z.coerce.number().int().min(0).max(6)).optional(),
          allowedStartTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
          allowedEndTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
          checkoutRule: z.enum(['SAME_LOCATION', 'ANY_ASSIGNED', 'EXCEPTION_ONLY']).default('SAME_LOCATION'),
          notes: z.string().max(500).optional(),
        }).parse(body);
        await ensureEmployee(ctx.tenantId, input.employeeId);
        const location = await prisma.hrWorkLocation.findFirst({ where: { tenantId: ctx.tenantId, id: input.locationId } });
        if (!location) throw NotFound('Work location');
        const assigner = await myEmployee(ctx);
        return prisma.hrEmployeeLocationAssignment.create({
          data: { tenantId: ctx.tenantId, ...input, allowedDays: input.allowedDays ?? [], status: 'ACTIVE', assignedById: assigner?.id ?? null },
          include: { location: true },
        });
      }
    }
  },
);

async function ensureEmployee(tenantId: string, employeeId: string) {
  const employee = await prisma.employeeProfile.findFirst({ where: { tenantId, id: employeeId, deletedAt: null } });
  if (!employee) throw NotFound('Employee');
}

function title(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
