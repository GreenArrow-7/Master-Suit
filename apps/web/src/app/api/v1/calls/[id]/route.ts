import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { notifyAboutCall } from '@/services/crm/notify';
import { recordTargetProgress } from '@/services/targets/progress';

const params = z.object({ id: z.string().cuid() });

export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      include: {
        caller: { select: { id: true, fullName: true } },
        consent: true,
        recording: { select: { id: true, mimeType: true, durationSecs: true, sizeBytes: true, createdAt: true } },
      },
    });
    if (!call) throw NotFound('Call');
    return call;
  },
);

const patchBody = z
  .object({
    status: z.enum(['SCHEDULED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'FAILED', 'CANCELLED']).optional(),
    outcome: z
      .enum([
        'CONNECTED',
        'NO_ANSWER',
        'BUSY',
        'VOICEMAIL',
        'WRONG_NUMBER',
        'CALLBACK_REQUESTED',
        'NOT_INTERESTED',
        'INTERESTED',
        'QUALIFIED',
        'CONVERTED',
      ])
      .optional(),
    notes: z.string().max(5000).optional(),
    startedAt: z.coerce.date().optional(),
    answeredAt: z.coerce.date().optional(),
    endedAt: z.coerce.date().optional(),
    durationSecs: z.number().int().min(0).optional(),
    followUpAt: z.coerce.date().optional(),
  })
  .strict();

export const PATCH = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, body: patchBody, auditEvent: 'CALL_COMPLETED' },
  async ({ ctx, params, body }) => {
    const existing = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!existing) throw NotFound('Call');

    const updated = await prisma.call.update({ where: { id: params.id, tenantId: ctx.tenantId }, data: body });

    /**
     * Only on the transition, not on every save of an already-missed call.
     * A PATCH that touches notes on a MISSED call must not re-announce it.
     */
    if (body.status && body.status !== existing.status) {
      const label = updated.recipientNumber;
      /**
       * Target progress rides the same transition as the notification: the
       * status change is the moment the work becomes countable. Credited to
       * the caller — CALLS_* metrics measure the rep who dialled.
       */
      if (['COMPLETED', 'MISSED', 'FAILED'].includes(body.status)) {
        await recordTargetProgress(ctx, updated.callerId, 'CALLS_ATTEMPTED');
      }
      if (body.status === 'COMPLETED') {
        await recordTargetProgress(ctx, updated.callerId, 'CALLS_CONNECTED');
      }
      if (body.status === 'MISSED') {
        await notifyAboutCall(ctx, updated, 'call.missed', `Missed call from ${label}`, updated.notes ?? undefined);
      } else if (body.status === 'COMPLETED') {
        await notifyAboutCall(
          ctx,
          updated,
          'call.completed',
          `Call completed with ${label}`,
          updated.notes ?? undefined,
        );
      }
    }

    return updated;
  },
);

/**
 * Soft delete, because `Call.deletedAt` already exists and every read path
 * already filters on it — the list page, the list API, and the transcript,
 * analysis and recording sub-routes all pass `deletedAt: null`. Removing a call
 * therefore takes it out of the product without destroying the record of a
 * conversation that happened.
 *
 * ── What this deliberately does not touch ───────────────────────────────────
 *
 * The recording, its stored object, the transcript, the AI analysis, the
 * consent record and the call audits all stay exactly where they are.
 *
 * Recording lifetime is owned by the retention sweep (`lib/jobs/retention.ts`),
 * which deletes by `retainUntil`, removes the object *before* the row so the
 * audio is never abandoned in the bucket, and leaves provider-hosted media
 * alone. Deleting the object here would take that decision away from the policy
 * that owns it and destroy consent and audit evidence that the product keeps on
 * purpose. A call being removed from a workspace is not a retention event.
 *
 * `Recording.call` is `onDelete: Cascade`, which matters only for a hard delete
 * — nothing cascades on a timestamp.
 */
export const DELETE = route(
  { module: 'calls', productModule: 'SALES', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    // Tenant-scoped and already-deleted-aware: a second delete is a 404 rather
    // than a silent success on a row that is already gone. Out-of-tenant lands
    // here too, and answers the same 404 — a 403 would confirm the call exists.
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!call) throw NotFound('Call');

    await prisma.call.update({
      where: { id: params.id, tenantId: ctx.tenantId },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  },
);
