import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { Conflict, NotFound } from '@/lib/errors';
import { assertRecordVisible } from '@/lib/security/visibility';
import { VISIT_STATUSES, amendCompleted, transition, verify } from '@/services/visits/lifecycle';

const params = z.object({ id: z.string().cuid() });

export const GET = route(
  { module: 'visits', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const visit = await prisma.siteVisit.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      include: {
        project: { select: { id: true, name: true, address: true, latitude: true, longitude: true } },
        listing: { select: { id: true, reference: true, title: true, latitude: true, longitude: true } },
        unit: { select: { id: true, unitNumber: true, tower: true, floor: true } },
      },
    });
    if (!visit) throw NotFound('Site visit');
    await assertRecordVisible(ctx, 'visits', visit, prisma, 'VIEW');
    return visit;
  },
);

const patchBody = z
  .discriminatedUnion('action', [
    z.object({
      /** Move through the register: approve, reject, cancel, complete, no-show. */
      action: z.literal('transition'),
      status: z.enum(VISIT_STATUSES),
      note: z.string().max(1000).optional(),
    }),
    z.object({
      /** Ordinary edit, while the visit is still open. */
      action: z.literal('edit'),
      scheduledAt: z.coerce.date().optional(),
      durationMin: z.coerce.number().int().min(5).max(1440).optional(),
      address: z.string().max(400).nullable().optional(),
      notes: z.string().max(4000).nullable().optional(),
      outcome: z.string().max(200).nullable().optional(),
    }),
    z.object({
      /** Correcting a completed visit. The reason is not optional. */
      action: z.literal('amend'),
      reason: z.string().min(5).max(1000),
      outcome: z.string().max(200).optional(),
      notes: z.string().max(4000).optional(),
    }),
    z.object({
      /** A leader deciding whether to believe it. */
      action: z.literal('verify'),
      verdict: z.enum(['VERIFIED', 'DISPUTED']),
      note: z.string().max(1000).optional(),
    }),
  ])
  .and(z.object({}).strict().partial());

/**
 * Four ways a visit changes, and they are genuinely different operations rather
 * than one update with different fields set.
 *
 * `edit` is refused once the visit is COMPLETED — that is the acceptance
 * criterion, and routing the correction through `amend` is what makes the audit
 * entry unavoidable rather than merely usual.
 */
export const PATCH = route(
  {
    module: 'visits',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body: patchBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    if (body.action === 'transition') {
      const { visit, from } = await transition({ ctx, visitId: params.id, to: body.status, note: body.note });
      return { id: visit.id, from, status: visit.status };
    }

    if (body.action === 'amend') {
      return amendCompleted({
        ctx,
        visitId: params.id,
        reason: body.reason,
        outcome: body.outcome,
        notes: body.notes,
      });
    }

    if (body.action === 'verify') {
      return verify({ ctx, visitId: params.id, verdict: body.verdict, note: body.note });
    }

    return withTx(ctx.tenantId, async (tx) => {
      const visit = await tx.siteVisit.findFirst({
        where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, tenantId: true, ownerId: true, status: true },
      });
      if (!visit) throw NotFound('Site visit');
      await assertRecordVisible(ctx, 'visits', visit, tx);

      // The acceptance criterion. A completed visit is evidence, and evidence is
      // amended with a reason on the record, not edited in place.
      if (visit.status === 'COMPLETED') {
        throw Conflict('This visit is completed. Use an amendment, which records why it changed.');
      }
      if (['REJECTED', 'CANCELLED', 'NO_SHOW'].includes(visit.status)) {
        throw Conflict(`A ${visit.status.toLowerCase().replace('_', ' ')} visit cannot be edited.`);
      }

      const { action, ...data } = body;
      void action;
      return tx.siteVisit.update({
        where: { id: visit.id, tenantId: ctx.tenantId },
        data: { ...data, updatedById: ctx.actor.id },
      });
    });
  },
);

/**
 * Cancelling.
 *
 * Soft, and only before it happened. A visit that took place is a record of
 * something that took place; making it disappear is the opposite of a register.
 */
export const DELETE = route(
  { module: 'visits', productModule: 'SALES', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) =>
    withTx(ctx.tenantId, async (tx) => {
      const visit = await tx.siteVisit.findFirst({
        where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, tenantId: true, ownerId: true, status: true },
      });
      if (!visit) throw NotFound('Site visit');
      await assertRecordVisible(ctx, 'visits', visit, tx, 'DELETE');

      if (['CHECKED_IN', 'COMPLETED'].includes(visit.status)) {
        throw Conflict('This visit has already happened. Complete it and record the outcome instead.');
      }

      return tx.siteVisit.update({
        where: { id: visit.id, tenantId: ctx.tenantId },
        data: { deletedAt: new Date(), status: 'CANCELLED', updatedById: ctx.actor.id },
        select: { id: true, deletedAt: true },
      });
    }),
);
