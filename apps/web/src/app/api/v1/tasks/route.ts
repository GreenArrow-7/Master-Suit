import { LEAD_MODULES } from '@/lib/security/entitlements';
import { REPEATS } from '@/lib/tasks/recurrence';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { cursorWhere, pageQuery, toPage } from '@/lib/api/pagination';
import { mergeWhere } from '@/lib/api/where';
import { assertAssignableUser, assertLeadInScope, workListScope } from '@/lib/security/record-scope';
import { withRecompute } from '@/services/leads/nextFollowUp';
import { queueCalendarSync } from '@/services/integrations/googleCalendar';

const createBody = z
  .object({
    typeId: z.string().cuid(),
    title: z.string().min(1).max(200),
    // A task can stand alone (a personal to-do) or hang off a lead. Requiring a
    // lead is what made the standalone Tasks page unusable — there was no way to
    // create one that was not already attached to a record.
    leadId: z.string().cuid().optional(),
    // Who the task is for: yourself, or someone your leads:ASSIGN scope reaches.
    ownerId: z.string().cuid().optional(),
    dueAt: z.coerce.date(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    description: z.string().max(2000).optional(),
    /** Repeat on completion (M8-10). */
    repeat: z.enum(REPEATS).optional(),
  })
  .strict();

export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'EDIT', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    const { ownerId, repeat, ...rest } = body;
    // Another person only inside the caller's own scope: from TEAM up this took
    // any active user in the workspace. Outside it, 404 as an unknown user.
    const resolvedOwner = ownerId ?? ctx.actor.id;
    if (resolvedOwner !== ctx.actor.id) await assertAssignableUser(ctx, prisma, 'leads', 'ASSIGN', resolvedOwner);

    // A new task can be earlier than everything already open on the lead, so the
    // stored aggregate is recomputed under the lead's lock in the same
    // transaction that creates the row. A task with no lead locks nothing.
    const task = await withTx(ctx.tenantId, async (tx) => {
      if (rest.leadId) await assertLeadInScope(ctx, rest.leadId, tx, 'EDIT');
      return withRecompute(tx, ctx.tenantId, [rest.leadId], () =>
        tx.task.create({
          data: {
            tenantId: ctx.tenantId,
            ownerId: resolvedOwner,
            createdById: ctx.actor.id,
            recurrenceRule: repeat ?? null,
            ...rest,
          },
          include: { type: true, owner: { select: { fullName: true } } },
        }),
      );
    });
    // A meeting onto the workspace's Google Calendar, once committed (M8-08).
    await queueCalendarSync(ctx.tenantId, 'task', task.id);
    return task;
  },
);

const listQuery = pageQuery
  .extend({
    status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED']).optional(),
    // The caller's own; by default, everyone their tasks scope covers (the Tasks page's Mine).
    view: z.enum(['mine']).optional(),
  })
  .strict();

/**
 * The Tasks page's rows for API users: the tasks the caller's `tasks:VIEW`
 * scope covers, newest change first, a page at a time. There was no list, so
 * a Lead-Eagle-only workspace reached its team's tasks only lead by lead.
 */
export const GET = route(
  { module: 'tasks', productModule: LEAD_MODULES, action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const rows = await prisma.task.findMany({
      where: mergeWhere(
        await workListScope(ctx, 'tasks', query.view === 'mine'),
        { deletedAt: null, status: query.status },
        cursorWhere(query.cursor),
      ),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: { type: { select: { name: true } }, owner: { select: { id: true, fullName: true } } },
    });
    return toPage(rows, query.limit);
  },
);
