import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { AppError, NotFound } from '@/lib/errors';
import type { Ctx } from '@/lib/security/rbac';
import { seesWholeWorkspace } from '@/lib/security/record-scope';
import { assertRecordVisible } from '@/lib/security/visibility';

const params = z.object({ id: z.string().cuid() });

/**
 * Yours when you logged it. At TEAM scope and wider, also one on a lead in your
 * scope — or, with no lead, one logged by someone in it: `seesWholeWorkspace`
 * alone let a team manager change every activity in the workspace by its id.
 * Not found either way, so a refusal does not confirm the activity exists.
 */
async function assertActivityInScope(ctx: Ctx, id: string, action: 'EDIT' | 'DELETE') {
  const activity = await prisma.activity.findFirst({ where: { tenantId: ctx.tenantId, id }, include: { lead: true } });
  if (!activity) throw NotFound('Activity');
  if (activity.ownerId === ctx.actor.id) return;
  if (!seesWholeWorkspace(ctx, 'leads', action)) throw NotFound('Activity');
  try {
    await assertRecordVisible(ctx, 'leads', activity.lead ?? activity, prisma, action);
  } catch (err) {
    if (err instanceof AppError && err.status === 403) throw NotFound('Activity');
    throw err;
  }
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

    await prisma.activity.update({
      where: { tenantId: ctx.tenantId, id: params.id },
      data: { deletedAt: new Date(), updatedById: ctx.actor.id },
    });
    return { deleted: true };
  },
);
