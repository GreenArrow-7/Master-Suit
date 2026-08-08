import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { MANDATE_STATUSES, decideMandate } from '@/services/inventory/mandates';

const params = z.object({ id: z.string().cuid(), mandateId: z.string().cuid() });

const body = z
  .object({
    status: z.enum(MANDATE_STATUSES),
    /** Why it was ended. Read by whoever asks a year later why the owner left. */
    note: z.string().max(1000).optional(),
  })
  .strict();

/**
 * Activate or end a mandate.
 *
 * Ending one takes the listing off the market in the same transaction — without
 * a live agreement there is no permission to advertise, and a warning banner is
 * not a control.
 */
export const PATCH = route(
  {
    module: 'listings',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body,
    auditEvent: 'STAGE_CHANGED',
  },
  async ({ ctx, params, body }) => {
    const { mandate, from } = await decideMandate({
      tenantId: ctx.tenantId,
      actorId: ctx.actor.id,
      listingId: params.id,
      mandateId: params.mandateId,
      to: body.status,
      note: body.note,
    });

    return { id: mandate.id, from, status: mandate.status, expiresAt: mandate.expiresAt };
  },
);
