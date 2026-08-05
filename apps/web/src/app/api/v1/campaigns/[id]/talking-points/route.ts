import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const params = z.object({ id: z.string().cuid() });

const createBody = z.object({
  label: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  isRequired: z.boolean().default(false),
  scriptId: z.string().cuid().optional(),
}).strict();

export const POST = route(
  { module: 'campaigns', action: 'EDIT', params, body: createBody },
  async ({ ctx, params, body }) => {
    const count = await prisma.campaignTalkingPoint.count({ where: { tenantId: ctx.tenantId, campaignId: params.id } });
    return prisma.campaignTalkingPoint.create({
      data: { tenantId: ctx.tenantId, campaignId: params.id, position: count, ...body },
    });
  },
);

export const GET = route(
  { module: 'campaigns', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const data = await prisma.campaignTalkingPoint.findMany({
      where: { tenantId: ctx.tenantId, campaignId: params.id },
      orderBy: { position: 'asc' },
    });
    return { data };
  },
);
