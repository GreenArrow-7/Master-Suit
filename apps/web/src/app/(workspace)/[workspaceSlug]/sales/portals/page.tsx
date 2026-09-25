import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { problemsWith, type FeedListing, type PortalKey } from '@/lib/inventory/portalFeed';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import PortalFeeds from './PortalFeeds';

export const metadata = { title: 'Portals' };

const PORTALS: { key: PortalKey; label: string }[] = [
  { key: 'PROPERTY_FINDER', label: 'Property Finder' },
  { key: 'BAYUT', label: 'Bayut' },
  { key: 'DUBIZZLE', label: 'dubizzle' },
  { key: 'WEBSITE', label: 'Your own website' },
];

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
  micromarket: { select: { name: true } },
  media: { where: { kind: 'IMAGE' as const }, select: { id: true, storageKey: true, externalUrl: true } },
  publications: { select: { portal: true, isPublished: true } },
} as const;

/**
 * What is advertised, where, and what is stopping the rest.
 *
 * The problems are at the top because a brokerage with two hundred listings
 * does not read a list — it fixes what is flagged. A portal that drops a
 * listing never says so, so this screen is the only place the reason appears.
 */
export default async function PortalsPage() {
  // EDIT rather than VIEW: a feed address is a credential, and this page
  // shows it.
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['listings', 'EDIT'] });

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: ctx.tenantId },
    select: { slug: true },
  });

  const feeds = await prisma.portalFeed.findMany({
    where: { tenantId: ctx.tenantId },
    select: { portal: true, feedKey: true, isActive: true, lastBuiltAt: true, lastItemCount: true },
  });

  const listings = await prisma.listing.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select: SELECT,
  });

  const rows = listings.map((listing) => {
    const published = listing.publications
      .filter((publication) => publication.isPublished)
      .map((publication) => String(publication.portal) as PortalKey);

    // Checked against the strictest portal it is actually on, so the warning
    // matches what will happen rather than a worst case it never meets.
    const strictest: PortalKey = published.find((portal) => portal !== 'WEBSITE') ?? published[0] ?? 'WEBSITE';

    return {
      id: listing.id,
      reference: listing.reference,
      title: listing.title,
      status: String(listing.status),
      community: listing.micromarket?.name ?? null,
      published,
      problems:
        published.length > 0 ? problemsWith({ ...listing, owner: null } as unknown as FeedListing, strictest) : [],
    };
  });

  rows.sort((a, b) => b.problems.length - a.problems.length);
  const blocked = rows.filter((row) => row.problems.length > 0).length;

  return (
    <>
      <ListHeader
        title="Portals"
        description={
          blocked > 0
            ? `${blocked} published ${blocked === 1 ? 'listing is' : 'listings are'} being left out of the feed. A portal does not tell you when it drops one, so the reason is here.`
            : 'Everything published is going out.'
        }
      />

      <PortalFeeds
        portals={PORTALS.map((portal) => {
          const feed = feeds.find((row) => String(row.portal) === portal.key);
          return {
            ...portal,
            isActive: feed?.isActive ?? false,
            // Only meaningful once live, and a key shown beside a switched-off
            // feed is a key somebody pastes into a portal anyway.
            path: feed?.isActive ? `/api/v1/feeds/${tenant.slug}/${feed.feedKey}` : null,
            lastBuiltAt: feed?.lastBuiltAt?.toISOString() ?? null,
            lastItemCount: feed?.lastItemCount ?? 0,
          };
        })}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No listings yet"
          description="Add a listing to the book and it can be published to a portal from here."
        />
      ) : (
        <div className="lf-card" style={{ overflowX: 'auto' }}>
          <table className="lf-table">
            <thead>
              <tr>
                <th>Listing</th>
                <th>On</th>
                <th>Problem</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <a href={`../listings/${row.id}`}>{row.title}</a>
                    <span style={{ display: 'block', fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
                      {row.reference}
                      {row.community ? ` · ${row.community}` : ''} · {row.status.toLowerCase()}
                    </span>
                  </td>
                  <td>
                    {row.published.length === 0 ? (
                      <span style={{ color: 'var(--lf-ink-3)' }}>—</span>
                    ) : (
                      row.published.map((portal) => (
                        <Badge key={portal} tone="slate">
                          {PORTALS.find((entry) => entry.key === portal)?.label ?? portal}
                        </Badge>
                      ))
                    )}
                  </td>
                  <td style={{ maxWidth: '28rem' }}>
                    {row.problems.length > 0 ? (
                      <span style={{ color: 'var(--lf-vermillion, #B3261E)' }}>{row.problems.join('; ')}</span>
                    ) : (
                      <span style={{ color: 'var(--lf-ink-3)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
