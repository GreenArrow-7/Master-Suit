import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const params = z.object({ id: z.string().cuid() });

const createBody = z.object({
  question: z.string().min(1).max(500),
  expectedAnswer: z.string().max(500).optional(),
  isRequired: z.boolean().default(true),
}).strict();

export const POST = route(
  { module: 'campaigns', action: 'EDIT', params, body: createBody },
  async ({ ctx, params, body }) => {
    const count = await prisma.campaignQualification.count({ where: { tenantId: ctx.tenantId, campaignId: params.id } });
    return prisma.campaignQualification.create({
      data: { tenantId: ctx.tenantId, campaignId: params.id, position: count, ...body },
    });
  },
);

export const GET = route(
  { module: 'campaigns', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const data = await prisma.campaignQualification.findMany({
      where: { tenantId: ctx.tenantId, campaignId: params.id },
      orderBy: { position: 'asc' },
    });
    return { data };
  },
);
