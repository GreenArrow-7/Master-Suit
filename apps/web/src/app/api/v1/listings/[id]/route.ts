import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { Conflict, NotFound } from '@/lib/errors';
import { assertRecordVisible } from '@/lib/security/visibility';
import { assertMarketable, expireLapsedMandates } from '@/services/inventory/mandates';
import { FURNISHINGS, LISTING_STATUSES, PROPERTY_TYPES, maskOwner } from '@/lib/inventory/listings';

const params = z.object({ id: z.string().cuid() });

export const GET = route(
  { module: 'listings', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    await expireLapsedMandates(ctx.tenantId);

    const listing = await prisma.listing.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      include: {
        propertyOwner: {
          select: { id: true, fullName: true, phone: true, email: true, whatsappNumber: true, nationality: true },
        },
        micromarket: { select: { id: true, name: true, city: true } },
        project: { select: { id: true, name: true } },
        unit: { select: { id: true, unitNumber: true, tower: true, floor: true, status: true } },
        media: { orderBy: [{ kind: 'asc' }, { position: 'asc' }] },
        mandates: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!listing) throw NotFound('Listing');

    const amenities = listing.amenityKeys.length
      ? await prisma.amenity.findMany({
          where: { tenantId: ctx.tenantId, key: { in: listing.amenityKeys } },
          select: { key: true, label: true },
          orderBy: { position: 'asc' },
        })
      : [];

    return { ...listing, propertyOwner: maskOwner(ctx, listing.propertyOwner), amenities };
  },
);

const patchBody = z
  .object({
    title: z.string().min(3).max(200).optional(),
    status: z.enum(LISTING_STATUSES).optional(),
    propertyType: z.enum(PROPERTY_TYPES).optional(),
    micromarketId: z.string().cuid().nullable().optional(),
    address: z.string().max(400).nullable().optional(),
    bedrooms: z.coerce.number().int().min(0).max(50).nullable().optional(),
    bathrooms: z.coerce.number().int().min(0).max(50).nullable().optional(),
    areaSqft: z.coerce.number().int().positive().nullable().optional(),
    parkingSpaces: z.coerce.number().int().min(0).max(100).nullable().optional(),
    furnishing: z.enum(FURNISHINGS).nullable().optional(),
    price: z.coerce.number().positive().optional(),
    availableFrom: z.coerce.date().nullable().optional(),
    amenityKeys: z.array(z.string().max(60)).max(60).optional(),
    highlights: z.array(z.string().max(200)).max(20).optional(),
    description: z.string().max(8000).nullable().optional(),
    /** Reassigning the listing to another agent. */
    ownerId: z.string().cuid().nullable().optional(),
  })
  .strict();

/**
 * `listingType`, `reference` and the mandate mirror are not editable.
 *
 * A sale does not become a rental — that is a different listing at a different
 * price with a different agreement. The mandate columns are written only by the
 * mandate service, and the reference is what a portal, a brochure and a
 * WhatsApp message all quote.
 */
export const PATCH = route(
  {
    module: 'listings',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body: patchBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    return withTx(ctx.tenantId, async (tx) => {
      const existing = await tx.listing.findFirst({
        where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, tenantId: true, ownerId: true, status: true },
      });
      if (!existing) throw NotFound('Listing');

      // The write-path visibility check the list route does not need: an agent
      // with OWN scope may read the whole book but may only edit their own
      // listings. Reading is shared; changing someone else's stock is not.
      await assertRecordVisible(ctx, 'listings', existing, tx);

      // Publishing is the one transition with a precondition outside this table.
      if ((body.status === 'ACTIVE' || body.status === 'UNDER_OFFER') && existing.status !== body.status) {
        await assertMarketable(ctx.tenantId, params.id);
      }

      return tx.listing.update({
        where: { id: params.id, tenantId: ctx.tenantId },
        data: {
          ...body,
          publishedAt: body.status === 'ACTIVE' && existing.status !== 'ACTIVE' ? new Date() : undefined,
          updatedById: ctx.actor.id,
        },
      });
    });
  },
);

/**
 * Archive, not delete.
 *
 * A listing is referenced by its mandates, and will be referenced by bookings
 * and commissions once M9 lands. Refused outright while a mandate is live: the
 * agency still has an obligation to the owner, and making the listing disappear
 * does not end it.
 */
export const DELETE = route(
  { module: 'listings', productModule: 'SALES', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    return withTx(ctx.tenantId, async (tx) => {
      const listing = await tx.listing.findFirst({
        where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, tenantId: true, ownerId: true },
      });
      if (!listing) throw NotFound('Listing');
      await assertRecordVisible(ctx, 'listings', listing, tx, 'DELETE');

      const live = await tx.mandate.findFirst({
        where: { tenantId: ctx.tenantId, listingId: params.id, status: 'ACTIVE' },
        select: { expiresAt: true },
      });
      if (live) {
        throw Conflict(
          `The mandate on this listing runs until ${live.expiresAt.toISOString().slice(0, 10)}. Terminate it before archiving.`,
        );
      }

      return tx.listing.update({
        where: { id: params.id, tenantId: ctx.tenantId },
        data: { deletedAt: new Date(), status: 'WITHDRAWN', updatedById: ctx.actor.id },
        select: { id: true, deletedAt: true },
      });
    });
  },
);
