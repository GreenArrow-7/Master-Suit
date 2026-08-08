import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { assertRecordVisible } from '@/lib/security/visibility';
import { FURNISHINGS, PROPERTY_TYPES } from '@/lib/inventory/listings';

const params = z.object({ id: z.string().cuid() });

const body = z
  .object({
    status: z.enum(['OPEN', 'MATCHED', 'FULFILLED', 'CLOSED']).optional(),
    propertyTypes: z.array(z.enum(PROPERTY_TYPES)).max(8).optional(),
    micromarketIds: z.array(z.string().cuid()).max(20).optional(),
    bedroomsMin: z.coerce.number().int().min(0).max(50).nullable().optional(),
    bedroomsMax: z.coerce.number().int().min(0).max(50).nullable().optional(),
    areaMinSqft: z.coerce.number().int().positive().nullable().optional(),
    budgetMin: z.coerce.number().nonnegative().nullable().optional(),
    budgetMax: z.coerce.number().nonnegative().nullable().optional(),
    possessionBy: z.coerce.date().nullable().optional(),
    furnishing: z.enum(FURNISHINGS).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    ownerId: z.string().cuid().nullable().optional(),
  })
  .strict();

/**
 * `purpose` is not editable: a buyer who decides to rent instead is a different
 * search with a different budget, and quietly rewriting the old one loses the
 * record that they were ever looking to buy.
 */
export const PATCH = route(
  {
    module: 'requirements',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) =>
    withTx(ctx.tenantId, async (tx) => {
      const existing = await tx.clientRequirement.findFirst({
        where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, tenantId: true, ownerId: true },
      });
      if (!existing) throw NotFound('Requirement');
      await assertRecordVisible(ctx, 'requirements', existing, tx);

      return tx.clientRequirement.update({
        where: { id: params.id, tenantId: ctx.tenantId },
        data: { ...body, updatedById: ctx.actor.id },
      });
    }),
);

/** Soft, because a closed search is evidence of what the client wanted and when. */
export const DELETE = route(
  { module: 'requirements', productModule: 'SALES', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) =>
    withTx(ctx.tenantId, async (tx) => {
      const existing = await tx.clientRequirement.findFirst({
        where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, tenantId: true, ownerId: true },
      });
      if (!existing) throw NotFound('Requirement');
      await assertRecordVisible(ctx, 'requirements', existing, tx, 'DELETE');

      return tx.clientRequirement.update({
        where: { id: params.id, tenantId: ctx.tenantId },
        data: { deletedAt: new Date(), status: 'CLOSED', updatedById: ctx.actor.id },
        select: { id: true, deletedAt: true },
      });
    }),
);
