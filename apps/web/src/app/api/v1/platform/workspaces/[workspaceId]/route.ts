import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma, withTx } from '@/lib/db';
import { AppError, NotFound } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';

const updateSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
  planCode: z.string().min(1).max(64).optional(),
  subscriptionState: z.enum(['TRIAL', 'ACTIVE', 'GRACE', 'SUSPENDED', 'CANCELED']).optional(),
  maxUsers: z.number().int().positive().nullable().optional(),
  maxEmployees: z.number().int().positive().nullable().optional(),
  maxStorageMb: z.number().int().positive().nullable().optional(),
  enabledModules: z.array(z.enum(['HRMS', 'SALES'])).min(1).optional(),
  trialStartedAt: z.coerce.date().nullable().optional(),
  trialEndsAt: z.coerce.date().nullable().optional(),
  revokeSessions: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one change is required.');

export async function PATCH(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const { workspaceId } = await params;
    const body = updateSchema.parse(await req.json());
    const current = await prisma.tenant.findFirst({
      where: { id: workspaceId, deletedAt: null },
      include: { subscription: true },
    });
    if (!current) throw NotFound('Workspace');
    const plan = body.planCode
      ? await prisma.subscriptionPlan.findFirst({ where: { code: body.planCode, active: true } })
      : null;
    if (body.planCode && !plan) throw NotFound('Subscription plan');

    const workspace = await withTx(async (tx) => {
      const updated = await tx.tenant.update({
        where: { id: current.id },
        data: {
          status: body.status,
          planCode: plan?.code,
          maxUsers: body.maxUsers,
          maxEmployees: body.maxEmployees,
          maxStorageMb: body.maxStorageMb,
          trialStartedAt: body.trialStartedAt,
          trialEndsAt: body.trialEndsAt,
          archivedAt: body.status === 'ARCHIVED' ? new Date() : body.status === 'ACTIVE' ? null : undefined,
        },
      });
      if (current.subscription && (plan || body.subscriptionState)) {
        await tx.tenantSubscription.update({
          where: { tenantId: current.id },
          data: { planId: plan?.id, state: body.subscriptionState },
        });
      }
      if (body.subscriptionState) {
        await tx.moduleEntitlement.updateMany({
          where: { tenantId: current.id },
          data: { state: body.subscriptionState },
        });
      }
      if (body.enabledModules) {
        for (const module of ['HRMS', 'SALES'] as const) {
          const enabled = body.enabledModules.includes(module);
          await tx.moduleEntitlement.upsert({
            where: { tenantId_module: { tenantId: current.id, module } },
            update: { state: enabled ? (body.subscriptionState ?? current.subscription?.state ?? 'ACTIVE') : 'CANCELED', endsAt: enabled ? body.trialEndsAt : new Date() },
            create: { tenantId: current.id, module, state: enabled ? (body.subscriptionState ?? current.subscription?.state ?? 'ACTIVE') : 'CANCELED', endsAt: enabled ? body.trialEndsAt : new Date() },
          });
          if (current.subscription) {
            await tx.subscriptionModule.upsert({
              where: { subscriptionId_module: { subscriptionId: current.subscription.id, module } },
              update: { state: enabled ? (body.subscriptionState ?? current.subscription.state) : 'CANCELED' },
              create: { subscriptionId: current.subscription.id, module, state: enabled ? (body.subscriptionState ?? current.subscription.state) : 'CANCELED' },
            });
          }
        }
      }
      if (body.revokeSessions) {
        await tx.platformSession.updateMany({ where: { activeTenantId: current.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'PLATFORM_OWNER_REVOKED' } });
        await tx.session.updateMany({ where: { tenantId: current.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'PLATFORM_OWNER_REVOKED' } });
      }
      await tx.platformAuditEvent.create({
        data: {
          tenantId: current.id,
          actorUserId: ctx.platformUserId,
          event: 'WORKSPACE_UPDATED',
          objectType: 'workspace',
          objectId: current.id,
          requestId,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { before: { status: current.status, planCode: current.planCode }, changes: body },
        },
      });
      return updated;
    });

    return NextResponse.json({ workspace }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toProblem(requestId), { status: error.status, headers: { 'x-request-id': requestId } });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ status: 422, title: 'Validation failed', requestId, errors: error.flatten() }, { status: 422 });
    }
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}
