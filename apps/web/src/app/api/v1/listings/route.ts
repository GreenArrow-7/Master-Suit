import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { pageQuery, decodeCursor, cursorWhere, toPage } from '@/lib/api/pagination';
import { prisma, withTx } from '@/lib/db';
import { Invalid } from '@/lib/errors';
import { nextReference } from '@/services/shared/reference';
import { expireLapsedMandates } from '@/services/inventory/mandates';
import {
  FURNISHINGS,
  LISTING_LIST_SELECT,
  LISTING_TYPES,
  PROPERTY_TYPES,
  RENT_FREQUENCIES,
  listingFilters,
  listingWhere,
  maskOwner,
} from '@/lib/inventory/listings';

/**
 * The listing book.
 *
 * Read by everyone with `listings:VIEW`, like the project catalogue — a shared
 * book is the point of a book. Owner contact details are masked on the way out
 * unless the caller holds `listings:VIEW_SENSITIVE_FIELDS`.
 */
const listQuery = pageQuery.merge(listingFilters);

export const GET = route(
  { module: 'listings', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    // Lapsed mandates take their listings off the market at the moment somebody
    // looks. Doing it here rather than on a schedule means the book is never
    // read in a state where an expired agreement still shows as live.
    await expireLapsedMandates(ctx.tenantId);

    const cursor = decodeCursor(query.cursor);
    const where = { ...listingWhere(ctx.tenantId, query, ctx.actor.id), ...cursorWhere(cursor) };

    const rows = await prisma.listing.findMany({
      where,
      select: LISTING_LIST_SELECT,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    return toPage(rows as never, query.limit);
  },
);

const createBody = z
  .object({
    title: z.string().min(3).max(200),
    listingType: z.enum(LISTING_TYPES),
    propertyType: z.enum(PROPERTY_TYPES).default('APARTMENT'),
    propertyOwnerId: z.string().cuid(),
    projectId: z.string().cuid().optional(),
    unitInventoryId: z.string().cuid().optional(),
    micromarketId: z.string().cuid().optional(),
    address: z.string().max(400).optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    bedrooms: z.coerce.number().int().min(0).max(50).optional(),
    bathrooms: z.coerce.number().int().min(0).max(50).optional(),
    areaSqft: z.coerce.number().int().positive().max(10_000_000).optional(),
    parkingSpaces: z.coerce.number().int().min(0).max(100).optional(),
    furnishing: z.enum(FURNISHINGS).optional(),
    price: z.coerce.number().positive(),
    currency: z.string().length(3).default('AED'),
    rentFrequency: z.enum(RENT_FREQUENCIES).optional(),
    availableFrom: z.coerce.date().optional(),
    amenityKeys: z.array(z.string().max(60)).max(60).default([]),
    highlights: z.array(z.string().max(200)).max(20).default([]),
    description: z.string().max(8000).optional(),
  })
  .strict();

/**
 * A new listing starts as a DRAFT and stays there.
 *
 * Publishing needs a live mandate, which does not exist yet at the moment of
 * creation — so `status` is not accepted here at all. It moves through PATCH,
 * which checks for the agreement first.
 */
export const POST = route(
  {
    module: 'listings',
    productModule: 'SALES',
    action: 'CREATE',
    body: createBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => {
    // The database enforces this too; catching it here names the field.
    if (body.listingType === 'RENT' && !body.rentFrequency) {
      throw Invalid([
        {
          field: 'rentFrequency',
          code: 'required',
          message: 'A rental needs to say whether that is per month or year.',
        },
      ]);
    }
    if (body.listingType === 'SALE' && body.rentFrequency) {
      throw Invalid([{ field: 'rentFrequency', code: 'not_applicable', message: 'A sale price has no frequency.' }]);
    }

    const owner = await prisma.owner.findFirst({
      where: { id: body.propertyOwnerId, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!owner) {
      throw Invalid([{ field: 'propertyOwnerId', code: 'not_found', message: 'Record the property owner first.' }]);
    }

    const listing = await withTx(ctx.tenantId, async (tx) => {
      const reference = await nextReference(tx, ctx.tenantId, 'LISTING');
      return tx.listing.create({
        data: {
          tenantId: ctx.tenantId,
          reference,
          // The agent who entered it owns it until somebody reassigns it.
          ownerId: ctx.actor.id,
          createdById: ctx.actor.id,
          updatedById: ctx.actor.id,
          ...body,
        },
        select: { ...LISTING_LIST_SELECT, propertyOwner: { select: { id: true, fullName: true, phone: true } } },
      });
    });

    return { ...listing, propertyOwner: maskOwner(ctx, listing.propertyOwner) };
  },
);
