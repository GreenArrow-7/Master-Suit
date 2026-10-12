import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { decayRule, DECAY_TRIGGER } from '@/services/leads/scoring';

/**
 * The workspace's score decay (Lead Eagle audit row M4-11): a lead loses
 * `decayAmount` points for every `decayDays` without activity, applied by the
 * nightly maintenance job. One rule per workspace (`ScoringRule`, trigger
 * DECAY), off until an administrator sets it on Administration → Sources,
 * where each source's starting points are set too.
 */
export const GET = route({ module: 'settings', productModule: LEAD_MODULES, action: 'VIEW' }, async ({ ctx }) => ({
  decay: await decayRule(prisma, ctx.tenantId),
}));

const body = z
  .object({
    decayDays: z.number().int().min(1).max(365),
    decayAmount: z.number().int().min(1).max(100),
    isActive: z.boolean(),
  })
  .strict();

export const PUT = route(
  {
    module: 'settings',
    productModule: LEAD_MODULES,
    action: 'MANAGE_CONFIGURATION',
    body,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, body }) => {
    const existing = await prisma.scoringRule.findFirst({
      where: { tenantId: ctx.tenantId, triggerType: DECAY_TRIGGER },
      select: { id: true },
    });
    const data = { ...body, updatedById: ctx.actor.id };
    const saved = existing
      ? await prisma.scoringRule.update({ where: { tenantId: ctx.tenantId, id: existing.id }, data })
      : await prisma.scoringRule.create({
          data: {
            ...data,
            tenantId: ctx.tenantId,
            name: 'Score decay',
            triggerType: DECAY_TRIGGER,
            createdById: ctx.actor.id,
          },
        });
    return { id: saved.id, decay: await decayRule(prisma, ctx.tenantId) };
  },
);
