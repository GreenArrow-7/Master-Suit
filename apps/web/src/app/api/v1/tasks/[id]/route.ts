import { nextDue } from '@/lib/tasks/recurrence';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { NotFound, Conflict } from '@/lib/errors';
import { assertAssignableUser, assertLeadInScope, assertOwnerInScope } from '@/lib/security/record-scope';
import { lockLeads, recomputeNextFollowUp } from '@/services/leads/nextFollowUp';
import { queueCalendarSync } from '@/services/integrations/googleCalendar';

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
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params,
    body: patchBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    let nextId: string | undefined;
    const updated = await withTx(ctx.tenantId, async (tx) => {
      const task = await tx.task.findFirst({ where: { tenantId: ctx.tenantId, id: params.id } });
      if (!task) throw NotFound('Task');
      // A task you may see (the task lists' rule; seeded managers hold
      // `tasks:VIEW` and `ASSIGN`, not `tasks:EDIT`) whose owner the route's own
      // `leads:EDIT` reaches: seeing every task is no licence to take one.
      await assertOwnerInScope(ctx, tx, 'tasks', 'VIEW', task.ownerId, 'Task');
      await assertOwnerInScope(ctx, tx, 'leads', 'EDIT', task.ownerId, 'Task');

      // Reassigning to another person needs the same reach creating for them does.
      if (body.ownerId && body.ownerId !== task.ownerId) {
        await assertAssignableUser(ctx, tx, 'leads', 'ASSIGN', body.ownerId);
      }

      if (body.leadId) await assertLeadInScope(ctx, body.leadId, tx, 'EDIT');

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

      // A repeating task, just completed, books its next occurrence (M8-10).
      const due =
        task.recurrenceRule && body.status === 'COMPLETED' && task.status !== 'COMPLETED'
          ? nextDue(updated.dueAt, task.recurrenceRule)
          : null;
      if (due) {
        const next = await tx.task.create({
          data: {
            tenantId: ctx.tenantId,
            typeId: updated.typeId,
            title: updated.title,
            description: updated.description,
            leadId: updated.leadId,
            ownerId: updated.ownerId,
            priority: updated.priority,
            dueAt: due,
            recurrenceRule: task.recurrenceRule,
            parentTaskId: task.parentTaskId ?? task.id,
            createdById: ctx.actor.id,
          },
          select: { id: true },
        });
        nextId = next.id;
      }

      for (const leadId of locked) await recomputeNextFollowUp(tx, ctx.tenantId, leadId);
      return updated;
    });
    // A meeting moved, done or cancelled, and its next occurrence, on the workspace's Google Calendar (M8-08).
    await queueCalendarSync(ctx.tenantId, 'task', updated.id, nextId);
    return updated;
  },
);

/**
 * Soft delete (ported from the incident fix for BUG-009, 10c1000).
 *
 * `Task.deletedAt` exists and every read path filters on it, but the endpoint
 * answered 405. Gated on `tasks:DELETE`, as every other delete route gates on its
 * own module's DELETE; cancelling (`status: 'CANCELLED'`) is not this — it keeps the
 * task on the board as a decision taken.
 *
 * Unlike the original, a deleted task must stop counting towards its lead's next
 * follow-up, so the lead is locked and recomputed in the same transaction, in the
 * same order PATCH uses. A second delete is a 404, not a silent success.
 */
export const DELETE = route(
  { module: 'tasks', productModule: LEAD_MODULES, action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    const deleted = await withTx(ctx.tenantId, async (tx) => {
      const task = await tx.task.findFirst({
        where: { tenantId: ctx.tenantId, id: params.id, deletedAt: null },
        select: { id: true, leadId: true, ownerId: true },
      });
      if (!task) throw NotFound('Task');
      await assertOwnerInScope(ctx, tx, 'tasks', 'DELETE', task.ownerId, 'Task');

      const locked = await lockLeads(tx, ctx.tenantId, [task.leadId]);
      const current = await tx.task.findFirst({
        where: { tenantId: ctx.tenantId, id: params.id, deletedAt: null },
        select: { leadId: true },
      });
      if (!current) throw NotFound('Task');
      if ((current.leadId ?? null) !== (task.leadId ?? null)) {
        throw Conflict('That task was moved to another lead while you were deleting it. Reload and try again.');
      }

      await tx.task.update({
        where: { tenantId: ctx.tenantId, id: params.id },
        data: { deletedAt: new Date(), updatedById: ctx.actor.id },
      });
      for (const leadId of locked) await recomputeNextFollowUp(tx, ctx.tenantId, leadId);
      return { ok: true };
    });
    // Off the workspace's Google Calendar (M8-08).
    await queueCalendarSync(ctx.tenantId, 'task', params.id);
    return deleted;
  },
);
