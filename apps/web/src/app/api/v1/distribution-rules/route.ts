import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { poolOf, RULE_FIELDS, ruleBody } from '@/services/distribution/rules';

export const GET = route({ module: 'allocation', productModule: LEAD_MODULES, action: 'VIEW' }, async ({ ctx }) => ({
  data: await prisma.distributionRule.findMany({
    where: { tenantId: ctx.tenantId, objectType: 'LEAD', deletedAt: null },
    orderBy: { position: 'asc' },
    select: RULE_FIELDS,
  }),
}));

export const POST = route(
  {
    module: 'allocation',
    productModule: LEAD_MODULES,
    action: 'APPROVE',
    body: ruleBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) =>
    prisma.distributionRule.create({
      data: {
        tenantId: ctx.tenantId,
        name: body.name,
        method: 'ROUND_ROBIN',
        isActive: body.isActive ?? true,
        position: body.position ?? 0,
        candidatePool: await poolOf(ctx, body),
        weights: body.weights ?? {},
        reassignAfterMins: body.reassignAfterMins ?? null,
        escalateAfterMins: body.escalateAfterMins ?? null,
        conditions: body.conditions ?? {},
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
      },
      select: RULE_FIELDS,
    }),
);
