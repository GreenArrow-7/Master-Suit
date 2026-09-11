import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { NotFound, Invalid, Conflict } from '@/lib/errors';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { lockLeads, recomputeNextFollowUp } from '@/services/leads/nextFollowUp';

const params = z.object({ id: z.string().cuid() });

const patchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    dueAt: z.coerce.date().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    description: z.string().max(2000).nullable().optional(),
    ownerId: z.string().cuid().optional(),
    // Moving a task to another lead (or detaching it). The only way this was
    // possible before was editing the row by hand, so a task filed against the
    // wrong lead stayed there — and silently kept contributing to that lead's
    // follow-up date.
    leadId: z.string().cuid().nullable().optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED']).optional(),
    completedAt: z.coerce.date().nullable().optional(),
    completionNotes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const PATCH = route(
  { module: 'leads', productModule: 'SALES', action: 'EDIT', params, body: patchBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) =>
    withTx(ctx.tenantId, async (tx) => {
    const task = await tx.task.findFirst({ where: { tenantId: ctx.tenantId, id: params.id } });
    if (!task) throw NotFound('Task');

    // Reassigning to another person needs the same reach creating for them does.
    if (body.ownerId && body.ownerId !== task.ownerId) {
      const scope = scopeFor(ctx, 'leads', 'EDIT');
      if (SCOPE_RANK[scope] < SCOPE_RANK.TEAM && body.ownerId !== ctx.actor.id) {
        throw Invalid([{ field: 'ownerId', code: 'forbidden', message: 'You cannot reassign this task.' }]);
      }
      const target = await tx.user.findFirst({
        where: { tenantId: ctx.tenantId, id: body.ownerId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      if (!target) throw Invalid([{ field: 'ownerId', code: 'not_found', message: 'That teammate was not found.' }]);
    }

    if (body.leadId) {
      const target = await tx.lead.findFirst({
        where: { tenantId: ctx.tenantId, id: body.leadId, deletedAt: null },
        select: { id: true },
      });
      if (!target) throw Invalid([{ field: 'leadId', code: 'not_found', message: 'That lead was not found.' }]);
    }

    // Marking complete stamps the time if the client did not; reopening clears it.
    const data: Record<string, unknown> = { ...body, updatedById: ctx.actor.id };
    if (body.status === 'COMPLETED' && body.completedAt === undefined) data.completedAt = new Date();
    if (body.status && body.status !== 'COMPLETED' && task.completedAt) data.completedAt = null;

    /**
     * Both leads, locked in ascending id order before the write.
     *
     * A move changes two aggregates, and locking only one of them would let a
     * concurrent write on the other store a value computed from a set it was
     * already leaving.
     */
    const movingTo = body.leadId === undefined ? task.leadId : body.leadId;
    const locked = await lockLeads(tx, ctx.tenantId, [task.leadId, movingTo]);

    /**
     * Revalidate the relationship after locking, not before.
     *
     * The first read took no lock, so between it and here another transaction
     * may have moved this task to a lead outside the set just locked —
     * recomputing would then quietly skip that lead. Rather than reach for a
     * lock out of order (which is how this deadlocks), the loser is told to
     * retry against the row as it now stands.
     */
    const current = await tx.task.findFirst({
      where: { tenantId: ctx.tenantId, id: params.id },
      select: { leadId: true },
    });
    if (!current) throw NotFound('Task');
    if ((current.leadId ?? null) !== (task.leadId ?? null)) {
      throw Conflict('That task was moved to another lead while you were editing it. Reload and try again.');
    }

    const updated = await tx.task.update({
      where: { tenantId: ctx.tenantId, id: params.id },
      data,
      include: { type: true, owner: { select: { fullName: true } } },
    });

    for (const leadId of locked) await recomputeNextFollowUp(tx, ctx.tenantId, leadId);
    return updated;
  }),
);
