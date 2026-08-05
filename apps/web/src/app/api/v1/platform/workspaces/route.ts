import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma, withTx } from '@/lib/db';
import { AppError, Conflict } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { hashPassword } from '@/lib/auth/password';

const createSchema = z.object({
  workspaceName: z.string().min(2).max(120),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  legalName: z.string().min(2).max(180),
  displayName: z.string().min(2).max(120),
  planCode: z.string().min(1).max(64),
  industry: z.string().max(100).optional(),
  companySize: z.string().max(50).optional(),
  country: z.string().length(2).default('AE'),
  timezone: z.string().min(1).max(80).default('Asia/Dubai'),
  currency: z.string().length(3).default('AED'),
  companyEmail: z.string().email().optional(),
  companyPhone: z.string().max(40).optional(),
  companyAddress: z.string().max(500).optional(),
  logoUrl: z.string().url().optional().or(z.literal('')),
  primaryAdminName: z.string().min(2).max(160),
  primaryAdminEmail: z.string().email().max(254),
  primaryAdminPassword: z.string().min(16).max(200),
  enabledModules: z.array(z.enum(['HRMS', 'SALES'])).min(1),
  maxEmployees: z.number().int().positive().max(100000),
  maxUsers: z.number().int().positive().max(100000),
  maxStorageMb: z.number().int().positive().max(10000000),
  trialStartDate: z.coerce.date().nullable().optional(),
  trialEndDate: z.coerce.date().nullable().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).default('ACTIVE'),
});

export async function GET(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    await requirePlatformOwner(req, requestId);
    const workspaces = await prisma.tenant.findMany({
      where: { deletedAt: null },
      include: {
        subscription: { include: { plan: true } },
        moduleEntitlements: true,
        _count: { select: { memberships: true, employeeProfiles: true, users: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ workspaces }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    return problem(error, requestId);
  }
}

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const body = createSchema.parse(await req.json());
    const existing = await prisma.tenant.findUnique({ where: { slug: body.slug } });
    if (existing) throw Conflict('That workspace slug is already in use.');
    const plan = await prisma.subscriptionPlan.findFirst({ where: { code: body.planCode, active: true } });
    if (!plan) throw Conflict('The selected subscription plan is unavailable.');

    const trialStartedAt = body.trialStartDate ?? null;
    const trialEndsAt = body.trialEndDate ?? null;
    const state = trialEndsAt && trialEndsAt > new Date() ? 'TRIAL' as const : 'ACTIVE' as const;
    const adminEmail = body.primaryAdminEmail.trim().toLowerCase();
    const passwordHash = await hashPassword(body.primaryAdminPassword);

    const workspace = await withTx(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          workspaceName: body.workspaceName,
          slug: body.slug,
          legalName: body.legalName,
          displayName: body.displayName,
          industry: body.industry,
          companySize: body.companySize,
          country: body.country.toUpperCase(),
          timezone: body.timezone,
          currency: body.currency.toUpperCase(),
          companyEmail: body.companyEmail?.toLowerCase(),
          companyPhone: body.companyPhone,
          address: body.companyAddress ? { formatted: body.companyAddress } : {},
          logoUrl: body.logoUrl || null,
          status: body.status,
          planCode: plan.code,
          maxUsers: body.maxUsers,
          maxEmployees: body.maxEmployees,
          maxStorageMb: body.maxStorageMb,
          trialStartedAt,
          trialEndsAt,
          settings: { create: { defaultTimezone: body.timezone, defaultCurrency: body.currency.toUpperCase() } },
          subscription: {
            create: {
              planId: plan.id,
              state,
              trialEndsAt,
              modules: { create: body.enabledModules.map((module) => ({ module, state })) },
            },
          },
          moduleEntitlements: {
            create: body.enabledModules.map((module) => ({ module, state, endsAt: trialEndsAt })),
          },
          workspaceUsage: {
            create: [
              { metric: 'users', used: 1, limit: body.maxUsers },
              { metric: 'employees', used: 1, limit: body.maxEmployees },
              { metric: 'storage_mb', used: 0, limit: body.maxStorageMb },
            ],
          },
          hrLeaveTypes: body.enabledModules.includes('HRMS') ? {
            create: [
              { code: 'ANNUAL', name: 'Annual Leave', annualAllowance: 30, paid: true },
              { code: 'SICK', name: 'Sick Leave', annualAllowance: 15, paid: true, requiresDocument: true },
            ],
          } : undefined,
        },
        include: { subscription: { include: { plan: true } }, moduleEntitlements: true },
      });

      const permissionPairs = [
        ...['hrms', 'employees', 'departments', 'attendance', 'shifts', 'leave', 'holidays', 'hr_documents', 'work_locations', 'hr_reports'],
        ...['leads', 'opportunities', 'accounts', 'contacts', 'activities', 'tasks', 'calls', 'campaigns', 'reports'],
        ...['users', 'roles', 'settings', 'auditlogs', 'integrations'],
      ].flatMap((module) => ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'MANAGE_USERS', 'MANAGE_CONFIGURATION'].map((action) => ({ module, action })));
      // 144 sequential upserts — one network round trip each — inside a 5 s
      // interactive transaction. It measured a hair over the limit under any
      // concurrent load, so workspace provisioning failed intermittently with an
      // expired-transaction error and a bare 500. The upsert's `update` was empty,
      // so this is exactly equivalent in one round trip.
      await tx.permission.createMany({ data: permissionPairs as never, skipDuplicates: true });
      const permissions = await tx.permission.findMany({
        where: { module: { in: [...new Set(permissionPairs.map((item) => item.module))] } },
      });
      const adminRole = await tx.role.create({
        data: {
          tenantId: created.id,
          key: 'company_admin',
          name: 'Company Administrator',
          description: 'Full administration inside this workspace only.',
          isSystem: true,
          rank: 10,
          defaultScope: 'ORGANIZATION',
        },
      });
      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({
          tenantId: created.id,
          roleId: adminRole.id,
          permissionId: permission.id,
          granted: true,
          scope: 'ORGANIZATION',
        })),
      });
      const salesUser = await tx.user.create({
        data: {
          tenantId: created.id,
          email: adminEmail,
          emailVerifiedAt: new Date(),
          passwordHash,
          fullName: body.primaryAdminName,
          status: 'ACTIVE',
          roleId: adminRole.id,
          employeeCode: 'ADMIN-001',
          jobTitle: 'Company Administrator',
          timezone: body.timezone,
        },
      });
      const platformUser = await tx.platformUser.upsert({
        where: { normalizedEmail: adminEmail },
        update: { fullName: body.primaryAdminName, status: 'ACTIVE' },
        create: {
          email: adminEmail,
          normalizedEmail: adminEmail,
          fullName: body.primaryAdminName,
          passwordHash,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      });
      const membership = await tx.workspaceMembership.create({
        data: {
          tenantId: created.id,
          platformUserId: platformUser.id,
          salesUserId: salesUser.id,
          status: 'ACTIVE',
          isPrimaryAdmin: true,
          roleSnapshot: 'company_admin',
          joinedAt: new Date(),
        },
      });
      await tx.membershipRole.create({ data: { tenantId: created.id, membershipId: membership.id, roleId: adminRole.id } });
      await tx.employeeProfile.create({
        data: {
          tenantId: created.id,
          membershipId: membership.id,
          employeeNumber: 'ADMIN-001',
          designation: 'Company Administrator',
          employmentStatus: 'ACTIVE',
          joinedOn: new Date(),
        },
      });
      if (body.enabledModules.includes('SALES')) {
        await tx.leadStage.createMany({
          data: [
            { tenantId: created.id, key: 'new', name: 'New', position: 1, isDefault: true },
            { tenantId: created.id, key: 'qualified', name: 'Qualified', position: 2 },
            { tenantId: created.id, key: 'won', name: 'Won', position: 3, category: 'CONVERSION' },
            { tenantId: created.id, key: 'lost', name: 'Lost', position: 4, category: 'TERMINAL_NEGATIVE' },
          ],
        });
      }
      await tx.platformAuditEvent.create({
        data: {
          tenantId: created.id,
          actorUserId: ctx.platformUserId,
          event: 'WORKSPACE_CREATED',
          objectType: 'workspace',
          objectId: created.id,
          requestId,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { slug: created.slug, planCode: plan.code, modules: body.enabledModules, primaryAdmin: adminEmail },
        },
      });
      return created;
    });

    return NextResponse.json({ workspace }, { status: 201, headers: { 'x-request-id': requestId } });
  } catch (error) {
    return problem(error, requestId);
  }
}

function problem(error: unknown, requestId: string) {
  if (error instanceof AppError) {
    return NextResponse.json(error.toProblem(requestId), { status: error.status, headers: { 'x-request-id': requestId } });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ status: 422, title: 'Validation failed', requestId, errors: error.flatten() }, { status: 422 });
  }
  // An unexpected failure here was previously answered with a bare 500 and never
  // written anywhere, so provisioning failures were undiagnosable from the logs.
  logger.error({ err: error, requestId }, 'workspace provisioning failed');
  return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
}
