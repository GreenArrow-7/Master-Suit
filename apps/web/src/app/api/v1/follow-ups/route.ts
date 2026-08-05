import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const createBody = z.object({
  leadId: z.string().cuid().optional(),
  callId: z.string().cuid().optional(),
  campaignId: z.string().cuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  dueAt: z.coerce.date(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
}).strict();

export const POST = route(
  { module: 'leads', action: 'EDIT', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    return prisma.followUpTask.create({
      data: { tenantId: ctx.tenantId, ownerId: ctx.actor.id, createdById: ctx.actor.id, ...body },
    });
  },
);

const listQuery = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  due: z.enum(['overdue', 'today', 'upcoming']).optional(),
}).strict();

export const GET = route(
  { module: 'leads', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const where: Record<string, unknown> = {
      tenantId: ctx.tenantId,
      ownerId: ctx.actor.id,
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    else where.status = { in: ['OPEN', 'IN_PROGRESS'] };

    if (query.due === 'overdue') where.dueAt = { lt: now };
    else if (query.due === 'today') where.dueAt = { gte: now, lte: todayEnd };
    else if (query.due === 'upcoming') where.dueAt = { gt: todayEnd };

    const data = await prisma.followUpTask.findMany({
      where,
      orderBy: { dueAt: 'asc' },
      take: 100,
    });

    return { data };
  },
);
