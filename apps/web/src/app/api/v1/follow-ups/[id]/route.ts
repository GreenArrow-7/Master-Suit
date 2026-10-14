import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { NotFound, Conflict } from '@/lib/errors';
import { assertAssignableUser, assertLeadInScope, assertOwnerInScope } from '@/lib/security/record-scope';
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
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params,
    body: patchBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    const { updated, completingNow } = await withTx(ctx.tenantId, async (tx) => {
      const followUp = await tx.followUpTask.findFirst({ where: { tenantId: ctx.tenantId, id: params.id } });
      if (!followUp) throw NotFound('Follow-up');

      // A rep may only work their own queue; TEAM reach and above, the queues of
      // people in their scope.
      await assertOwnerInScope(ctx, tx, 'leads', 'EDIT', followUp.ownerId, 'Follow-up');

      // The new owner: yourself, or someone your leads:ASSIGN scope reaches.
      if (body.ownerId && body.ownerId !== followUp.ownerId) {
        await assertAssignableUser(ctx, tx, 'leads', 'ASSIGN', body.ownerId);
      }

      // A new due date on an open item is a reschedule; completing stamps the time.
      const data: Record<string, unknown> = { ...body };
      if (body.dueAt && !body.status && ['OPEN', 'IN_PROGRESS', 'RESCHEDULED'].includes(followUp.status)) {
        data.status = 'RESCHEDULED';
      }
      // Moved off COMPLETED, the write itself clears completedAt, not the read
      // above: a completion committing between that read and this write left a
      // reopened row OPEN with completedAt set.
      if (body.status && body.status !== 'COMPLETED') data.completedAt = null;

      if (body.leadId) await assertLeadInScope(ctx, body.leadId, tx, 'EDIT');

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

      // Completion is claimed on the row, not decided from the read above: two
      // concurrent completions both read completedAt null, and only the one
      // whose conditional update lands is the transition.
      const completingNow =
        body.status === 'COMPLETED' &&
        !followUp.completedAt &&
        (
          await tx.followUpTask.updateMany({
            where: { tenantId: ctx.tenantId, id: params.id, completedAt: null },
            data: { completedAt: new Date() },
          })
        ).count === 1;

      const updated = await tx.followUpTask.update({ where: { tenantId: ctx.tenantId, id: params.id }, data });

      for (const leadId of locked) await recomputeNextFollowUp(tx, ctx.tenantId, leadId);

      return { updated, completingNow };
    });

    // Counted on the transition only — completingNow is true for the one
    // request that claimed completedAt, not a repeat or a concurrent PATCH. Credited
    // to the task's owner: theirs is the target this work fulfils. After the
    // commit, like every other caller: it reads through the global client, which
    // inside withTx has no tenant pinned, so RLS found no target and nothing
    // was ever counted.
    if (completingNow) await recordTargetProgress(ctx, updated.ownerId, 'FOLLOWUPS_COMPLETED');

    return updated;
  },
);
