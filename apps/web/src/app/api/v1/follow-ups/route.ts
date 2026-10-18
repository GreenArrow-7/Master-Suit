import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { assertCallInScope, assertLeadInScope, workListScope } from '@/lib/security/record-scope';
import { withRecompute } from '@/services/leads/nextFollowUp';
import { queueCalendarSync } from '@/services/integrations/calendarSync';
import { workspaceTimezone } from '@/services/hr/attendance';
import { mergeWhere } from '@/lib/api/where';
import { FOLLOW_UP_KINDS, OPEN_FOLLOW_UP, followUpDueWhere, isDayKey } from '@/lib/leads/followUpDue';

const createBody = z
  .object({
    leadId: z.string().cuid().optional(),
    callId: z.string().cuid().optional(),
    campaignId: z.string().cuid().optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    dueAt: z.coerce.date(),
    // A call unless booked as something else (the column's default).
    kind: z.enum(FOLLOW_UP_KINDS).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  })
  .strict();

export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'EDIT', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    // It shows on its call's page: a call the caller may see. Before the
    // transaction, because the helper reads through the global client.
    if (body.callId) await assertCallInScope(ctx, body.callId, 'VIEW');
    // Same contract as a task: the lead is locked and its stored aggregate
    // recomputed in the transaction that creates the obligation.
    const created = await withTx(ctx.tenantId, async (tx) => {
      if (body.leadId) await assertLeadInScope(ctx, body.leadId, tx, 'EDIT');
      return withRecompute(tx, ctx.tenantId, [body.leadId], () =>
        tx.followUpTask.create({
          data: { tenantId: ctx.tenantId, ownerId: ctx.actor.id, createdById: ctx.actor.id, ...body },
        }),
      );
    });
    // A meeting or site visit onto the workspace's calendars, once committed (M8-08, M8-09).
    await queueCalendarSync(ctx.tenantId, 'followUp', created.id);
    return created;
  },
);

const listQuery = z
  .object({
    status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED']).optional(),
    due: z.enum(['overdue', 'today', 'upcoming']).optional(),
    // One day on the workspace's clock, and what the follow-up is for: the Lead Eagle board's links.
    date: z.string().refine(isDayKey, 'A day as YYYY-MM-DD').optional(),
    kind: z.enum(FOLLOW_UP_KINDS).optional(),
    // The caller's own; by default, everyone their leads scope covers (the page's Mine).
    view: z.enum(['mine']).optional(),
  })
  .strict();

export const GET = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    // The Follow-ups page's reading of due, date and kind, on the workspace's clock.
    const where = mergeWhere(
      await workListScope(ctx, 'leads', query.view === 'mine'),
      { deletedAt: null },
      query.status ? { status: query.status } : OPEN_FOLLOW_UP,
      followUpDueWhere(query, await workspaceTimezone(ctx)),
    );

    const data = await prisma.followUpTask.findMany({
      where,
      orderBy: { dueAt: 'asc' },
      take: 100,
    });

    return { data };
  },
);
