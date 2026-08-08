import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { createMandate } from '@/services/inventory/mandates';
import { MANDATE_TYPES } from '@/lib/inventory/listings';

const params = z.object({ id: z.string().cuid() });

const body = z
  .object({
    ownerId: z.string().cuid(),
    type: z.enum(MANDATE_TYPES).default('NON_EXCLUSIVE'),
    startsAt: z.coerce.date(),
    expiresAt: z.coerce.date(),
    commissionPct: z.coerce.number().min(0).max(100).optional(),
    /** The countersigned agreement, already in our bucket. */
    documentKey: z.string().max(500).optional(),
    /**
     * Sign and activate in one step. A countersigned PDF *is* an active
     * mandate, and making somebody press a second button to say so is how a
     * listing sits unpublishable with the agreement sitting in the file.
     */
    activate: z.boolean().default(false),
  })
  .strict();

/**
 * Takes a property on.
 *
 * The transition rules, the row lock and the mirroring onto the listing all
 * live in the mandate service rather than here — the same reason the unit board
 * delegates: M9's booking flow will terminate a mandate when a sale completes,
 * and it must take the same lock and the same refusals rather than a copy.
 */
export const POST = route(
  {
    module: 'listings',
    productModule: 'SALES',
    action: 'CREATE',
    params,
    body,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, params, body }) =>
    createMandate({
      tenantId: ctx.tenantId,
      actorId: ctx.actor.id,
      listingId: params.id,
      ownerId: body.ownerId,
      type: body.type,
      startsAt: body.startsAt,
      expiresAt: body.expiresAt,
      commissionPct: body.commissionPct,
      documentKey: body.documentKey,
      activate: body.activate,
    }),
);
