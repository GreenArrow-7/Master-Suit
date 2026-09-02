import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { withPlatformTx } from '@/lib/db';
import { AppError, NotFound } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import {
  cancelModuleForTenant,
  createProductSubscription,
  syncModuleEntitlements,
  updateProductSubscription,
} from '@/services/platform/subscriptions';

/**
 * One product within a company's account.
 *
 * The resource that was missing. Everything the console could do previously was
 * account-wide — change the plan, change the state, cancel — so "ABC is dropping
 * Sales but keeping People" had no expression at all, and the nearest available
 * action cancelled both.
 *
 * PATCH re-terms a single product (plan, state, dates, billing identifiers);
 * DELETE cancels a single product. Neither touches the company's other
 * products, its tenant, its identities or its memberships.
 */
const MODULES = ['HRMS', 'SALES'] as const;

const patchSchema = z
  .object({
    planCode: z.string().min(1).max(64).nullable().optional(),
    state: z.enum(['TRIAL', 'ACTIVE', 'GRACE', 'SUSPENDED', 'CANCELED']).optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    trialEndsAt: z.coerce.date().nullable().optional(),
    graceEndsAt: z.coerce.date().nullable().optional(),
    currentPeriodEnd: z.coerce.date().nullable().optional(),
    externalCustomerId: z.string().max(255).nullable().optional(),
    externalContractId: z.string().max(255).nullable().optional(),
    /** Free-form billing annotations — external invoice ids, migration notes. */
    metadata: z.record(z.string(), z.unknown()).optional(),
    limits: z.record(z.string(), z.unknown()).optional(),
    /**
     * Sell this product if the company does not already hold it.
     *
     * Off by default: a PATCH naming a module the customer never bought is far
     * more likely to be a typo than an unstated purchase, and silently creating
     * a subscription is not something to infer.
     */
    create: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one change is required.');

function parseModule(value: string) {
  const found = MODULES.find((candidate) => candidate === value.toUpperCase());
  if (!found) throw NotFound('Module');
  return found;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ subscriptionId: string; module: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const { subscriptionId, module } = await params;
    const productModule = parseModule(module);
    const body = patchSchema.parse(await req.json());

    const { tenantId, products } = await withPlatformTx(async (tx) => {
      const container = await tx.tenantSubscription.findFirst({ where: { id: subscriptionId } });
      if (!container) throw NotFound('Subscription');

      const existing = await tx.subscriptionModule.findMany({
        where: { subscriptionId: container.id, module: productModule },
      });

      if (existing.length === 0) {
        if (!body.create) throw NotFound('Product subscription');
        await createProductSubscription(container.tenantId, productModule, body, tx);
      } else {
        // Several rows may provide one module; re-terming the product applies to
        // each of them rather than picking one arbitrarily.
        for (const row of existing) {
          await updateProductSubscription(row.id, body, tx);
        }
      }

      const after = await syncModuleEntitlements(container.tenantId, tx);

      await tx.platformAuditEvent.create({
        data: {
          tenantId: container.tenantId,
          actorUserId: ctx.platformUserId,
          event: 'PRODUCT_SUBSCRIPTION_UPDATED',
          objectType: 'subscription_module',
          objectId: container.id,
          requestId,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { module: productModule, changes: { ...body, startsAt: body.startsAt?.toISOString() } },
        },
      });

      return {
        tenantId: container.tenantId,
        products: Array.from(after.values()).map((entry) => ({
          module: entry.module,
          usable: entry.usable,
          state: entry.state,
          endsAt: entry.endsAt,
          planCode: entry.planCode,
        })),
      };
    });

    // After the commit: a rollback must not leave the cache cleared against
    // state that never landed.
    await invalidateEntitlements(tenantId);

    return NextResponse.json({ module: productModule, modules: products }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    return problem(error, requestId);
  }
}

/**
 * Cancels one product. The company keeps everything else it bought.
 *
 * This is the operation the acceptance criteria turn on: after it, HR still
 * answers, the administrator still signs in with the same credential, the
 * tenant still exists and its data is untouched — only Sales stops.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ subscriptionId: string; module: string }> },
) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const { subscriptionId, module } = await params;
    const productModule = parseModule(module);
    const now = new Date();

    const { tenantId, canceled, modules } = await withPlatformTx(async (tx) => {
      const container = await tx.tenantSubscription.findFirst({ where: { id: subscriptionId } });
      if (!container) throw NotFound('Subscription');

      const count = await cancelModuleForTenant(container.tenantId, productModule, tx, now);
      const after = await syncModuleEntitlements(container.tenantId, tx, now);

      await tx.platformAuditEvent.create({
        data: {
          tenantId: container.tenantId,
          actorUserId: ctx.platformUserId,
          event: 'PRODUCT_SUBSCRIPTION_CANCELED',
          objectType: 'subscription_module',
          objectId: container.id,
          requestId,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { module: productModule, canceledRows: count },
        },
      });

      return {
        tenantId: container.tenantId,
        canceled: count,
        modules: Array.from(after.values()).map((entry) => ({
          module: entry.module,
          usable: entry.usable,
          state: entry.state,
        })),
      };
    });

    await invalidateEntitlements(tenantId);

    return NextResponse.json(
      { canceled: true, module: productModule, rows: canceled, modules },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (error) {
    return problem(error, requestId);
  }
}

function problem(error: unknown, requestId: string) {
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
