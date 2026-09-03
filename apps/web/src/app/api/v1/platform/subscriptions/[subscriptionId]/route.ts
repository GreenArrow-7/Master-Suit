import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma, withPlatformTx } from '@/lib/db';
import { AppError, NotFound } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import {
  cancelProductSubscription,
  setTenantModules,
  syncModuleEntitlements,
  updateProductSubscription,
} from '@/services/platform/subscriptions';

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

      /**
       * The commercial decision is written to the product rows; entitlements are
       * then derived from them.
       *
       * This route used to compute entitlements itself, and it is the reason
       * cancelling one product cancelled every product: both branches below
       * wrote `where: { tenantId }` with no module filter. Everything now goes
       * through services/platform/subscriptions.ts, which scopes each write to
       * the product it belongs to and recomputes the projection afterwards.
       */
      if (plan) {
        const planModules = plan.planModules.filter((m: any) => m.enabled).map((m: any) => m.module);
        await tx.tenant.update({ where: { id: current.tenantId }, data: { planCode: plan.code } });
        // A plan swap re-states which products the company holds: the new plan's
        // modules are sold (or re-termed), and anything it drops is cancelled.
        await setTenantModules(
          current.tenantId,
          planModules,
          {
            planCode: plan.code,
            state: body.state ?? updated.state,
            endsAt: null,
            ...(body.trialEndsAt === undefined ? {} : { trialEndsAt: body.trialEndsAt }),
            ...(body.currentPeriodEnd === undefined ? {} : { currentPeriodEnd: body.currentPeriodEnd }),
          },
          tx,
        );
      } else if (body.state) {
        // No plan change: apply the new state to every product this container
        // holds, one row at a time so each keeps its own dates.
        const products = await tx.subscriptionModule.findMany({
          where: { subscriptionId: current.id },
          select: { id: true },
        });
        for (const product of products) {
          await updateProductSubscription(
            product.id,
            {
              state: body.state,
              endsAt: body.state === 'CANCELED' ? new Date() : null,
              ...(body.trialEndsAt === undefined ? {} : { trialEndsAt: body.trialEndsAt }),
              ...(body.currentPeriodEnd === undefined ? {} : { currentPeriodEnd: body.currentPeriodEnd }),
            },
            tx,
          );
        }
        await syncModuleEntitlements(current.tenantId, tx);
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
      /**
       * Cancels the whole account — every product the company holds.
       *
       * Deliberately still a thing: "this customer is leaving" is a real
       * operation. What changed is that it is now the *only* way to cancel
       * everything. Removing a single product is
       * DELETE .../subscriptions/{id}/modules/{module}, which leaves the rest
       * running; before, both did the same thing and only one of them meant to.
       */
      const products = await tx.subscriptionModule.findMany({
        where: { subscriptionId: current.id, state: { not: 'CANCELED' } },
        select: { id: true },
      });
      for (const product of products) {
        await cancelProductSubscription(product.id, tx, now);
      }
      await syncModuleEntitlements(current.tenantId, tx, now);
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
