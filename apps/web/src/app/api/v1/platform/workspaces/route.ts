import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { Conflict } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { hashPassword } from '@/lib/auth/password';
import { PRODUCT_MODULE_KEYS } from '@/lib/modules/catalogue';
import { bareRoute } from '@/lib/api/handler';
import { createWorkspace } from '@/services/platform/createWorkspace';

const createSchema = z.object({
  workspaceName: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
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
  enabledModules: z.array(z.enum(PRODUCT_MODULE_KEYS)).min(1),
  maxEmployees: z.number().int().positive().max(100000),
  maxUsers: z.number().int().positive().max(100000),
  maxStorageMb: z.number().int().positive().max(10000000),
  trialStartDate: z.coerce.date().nullable().optional(),
  trialEndDate: z.coerce.date().nullable().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).default('ACTIVE'),
});

export const GET = bareRoute('/api/v1/platform/workspaces', async (req, requestId) => {
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
  return NextResponse.json({ workspaces });
});

export const POST = bareRoute('/api/v1/platform/workspaces', async (req, requestId) => {
  const ctx = await requirePlatformOwner(req, requestId);
  const body = createSchema.parse(await req.json());
  const plan = await prisma.subscriptionPlan.findFirst({ where: { code: body.planCode, active: true } });
  if (!plan) throw Conflict('The selected subscription plan is unavailable.');

  const adminEmail = body.primaryAdminEmail.trim().toLowerCase();

  const workspace = await createWorkspace(body, plan, await hashPassword(body.primaryAdminPassword), ctx);

  return NextResponse.json(
    {
      workspace: workspace.created,
      // The caller told us a password; say plainly whether it was used, so the
      // owner does not communicate one that will not work.
      primaryAdmin: {
        email: adminEmail,
        credential: workspace.reusedExistingIdentity ? 'EXISTING' : 'CREATED',
        note: workspace.reusedExistingIdentity
          ? 'That email already had an account on this platform. It keeps its existing password — the one supplied here was not applied.'
          : 'The supplied password is now active for this administrator.',
      },
    },
    { status: 201 },
  );
});
