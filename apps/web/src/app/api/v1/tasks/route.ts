import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const createBody = z.object({
  typeId: z.string().cuid(),
  title: z.string().min(1).max(200),
  leadId: z.string().cuid(),
  dueAt: z.coerce.date(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  description: z.string().max(2000).optional(),
}).strict();

export const POST = route(
  { module: 'leads', action: 'EDIT', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    return prisma.task.create({
      data: {
        tenantId: ctx.tenantId,
        ownerId: ctx.actor.id,
        ...body,
      },
      include: { type: true },
    });
  },
);
