import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { moveUnit, UNIT_STATUSES } from '@/services/inventory/unitStatus';

const params = z.object({ id: z.string().cuid(), unitId: z.string().cuid() });

const body = z
  .object({
    status: z.enum(UNIT_STATUSES),
    /** Required when booking, so the unit points back at the buyer. */
    leadId: z.string().cuid().optional(),
    /** How long a hold lasts. Defaults to 48 hours. */
    holdHours: z.number().int().min(1).max(720).optional(),
  })
  .strict();

/**
 * The only way a unit changes availability.
 *
 * The transition rules, the row lock and the rollup recalculation all live in
 * `moveUnit` rather than here, because a second caller is coming: M9's booking
 * flow moves a unit to BOOKED as part of creating the booking, and it must take
 * the same lock and the same refusals rather than a copy of them.
 */
export const PATCH = route(
  {
    module: 'projects',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body,
    auditEvent: 'STAGE_CHANGED',
  },
  async ({ ctx, params, body }) => {
    const { unit, from } = await moveUnit({
      tenantId: ctx.tenantId,
      actorId: ctx.actor.id,
      projectId: params.id,
      unitId: params.unitId,
      to: body.status,
      leadId: body.leadId,
      holdHours: body.holdHours,
    });

    return { id: unit.id, from, status: unit.status, heldUntil: unit.heldUntil, leadId: unit.leadId };
  },
);
