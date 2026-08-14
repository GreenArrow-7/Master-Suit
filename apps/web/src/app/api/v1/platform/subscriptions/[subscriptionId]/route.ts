import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma, withPlatformTx } from '@/lib/db';
import { AppError, NotFound } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { invalidateEntitlements } from '@/lib/security/entitlements';

const updateSchema = z
  .object({
    planCode: z.string().min(1).max(64).optional(),
    state: z.enum(['TRIAL', 'ACTIVE', 'GRACE', 'SUSPENDED', 'CANCELED']).optional(),
    trialEndsAt: z.coerce.date().nullable().optional(),
    currentPeriodEnd: z.coerce.date().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one change is required.');

/**
 * Edits one subscription: plan, state and the two dates the owner actually
 * moves. Module entitlements follow the change — a plan swap re-derives them
 * from the new plan's modules, and a state change propagates to every module —
 * because a subscription that says Business while the entitlements still say
 * HRMS-only is exactly the drift the control plane exists to prevent.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ subscriptionId: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const { subscriptionId } = await params;
    const body = updateSchema.parse(await req.json());

    const plan = body.planCode
      ? await prisma.subscriptionPlan.findFirst({
          where: { code: body.planCode, active: true },
          include: { planModules: true },
        })
      : null;
    if (body.planCode && !plan) throw NotFound('Subscription plan');

    // The lookup runs inside the platform transaction: TenantSubscription is
    // RLS-protected, and only app.platform_admin lets the console see every row.
    const subscription = await withPlatformTx(async (tx) => {
      const current = await tx.tenantSubscription.findFirst({
        where: { id: subscriptionId },
        include: { plan: true },
      });
      if (!current) throw NotFound('Subscription');
      const updated = await tx.tenantSubscription.update({
        where: { id: current.id },
        data: {
          planId: plan?.id,
          state: body.state,
          trialEndsAt: body.trialEndsAt,
          currentPeriodEnd: body.currentPeriodEnd,
          canceledAt: body.state === 'CANCELED' ? new Date() : body.state ? null : undefined,
        },
        include: { plan: true, modules: true, tenant: true },
      });

      if (plan) {
        const planModules = plan.planModules.filter((m: any) => m.enabled).map((m: any) => m.module);
        await tx.tenant.update({ where: { id: current.tenantId }, data: { planCode: plan.code } });
        // Modules not in the new plan end now; ones it adds start now.
        await tx.moduleEntitlement.deleteMany({
          where: { tenantId: current.tenantId, module: { notIn: planModules } },
        });
        for (const module of planModules) {
          await tx.moduleEntitlement.upsert({
            where: { tenantId_module: { tenantId: current.tenantId, module } },
            update: { state: body.state ?? updated.state, endsAt: null },
            create: { tenantId: current.tenantId, module, state: body.state ?? updated.state },
          });
        }
        await tx.subscriptionModule.deleteMany({
          where: { subscriptionId: current.id, module: { notIn: planModules } },
        });
        for (const module of planModules) {
          await tx.subscriptionModule.upsert({
            where: { subscriptionId_module: { subscriptionId: current.id, module } },
            update: { state: body.state ?? updated.state },
            create: { subscriptionId: current.id, module, state: body.state ?? updated.state },
          });
        }
      } else if (body.state) {
        await tx.moduleEntitlement.updateMany({
          where: { tenantId: current.tenantId },
          data: { state: body.state, ...(body.state === 'CANCELED' ? { endsAt: new Date() } : { endsAt: null }) },
        });
        await tx.subscriptionModule.updateMany({
          where: { subscriptionId: current.id },
          data: { state: body.state },
        });
      }

      await tx.platformAuditEvent.create({
        data: {
          tenantId: current.tenantId,
          actorUserId: ctx.platformUserId,
          event: 'SUBSCRIPTION_UPDATED',
          objectType: 'subscription',
          objectId: current.id,
          requestId,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { before: { plan: current.plan.code, state: current.state }, changes: body },
        },
      });
      return updated;
    });
    await invalidateEntitlements(subscription.tenantId);

    return NextResponse.json({ subscription }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toProblem(requestId), {
        status: error.status,
        headers: { 'x-request-id': requestId },
      });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { status: 422, title: 'Validation failed', requestId, errors: error.flatten() },
        { status: 422 },
      );
    }
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}

/** Cancels the subscription. The row stays for billing history; access stops. */
export async function DELETE(req: Request, { params }: { params: Promise<{ subscriptionId: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const { subscriptionId } = await params;
    const now = new Date();
    const tenantId = await withPlatformTx(async (tx) => {
      const current = await tx.tenantSubscription.findFirst({ where: { id: subscriptionId } });
      if (!current) throw NotFound('Subscription');
      await tx.tenantSubscription.update({
        where: { id: current.id },
        data: { state: 'CANCELED', canceledAt: now },
      });
      await tx.moduleEntitlement.updateMany({
        where: { tenantId: current.tenantId },
        data: { state: 'CANCELED', endsAt: now },
      });
      await tx.subscriptionModule.updateMany({
        where: { subscriptionId: current.id },
        data: { state: 'CANCELED' },
      });
      await tx.platformAuditEvent.create({
        data: {
          tenantId: current.tenantId,
          actorUserId: ctx.platformUserId,
          event: 'SUBSCRIPTION_CANCELED',
          objectType: 'subscription',
          objectId: current.id,
          requestId,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: {},
        },
      });
      return current.tenantId;
    });
    await invalidateEntitlements(tenantId);

    return NextResponse.json({ canceled: true, id: subscriptionId }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toProblem(requestId), {
        status: error.status,
        headers: { 'x-request-id': requestId },
      });
    }
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}
