import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';

const params = z.object({ id: z.string().cuid() });

const patchBody = z
  .object({
    outcome: z.string().max(500).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    durationSecs: z.number().int().min(0).nullable().optional(),
    occurredAt: z.coerce.date().optional(),
  })
  .strict();

export const PATCH = route(
  { module: 'leads', productModule: 'SALES', action: 'EDIT', params, body: patchBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    // An activity logged with the wrong outcome was previously permanent.
    const activity = await prisma.activity.findFirst({ where: { tenantId: ctx.tenantId, id: params.id } });
    if (!activity) throw NotFound('Activity');
    const scope = scopeFor(ctx, 'leads', 'EDIT');
    if (activity.ownerId !== ctx.actor.id && SCOPE_RANK[scope] < SCOPE_RANK.TEAM) throw NotFound('Activity');

    return prisma.activity.update({
      where: { tenantId: ctx.tenantId, id: params.id },
      data: { ...body, updatedById: ctx.actor.id },
      include: { type: { select: { name: true, key: true } } },
    });
  },
);

export const DELETE = route(
  { module: 'leads', productModule: 'SALES', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    const activity = await prisma.activity.findFirst({ where: { tenantId: ctx.tenantId, id: params.id } });
    if (!activity) throw NotFound('Activity');
    const scope = scopeFor(ctx, 'leads', 'DELETE');
    if (activity.ownerId !== ctx.actor.id && SCOPE_RANK[scope] < SCOPE_RANK.TEAM) throw NotFound('Activity');

    await prisma.activity.update({
      where: { tenantId: ctx.tenantId, id: params.id },
      data: { deletedAt: new Date(), updatedById: ctx.actor.id },
    });
    return { deleted: true };
  },
);
