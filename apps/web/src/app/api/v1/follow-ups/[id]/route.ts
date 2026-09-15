import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { NotFound, Invalid, Conflict } from '@/lib/errors';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { recordTargetProgress } from '@/services/targets/progress';
import { lockLeads, recomputeNextFollowUp } from '@/services/leads/nextFollowUp';

const params = z.object({ id: z.string().cuid() });

const patchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    dueAt: z.coerce.date().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    ownerId: z.string().cuid().optional(),
    // Moving a follow-up between leads — see the note on the task route.
    leadId: z.string().cuid().nullable().optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED']).optional(),
    outcome: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const PATCH = route(
  { module: 'leads', productModule: 'SALES', action: 'EDIT', params, body: patchBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) =>
    withTx(ctx.tenantId, async (tx) => {
      const followUp = await tx.followUpTask.findFirst({ where: { tenantId: ctx.tenantId, id: params.id } });
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
        const target = await tx.user.findFirst({
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

      if (body.leadId) {
        const target = await tx.lead.findFirst({
          where: { tenantId: ctx.tenantId, id: body.leadId, deletedAt: null },
          select: { id: true },
        });
        if (!target) throw Invalid([{ field: 'leadId', code: 'not_found', message: 'That lead was not found.' }]);
      }

      // Both leads, ascending, before the write — see the task route for why, and
      // why a concurrent move is refused rather than locked out of order.
      const movingTo = body.leadId === undefined ? followUp.leadId : body.leadId;
      const locked = await lockLeads(tx, ctx.tenantId, [followUp.leadId, movingTo]);

      const current = await tx.followUpTask.findFirst({
        where: { tenantId: ctx.tenantId, id: params.id },
        select: { leadId: true },
      });
      if (!current) throw NotFound('Follow-up');
      if ((current.leadId ?? null) !== (followUp.leadId ?? null)) {
        throw Conflict('That follow-up was moved to another lead while you were editing it. Reload and try again.');
      }

      const updated = await tx.followUpTask.update({ where: { tenantId: ctx.tenantId, id: params.id }, data });

      for (const leadId of locked) await recomputeNextFollowUp(tx, ctx.tenantId, leadId);

      // Counted on the transition only — completingNow is false for a repeat
      // PATCH of an already-completed task, so it cannot double count. Credited
      // to the task's owner: theirs is the target this work fulfils.
      if (completingNow) await recordTargetProgress(ctx, updated.ownerId, 'FOLLOWUPS_COMPLETED');

      return updated;
    }),
);
