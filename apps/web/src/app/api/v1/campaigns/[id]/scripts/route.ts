import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const params = z.object({ id: z.string().cuid() });

const createBody = z
  .object({
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(10000),
    isDefault: z.boolean().default(false),
  })
  .strict();

export const POST = route(
  {
    module: 'campaigns',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body: createBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, params, body }) => {
    const count = await prisma.campaignScript.count({ where: { tenantId: ctx.tenantId, campaignId: params.id } });
    return prisma.campaignScript.create({
      data: { tenantId: ctx.tenantId, campaignId: params.id, createdById: ctx.actor.id, position: count, ...body },
    });
  },
);

export const GET = route(
  { module: 'campaigns', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const data = await prisma.campaignScript.findMany({
      where: { tenantId: ctx.tenantId, campaignId: params.id },
      include: { talkingPoints: { orderBy: { position: 'asc' } } },
      orderBy: { position: 'asc' },
    });
    return { data };
  },
);
