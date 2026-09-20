import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { touchLead } from '@/services/leads/touch';
import { NotFound } from '@/lib/errors';
import { hasSensitiveAccess } from '@/lib/auth/sensitive-access';
import { notifyAboutCall } from '@/services/crm/notify';
import { recordTargetProgress } from '@/services/targets/progress';
import { assertCallInScope } from '@/lib/security/record-scope';

const params = z.object({ id: z.string().cuid() });

export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    await assertCallInScope(ctx, params.id);
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      include: {
        caller: { select: { id: true, fullName: true } },
        consent: true,
        recording: { select: { id: true, mimeType: true, durationSecs: true, sizeBytes: true, createdAt: true } },
      },
    });
    if (!call) throw NotFound('Call');
    // Free-text notes about the conversation follow the sensitive authorisation.
    return (await hasSensitiveAccess(ctx)) ? call : { ...call, notes: null };
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
    await assertCallInScope(ctx, params.id);
    const existing = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!existing) throw NotFound('Call');

    const updated = await prisma.call.update({ where: { id: params.id, tenantId: ctx.tenantId }, data: body });
    if (body.status || body.outcome || body.notes) await touchLead(ctx.tenantId, updated.leadId);

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
        // The daily cold-calling target counts leads, not dials: the first
        // finished call to a lead today is the one that counts.
        if (updated.leadId) {
          const dayStart = new Date();
          dayStart.setUTCHours(0, 0, 0, 0);
          const earlier = await prisma.call.count({
            where: {
              tenantId: ctx.tenantId,
              callerId: updated.callerId,
              leadId: updated.leadId,
              id: { not: updated.id },
              status: { in: ['COMPLETED', 'MISSED', 'FAILED'] },
              createdAt: { gte: dayStart },
            },
          });
          if (earlier === 0) await recordTargetProgress(ctx, updated.callerId, 'LEADS_CALLED');
        }
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
 * Soft delete (ported from the BUG-011 fix, 74b4616).
 *
 * `Call.deletedAt` exists and the list page, list API, transcript, analysis and
 * recording routes filter on it; the endpoint answered 405. The recording, its
 * stored object, transcript, analysis, consent record and audits are left alone:
 * recording lifetime belongs to the retention sweep, and consent and audit evidence
 * is kept on purpose. A second delete, or another tenant's call, is a 404.
 */
export const DELETE = route(
  { module: 'calls', productModule: 'SALES', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    await assertCallInScope(ctx, params.id);
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!call) throw NotFound('Call');
    await prisma.call.update({ where: { id: params.id, tenantId: ctx.tenantId }, data: { deletedAt: new Date() } });
    return { ok: true };
  },
);
