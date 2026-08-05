import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';

const params = z.object({ id: z.string().cuid() });

const patchBody = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  completedAt: z.coerce.date().nullable().optional(),
}).strict();

export const PATCH = route(
  { module: 'leads', action: 'EDIT', params, body: patchBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    const task = await prisma.task.findFirst({ where: { tenantId: ctx.tenantId, id: params.id } });
    if (!task) throw NotFound('Task');
    return prisma.task.update({
      where: { id: params.id },
      data: body,
      include: { type: true },
    });
  },
);
