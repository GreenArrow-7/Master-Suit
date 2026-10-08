import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { AppError, NotFound } from '@/lib/errors';
import { assertRecordVisible } from '@/lib/security/visibility';
import { touchLead } from '@/services/leads/touch';
import { findReplay, recordOutcome } from '@/services/idempotency';

const createBody = z
  .object({
    typeId: z.string().cuid(),
    leadId: z.string().cuid(),
    outcome: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
    durationSecs: z.number().int().min(0).optional(),
    /** A client's key for this one activity, so a send repeated after a lost answer is not logged twice. */
    requestKey: z.string().uuid().optional(),
    /** When it happened, for one logged offline and sent later: within the last week, not ahead. */
    occurredAt: z.coerce
      .date()
      .refine((at) => at.getTime() <= Date.now() + 5 * 60_000 && at.getTime() >= Date.now() - 7 * 86_400_000, {
        message: 'An activity is logged within a week of when it happened.',
      })
      .optional(),
  })
  .strict();

export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'EDIT', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    const { requestKey, ...fields } = body;
    const key = requestKey && {
      tenantId: ctx.tenantId,
      operation: 'activity.create',
      requestKey,
      actorUserId: ctx.actor.id,
      input: { ...fields, occurredAt: fields.occurredAt?.toISOString() ?? null },
    };
    if (key) {
      const replay = await findReplay<unknown>(key);
      if (replay) return replay.result;
    }
    const activity = await withTx(ctx.tenantId, async (tx) => {
      // The lead's own write rule (updateLead): `leads:EDIT` alone let an agent
      // at OWN scope log on, and stamp, any lead in the workspace by its id. Not
      // found either way — a 403 would confirm the lead exists.
      const lead = await tx.lead.findFirst({ where: { tenantId: ctx.tenantId, id: body.leadId } });
      if (!lead) throw NotFound('Lead');
      try {
        await assertRecordVisible(ctx, 'leads', lead, tx, 'EDIT');
      } catch (err) {
        if (err instanceof AppError && err.status === 403) throw NotFound('Lead');
        throw err;
      }
      const created = await tx.activity.create({
        data: { tenantId: ctx.tenantId, ownerId: ctx.actor.id, ...fields },
        include: { type: { select: { name: true, key: true } } },
      });
      if (key) await recordOutcome(tx, key, created);
      return created;
    });
    await touchLead(ctx.tenantId, body.leadId, activity.occurredAt);
    return activity;
  },
);
