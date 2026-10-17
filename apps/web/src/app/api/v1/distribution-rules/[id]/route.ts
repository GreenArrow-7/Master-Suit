import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { poolOf, RULE_FIELDS, ruleBody } from '@/services/distribution/rules';

const params = z.object({ id: z.string().cuid() });

const patchBody = ruleBody.partial();

async function findRule(tenantId: string, id: string) {
  const rule = await prisma.distributionRule.findFirst({
    where: { tenantId, id, deletedAt: null },
    select: { id: true },
  });
  if (!rule) throw NotFound('Rule');
}

export const PATCH = route(
  {
    module: 'allocation',
    productModule: LEAD_MODULES,
    action: 'APPROVE',
    params,
    body: patchBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, body, params }) => {
    await findRule(ctx.tenantId, params.id);
    const { everyone, userIds, ...rest } = body;
    await prisma.distributionRule.updateMany({
      where: { tenantId: ctx.tenantId, id: params.id },
      data: {
        ...rest,
        ...(everyone !== undefined || userIds !== undefined
          ? { candidatePool: await poolOf(ctx, { name: 'x', everyone, userIds }) }
          : {}),
        updatedById: ctx.actor.id,
      },
    });
    return prisma.distributionRule.findFirstOrThrow({ where: { tenantId: ctx.tenantId, id: params.id }, select: RULE_FIELDS });
  },
);

export const DELETE = route(
  { module: 'allocation', productModule: LEAD_MODULES, action: 'APPROVE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    await findRule(ctx.tenantId, params.id);
    await prisma.distributionRule.updateMany({
      where: { tenantId: ctx.tenantId, id: params.id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { deleted: true };
  },
);
