import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const createBody = z.object({
  name: z.string().min(1).max(200),
  campaignId: z.string().cuid().optional(),
  criteria: z.array(z.object({
    label: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    weight: z.number().min(0).max(10).default(1),
    isRequired: z.boolean().default(false),
  })).min(1).max(50),
}).strict();

export const POST = route(
  { module: 'calls', action: 'CREATE', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    const { criteria, ...rest } = body;
    return prisma.auditScorecard.create({
      data: {
        tenantId: ctx.tenantId,
        createdById: ctx.actor.id,
        ...rest,
        criteria: {
          create: criteria.map((c, i) => ({
            tenantId: ctx.tenantId,
            ...c,
            position: i,
          })),
        },
      },
      include: { criteria: { orderBy: { position: 'asc' } } },
    });
  },
);

const listQuery = z.object({
  campaignId: z.string().optional(),
  active: z.enum(['true', 'false']).optional(),
}).strict();

export const GET = route(
  { module: 'calls', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const where: Record<string, unknown> = { tenantId: ctx.tenantId };
    if (query.campaignId) where.campaignId = query.campaignId;
    if (query.active === 'true') where.isActive = true;
    else if (query.active === 'false') where.isActive = false;

    const data = await prisma.auditScorecard.findMany({
      where,
      include: { criteria: { orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return { data };
  },
);
