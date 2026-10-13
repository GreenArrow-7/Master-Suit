import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { scopeFor, SCOPE_RANK, type Ctx } from '@/lib/security/rbac';
import { resolveOwnerIds } from '@/lib/security/visibility';
import { unscoreActivity } from '@/services/leads/scoring';

const params = z.object({ id: z.string().cuid() });

/**
 * Yours when you logged it. At TEAM scope and wider, also one logged by someone
 * in your scope or on a lead someone in it owns: the activities list reads them
 * by who logged them, a lead's timeline by the lead. An activity on an
 * unassigned lead logged outside your scope is ORGANIZATION's only. Not found
 * either way, so a refusal does not confirm the activity exists.
 */
async function assertActivityInScope(ctx: Ctx, id: string, action: 'EDIT' | 'DELETE') {
  const activity = await prisma.activity.findFirst({
    where: { tenantId: ctx.tenantId, id },
    select: { ownerId: true, lead: { select: { ownerId: true } } },
  });
  if (!activity) throw NotFound('Activity');
  if (activity.ownerId === ctx.actor.id) return;
  const scope = scopeFor(ctx, 'leads', action);
  if (scope === 'ORGANIZATION') return;
  const owners = SCOPE_RANK[scope] >= SCOPE_RANK.TEAM ? await resolveOwnerIds(ctx, scope) : [];
  if (!owners.some((owner) => owner === activity.ownerId || owner === activity.lead?.ownerId))
    throw NotFound('Activity');
}

const patchBody = z
  .object({
    outcome: z.string().max(500).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    durationSecs: z.number().int().min(0).nullable().optional(),
    occurredAt: z.coerce.date().optional(),
  })
  .strict();

export const PATCH = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params,
    body: patchBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    // An activity logged with the wrong outcome was previously permanent.
    await assertActivityInScope(ctx, params.id, 'EDIT');

    return prisma.activity.update({
      where: { tenantId: ctx.tenantId, id: params.id },
      data: { ...body, updatedById: ctx.actor.id },
      include: { type: { select: { name: true, key: true } } },
    });
  },
);

export const DELETE = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    await assertActivityInScope(ctx, params.id, 'DELETE');

    await withTx(ctx.tenantId, async (tx) => {
      const { count } = await tx.activity.updateMany({
        where: { tenantId: ctx.tenantId, id: params.id, deletedAt: null },
        data: { deletedAt: new Date(), updatedById: ctx.actor.id },
      });
      // Its points go with it (M4-11); a repeated delete finds it gone and takes nothing.
      if (count) await unscoreActivity(tx, ctx, params.id);
    });
    return { deleted: true };
  },
);
