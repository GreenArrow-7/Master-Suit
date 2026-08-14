import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Invalid } from '@/lib/errors';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';

const params = z.object({ id: z.string().cuid() });

const patchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    dueAt: z.coerce.date().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    description: z.string().max(2000).nullable().optional(),
    ownerId: z.string().cuid().optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED']).optional(),
    completedAt: z.coerce.date().nullable().optional(),
    completionNotes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const PATCH = route(
  { module: 'leads', productModule: 'SALES', action: 'EDIT', params, body: patchBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    const task = await prisma.task.findFirst({ where: { tenantId: ctx.tenantId, id: params.id } });
    if (!task) throw NotFound('Task');

    // Reassigning to another person needs the same reach creating for them does.
    if (body.ownerId && body.ownerId !== task.ownerId) {
      const scope = scopeFor(ctx, 'leads', 'EDIT');
      if (SCOPE_RANK[scope] < SCOPE_RANK.TEAM && body.ownerId !== ctx.actor.id) {
        throw Invalid([{ field: 'ownerId', code: 'forbidden', message: 'You cannot reassign this task.' }]);
      }
      const target = await prisma.user.findFirst({
        where: { tenantId: ctx.tenantId, id: body.ownerId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      if (!target) throw Invalid([{ field: 'ownerId', code: 'not_found', message: 'That teammate was not found.' }]);
    }

    // Marking complete stamps the time if the client did not; reopening clears it.
    const data: Record<string, unknown> = { ...body, updatedById: ctx.actor.id };
    if (body.status === 'COMPLETED' && body.completedAt === undefined) data.completedAt = new Date();
    if (body.status && body.status !== 'COMPLETED' && task.completedAt) data.completedAt = null;

    return prisma.task.update({
      where: { tenantId: ctx.tenantId, id: params.id },
      data,
      include: { type: true, owner: { select: { fullName: true } } },
    });
  },
);
