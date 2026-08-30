import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { notifyAboutCall } from '@/services/crm/notify';

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
