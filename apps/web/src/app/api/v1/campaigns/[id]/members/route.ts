import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const params = z.object({ id: z.string().cuid() });

const addBody = z
  .object({
    userId: z.string().cuid(),
    role: z.enum(['CALLER', 'MANAGER', 'OBSERVER']).default('CALLER'),
  })
  .strict();

export const POST = route(
  { module: 'campaigns', productModule: 'SALES', action: 'EDIT', params, body: addBody },
  async ({ ctx, params, body }) => {
    return prisma.campaignMember.upsert({
      where: { campaignId_userId: { campaignId: params.id, userId: body.userId } },
      create: { tenantId: ctx.tenantId, campaignId: params.id, ...body },
      update: { removedAt: null, role: body.role },
    });
  },
);

export const GET = route(
  { module: 'campaigns', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const data = await prisma.campaignMember.findMany({
      where: { tenantId: ctx.tenantId, campaignId: params.id, removedAt: null },
    });
    return { data };
  },
);
