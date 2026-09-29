import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { problemsWith, type FeedListing, type PortalKey } from '@/lib/inventory/portalFeed';

/**
 * Where one listing is advertised.
 *
 * The GET answers with the problems as well as the state, because "it is
 * published and not appearing" is the question this screen exists to answer,
 * and the reason has to be visible before somebody ticks a box rather than
 * hours later when a portal has quietly dropped it.
 */
const PORTALS = ['PROPERTY_FINDER', 'BAYUT', 'DUBIZZLE', 'WEBSITE'] as const;

const SELECT = {
  id: true,
  reference: true,
  title: true,
  description: true,
  listingType: true,
  status: true,
  propertyType: true,
  bedrooms: true,
  bathrooms: true,
  areaSqft: true,
  price: true,
  currency: true,
  rentFrequency: true,
  address: true,
  latitude: true,
  longitude: true,
  amenityKeys: true,
  permitNumber: true,
  permitExpiry: true,
  mandateExpires: true,
  updatedAt: true,
  ownerId: true,
  micromarket: { select: { name: true } },
  media: { where: { kind: 'IMAGE' as const }, select: { id: true, storageKey: true, externalUrl: true } },
} as const;

async function stateOf(tenantId: string, listingId: string) {
  return withTx(tenantId, async (tx) => {
    const listing = await tx.listing.findFirst({
      where: { id: listingId, tenantId, deletedAt: null },
      select: SELECT,
    });
    if (!listing) throw NotFound('Listing');

    const publications = await tx.listingPublication.findMany({
      where: { tenantId, listingId },
      select: { portal: true, isPublished: true, lastError: true },
    });

    const shaped = { ...listing, owner: null } as unknown as FeedListing;

    return {
      portals: PORTALS.map((portal) => {
        const publication = publications.find((row) => row.portal === portal);
        return {
          portal,
          isPublished: publication?.isPublished ?? false,
          // Computed now rather than read from the last build: an agent who
          // just added a photograph should see that, not yesterday's verdict.
          problems: problemsWith(shaped, portal),
          lastError: publication?.lastError ?? null,
        };
      }),
    };
  });
}

export const GET = route(
  { module: 'listings', productModule: 'SALES', action: 'VIEW', params: z.object({ id: z.string() }) },
  async ({ ctx, params }) => stateOf(ctx.tenantId, params.id),
);

const body = z.object({ portals: z.array(z.enum(PORTALS)) });

export const PATCH = route(
  {
    module: 'listings',
    productModule: 'SALES',
    action: 'EDIT',
    params: z.object({ id: z.string() }),
    body,
  },
  async ({ ctx, params, body }) => {
    await withTx(ctx.tenantId, async (tx) => {
      const listing = await tx.listing.findFirst({
        where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!listing) throw NotFound('Listing');

      for (const portal of PORTALS) {
        const wanted = body.portals.includes(portal);
        const existing = await tx.listingPublication.findFirst({
          where: { tenantId: ctx.tenantId, listingId: params.id, portal },
          select: { id: true, isPublished: true },
        });

        if (existing) {
          if (existing.isPublished !== wanted) {
            await tx.listingPublication.updateMany({
              where: { id: existing.id, tenantId: ctx.tenantId },
              data: {
                isPublished: wanted,
                // Cleared on the way down: a reason recorded against a
                // listing nobody is publishing any more is noise.
                publishedAt: wanted ? new Date() : null,
                lastError: null,
              },
            });
          }
        } else if (wanted) {
          await tx.listingPublication.create({
            data: {
              tenantId: ctx.tenantId,
              listingId: params.id,
              portal: portal as PortalKey,
              isPublished: true,
              publishedAt: new Date(),
            },
          });
        }
      }
    });

    return stateOf(ctx.tenantId, params.id);
  },
);
