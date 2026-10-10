import { NextResponse } from 'next/server';
import { invalidateEntitlements, LEAD_MODULES } from '@/lib/security/entitlements';
import { provisionLeadWork } from '@/services/platform/provisioning';
import { z } from 'zod';
import { prisma, withPlatformTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { PRODUCT_MODULE_KEYS } from '@/lib/modules/catalogue';
import { platformAudit } from '@/lib/security/audit';
import { bareRoute } from '@/lib/api/handler';

const updateSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
    planCode: z.string().min(1).max(64).optional(),
    subscriptionState: z.enum(['TRIAL', 'ACTIVE', 'GRACE', 'SUSPENDED', 'CANCELED']).optional(),
    maxUsers: z.number().int().positive().nullable().optional(),
    maxEmployees: z.number().int().positive().nullable().optional(),
    maxStorageMb: z.number().int().positive().nullable().optional(),
    enabledModules: z.array(z.enum(PRODUCT_MODULE_KEYS)).min(1).optional(),
    trialStartedAt: z.coerce.date().nullable().optional(),
    trialEndsAt: z.coerce.date().nullable().optional(),
    revokeSessions: z.boolean().optional(),

    // Workspace profile. Fixed at provisioning and unchangeable thereafter until
    // now — a customer who rebranded, moved office or mistyped their legal name at
    // sign-up had no way to correct any of it.
    workspaceName: z.string().min(2).max(120).optional(),
    legalName: z.string().min(2).max(180).optional(),
    displayName: z.string().min(2).max(120).optional(),
    industry: z.string().max(100).nullable().optional(),
    country: z.string().length(2).optional(),
    timezone: z.string().min(1).max(80).optional(),
    currency: z.string().length(3).optional(),
    companyEmail: z.string().email().nullable().optional(),
    companyPhone: z.string().max(40).nullable().optional(),
    companyAddress: z.string().max(500).nullable().optional(),
    logoUrl: z.string().url().nullable().optional().or(z.literal('')),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one change is required.');

export const PATCH = bareRoute(
  '/api/v1/platform/workspaces/[workspaceId]',
  async (req, requestId, { params }: { params: Promise<{ workspaceId: string }> }) => {
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

    // A module's end follows the trial only while the workspace is on trial, and
    // only when this save changes the trial end. The edit form sends trialEndsAt
    // on every save, prefilled with the stored date: writing it into every
    // module cut a paying customer off — their old trial end is in the past —
    // the moment anyone fixed, say, the company phone. Compared as calendar
    // dates because the form prefills the UTC date of the stored instant.
    const day = (date: Date | null | undefined) => date?.toISOString().slice(0, 10) ?? null;
    const state = body.subscriptionState ?? current.subscription?.state ?? 'ACTIVE';
    const onTrial = state === 'TRIAL';
    const trialEndChanged = body.trialEndsAt !== undefined && day(body.trialEndsAt) !== day(current.trialEndsAt);
    const moduleEnd = onTrial && trialEndChanged ? body.trialEndsAt : undefined;
    const newModuleEnd = onTrial ? (body.trialEndsAt ?? current.trialEndsAt) : null;

    const workspace = await withPlatformTx(async (tx) => {
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

          workspaceName: body.workspaceName,
          legalName: body.legalName,
          displayName: body.displayName,
          industry: body.industry,
          country: body.country?.toUpperCase(),
          timezone: body.timezone,
          currency: body.currency?.toUpperCase(),
          companyEmail: body.companyEmail?.toLowerCase(),
          companyPhone: body.companyPhone,
          ...(body.companyAddress === undefined
            ? {}
            : { address: body.companyAddress ? { formatted: body.companyAddress } : {} }),
          ...(body.logoUrl === undefined ? {} : { logoUrl: body.logoUrl || null }),
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
        for (const productModule of PRODUCT_MODULE_KEYS) {
          const enabled = body.enabledModules.includes(productModule);
          await tx.moduleEntitlement.upsert({
            where: { tenantId_module: { tenantId: current.id, module: productModule } },
            update: {
              state: enabled ? state : 'CANCELED',
              endsAt: enabled ? moduleEnd : new Date(),
            },
            create: {
              tenantId: current.id,
              module: productModule,
              state: enabled ? state : 'CANCELED',
              endsAt: enabled ? newModuleEnd : new Date(),
            },
          });
          if (current.subscription) {
            await tx.subscriptionModule.upsert({
              where: { subscriptionId_module: { subscriptionId: current.subscription.id, module: productModule } },
              update: { state: enabled ? (body.subscriptionState ?? current.subscription.state) : 'CANCELED' },
              create: {
                subscriptionId: current.subscription.id,
                module: productModule,
                state: enabled ? (body.subscriptionState ?? current.subscription.state) : 'CANCELED',
              },
            });
          }
        }
        // Switching on a module that works leads in a workspace that never had one
        // (an HR-only workspace adding Lead Eagle) needs the same starting lists.
        if (body.enabledModules.some((module) => (LEAD_MODULES as readonly string[]).includes(module))) {
          await provisionLeadWork(tx, current.id);
        }
      }
      if (body.revokeSessions) {
        await tx.platformSession.updateMany({
          where: { activeTenantId: current.id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'PLATFORM_OWNER_REVOKED' },
        });
      }
      await platformAudit(
        ctx,
        {
          tenantId: current.id,
          event: 'WORKSPACE_UPDATED',
          objectType: 'workspace',
          objectId: current.id,
          metadata: { before: { status: current.status, planCode: current.planCode }, changes: body },
        },
        tx,
      );
      return updated;
    });

    // Entitlements are cached for a minute on the request path. Clearing the
    // keys after the commit means revoking a module takes effect on the next
    // request rather than whenever the TTL happens to expire.
    await invalidateEntitlements(workspace.id);

    return NextResponse.json({ workspace });
  },
);

/**
 * Deletes a workspace — as a soft delete, deliberately.
 *
 * A hard DELETE would cascade through every employee, lead, call recording and
 * audit row the customer ever produced, with no way back from a mis-click. The
 * row keeps existing with `deletedAt` set: every list in the product already
 * filters on it, sessions are revoked so nobody stays signed in, and the
 * subscription is cancelled so billing stops. Restoring is a support operation
 * (clear deletedAt) rather than a data-recovery incident.
 */
export const DELETE = bareRoute(
  '/api/v1/platform/workspaces/[workspaceId]',
  async (req, requestId, { params }: { params: Promise<{ workspaceId: string }> }) => {
    const ctx = await requirePlatformOwner(req, requestId);
    const { workspaceId } = await params;
    const current = await prisma.tenant.findFirst({ where: { id: workspaceId, deletedAt: null } });
    if (!current) throw NotFound('Workspace');

    const now = new Date();
    await withPlatformTx(async (tx) => {
      await tx.tenant.update({
        where: { id: current.id },
        data: { deletedAt: now, archivedAt: now, status: 'ARCHIVED' },
      });
      await tx.tenantSubscription.updateMany({
        where: { tenantId: current.id },
        data: { state: 'CANCELED', canceledAt: now },
      });
      await tx.moduleEntitlement.updateMany({
        where: { tenantId: current.id },
        data: { state: 'CANCELED', endsAt: now },
      });
      await tx.platformSession.updateMany({
        where: { activeTenantId: current.id, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'WORKSPACE_DELETED' },
      });
      await platformAudit(
        ctx,
        {
          tenantId: current.id,
          event: 'WORKSPACE_DELETED',
          objectType: 'workspace',
          objectId: current.id,
          metadata: { slug: current.slug, displayName: current.displayName },
        },
        tx,
      );
    });
    await invalidateEntitlements(current.id);

    return NextResponse.json({ deleted: true, id: current.id });
  },
);
