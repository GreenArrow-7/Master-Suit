import { randomBytes } from 'node:crypto';
import { withTx } from '@/lib/db';
import { listingImageLink } from '@/lib/inventory/listingImageLink';
import { renderFeed, type FeedListing, type PortalKey } from '@/lib/inventory/portalFeed';

/**
 * Building a portal feed, and recording why anything was left out.
 *
 * Built on request rather than on a schedule: a brokerage has hundreds of
 * listings rather than millions, portals fetch every few hours, and a cached
 * file that is four hours stale is the thing agents complain about.
 */

/** Long enough that the address is the credential it has to be. */
export function newFeedKey(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Columns the feed and its checks need, and nothing else.
 *
 * Written as a const so the query and the `FeedListing` type cannot drift: a
 * column dropped here becomes a type error there rather than a field that is
 * silently empty in a file a portal is reading.
 */
const FEED_SELECT = {
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
  micromarket: { select: { name: true } },
  /// The agent, resolved separately below: `Listing.ownerId` carries the id
  /// but the schema declares no relation to User, and adding one would mean a
  /// foreign key migration on a live table to save a second query.
  ownerId: true,
  media: {
    where: { kind: 'IMAGE' as const },
    orderBy: { position: 'asc' as const },
    take: 25,
    select: { id: true, storageKey: true, externalUrl: true },
  },
} as const;

export interface BuiltFeed {
  xml: string;
  included: number;
}

export async function buildFeed(tenantId: string, portal: PortalKey): Promise<BuiltFeed> {
  return withTx(tenantId, async (tx) => {
    const agency = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { displayName: true, legalName: true, companyPhone: true },
    });
    const branding = await tx.organizationSetting.findUnique({
      where: { tenantId },
      select: { reraOrn: true },
    });

    const publications = await tx.listingPublication.findMany({
      where: { tenantId, portal, isPublished: true },
      select: { id: true, listingId: true, lastError: true, listing: { select: FEED_SELECT } },
    });

    const rows = publications
      .map((publication) => publication.listing)
      .filter((listing): listing is NonNullable<typeof listing> => Boolean(listing));

    // One lookup for every agent named on the page, rather than one per row.
    const agentIds = [...new Set(rows.map((row) => row.ownerId).filter((id): id is string => Boolean(id)))];
    const agents = agentIds.length
      ? await tx.user.findMany({
          where: { tenantId, id: { in: agentIds } },
          select: { id: true, fullName: true, email: true, phone: true },
        })
      : [];
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));

    const listings = rows.map((row) => ({
      ...row,
      owner: row.ownerId ? (agentById.get(row.ownerId) ?? null) : null,
    })) as unknown as FeedListing[];

    // Signed on render rather than stored as URLs: the bucket is private, and
    // a link that leaks should stop working rather than never expire. Long
    // lived on purpose — a portal fetches the feed on its own schedule and the
    // images later still, and a link that expires first is a listing with no
    // pictures.
    const imageUrls = new Map<string, string[]>();
    for (const listing of listings) {
      imageUrls.set(
        listing.id,
        listing.media
          .map((item) => (item.externalUrl ? item.externalUrl : listingImageLink.url(tenantId, item.id)))
          .filter((url): url is string => Boolean(url)),
      );
    }

    const built = renderFeed(
      listings,
      portal,
      {
        name: agency.displayName || agency.legalName,
        licenceNumber: branding?.reraOrn ?? null,
        phone: agency.companyPhone,
      },
      imageUrls,
    );

    // Every pairing has its reason refreshed, including the ones that are now
    // fine. A stale complaint about a photograph added last week is worse than
    // no complaint at all.
    for (const publication of publications) {
      const reason = built.rejected.get(publication.listingId) ?? null;
      if (reason !== publication.lastError) {
        // `updateMany` with the tenant in the filter rather than `update` by
        // id: the tenant guard requires it on every query, and a write scoped
        // only by a primary key is the shape it exists to refuse.
        await tx.listingPublication.updateMany({
          where: { id: publication.id, tenantId },
          data: { lastError: reason },
        });
      }
    }

    await tx.portalFeed.updateMany({
      where: { tenantId, portal },
      data: { lastBuiltAt: new Date(), lastItemCount: built.included },
    });

    return { xml: built.xml, included: built.included };
  });
}
