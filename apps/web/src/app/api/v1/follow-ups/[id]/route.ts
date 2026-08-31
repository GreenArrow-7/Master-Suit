import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Invalid } from '@/lib/errors';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { recordTargetProgress } from '@/services/targets/progress';

const params = z.object({ id: z.string().cuid() });

const patchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    dueAt: z.coerce.date().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    ownerId: z.string().cuid().optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED']).optional(),
    outcome: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const PATCH = route(
  { module: 'leads', productModule: 'SALES', action: 'EDIT', params, body: patchBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    const followUp = await prisma.followUpTask.findFirst({ where: { tenantId: ctx.tenantId, id: params.id } });
    if (!followUp) throw NotFound('Follow-up');

    // A rep may only work their own queue; TEAM reach and above may touch others'.
    const scope = scopeFor(ctx, 'leads', 'EDIT');
    if (followUp.ownerId !== ctx.actor.id && SCOPE_RANK[scope] < SCOPE_RANK.TEAM) {
      throw NotFound('Follow-up');
    }

    if (body.ownerId && body.ownerId !== followUp.ownerId) {
      if (SCOPE_RANK[scope] < SCOPE_RANK.TEAM && body.ownerId !== ctx.actor.id) {
        throw Invalid([{ field: 'ownerId', code: 'forbidden', message: 'You cannot reassign this follow-up.' }]);
      }
      const target = await prisma.user.findFirst({
        where: { tenantId: ctx.tenantId, id: body.ownerId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      if (!target) throw Invalid([{ field: 'ownerId', code: 'not_found', message: 'That teammate was not found.' }]);
    }

    // A new due date on an open item is a reschedule; completing stamps the time.
    const data: Record<string, unknown> = { ...body };
    if (body.dueAt && !body.status && ['OPEN', 'IN_PROGRESS', 'RESCHEDULED'].includes(followUp.status)) {
      data.status = 'RESCHEDULED';
    }
    const completingNow = body.status === 'COMPLETED' && !followUp.completedAt;
    if (completingNow) data.completedAt = new Date();
    if (body.status && body.status !== 'COMPLETED' && followUp.completedAt) data.completedAt = null;

    const updated = await prisma.followUpTask.update({ where: { tenantId: ctx.tenantId, id: params.id }, data });

    // Counted on the transition only — completingNow is false for a repeat
    // PATCH of an already-completed task, so it cannot double count. Credited
    // to the task's owner: theirs is the target this work fulfils.
    if (completingNow) await recordTargetProgress(ctx, updated.ownerId, 'FOLLOWUPS_COMPLETED');

    return updated;
  },
);
