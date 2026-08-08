import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import { columnsFor } from '@/lib/grid/resolve';
import { LISTING_LIST_SELECT, listingFilters, listingWhere } from '@/lib/inventory/listings';
import { expireLapsedMandates } from '@/services/inventory/mandates';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListingFilters from './ListingFilters';

export const metadata = { title: 'Listings' };

const PAGE_SIZE = 50;

/**
 * The listing book: resale and rental stock the agency holds a mandate on.
 *
 * Read by the whole floor, like the project catalogue. What is not shared is the
 * owner's phone number, which the API masks, and the ability to edit somebody
 * else's listing, which the PATCH route refuses.
 */
export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const raw = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['listings', 'VIEW'] });

  // Lapsed mandates take their listings off the market before the page renders,
  // so the book is never read showing an agreement that ended last week.
  const expired = await expireLapsedMandates(ctx.tenantId);

  const parsed = listingFilters.safeParse(raw);
  const filters = parsed.success ? parsed.data : listingFilters.parse({});
  const where = listingWhere(ctx.tenantId, filters, ctx.actor.id);

  const [rows, total, columns, micromarkets, expiringSoon] = await Promise.all([
    prisma.listing.findMany({
      where,
      select: LISTING_LIST_SELECT,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE,
    }),
    prisma.listing.count({ where }),
    columnsFor(ctx.tenantId, 'LISTING'),
    prisma.micromarket.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      select: { id: true, name: true, city: true },
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
      take: 200,
    }),
    // The chase number. A mandate ending inside a month is a phone call, and
    // putting it on the header is cheaper than hoping somebody filters for it.
    prisma.listing.count({
      where: {
        tenantId: ctx.tenantId,
        deletedAt: null,
        status: { in: ['ACTIVE', 'UNDER_OFFER'] },
        mandateExpires: { gt: new Date(), lte: new Date(Date.now() + 30 * 86_400_000) },
      },
    }),
  ]);

  return (
    <>
      <ListHeader
        title="Listings"
        description={
          <>
            {total.toLocaleString('en-GB')} listing{total === 1 ? '' : 's'}
            {total > PAGE_SIZE ? ` — showing the first ${PAGE_SIZE}` : ''}
            {expiringSoon > 0 && (
              <>
                {' · '}
                <SalesLink href="/listings?expiringWithinDays=30" style={{ color: 'var(--lf-brass)' }}>
                  {expiringSoon} mandate{expiringSoon === 1 ? '' : 's'} ending within 30 days
                </SalesLink>
              </>
            )}
          </>
        }
        actions={
          <>
            {can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
              <ColumnEditor object="LISTING" current={columns.map((c) => c.key)} />
            )}
            {can(ctx, 'listings', 'CREATE') && (
              <SalesLink className="lf-btn lf-btn--sm" href="/listings/new">
                Add listing
              </SalesLink>
            )}
          </>
        }
      />

      {expired > 0 && (
        <div className="lf-alert" role="status" style={{ marginBottom: 'var(--lf-space-3)' }}>
          {expired} mandate{expired === 1 ? '' : 's'} lapsed and{' '}
          {expired === 1 ? 'its listing was' : 'their listings were'} taken off the market.
        </div>
      )}

      <ListingFilters micromarkets={micromarkets} />

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="No listings match these filters"
            description={
              total === 0 && Object.keys(raw).length === 0
                ? 'Record a property owner, then add their listing and the mandate that lets you market it.'
                : 'Widen the price band or clear a facet to see more.'
            }
          />
        </div>
      ) : (
        <ConfigurableGrid object="LISTING" columns={columns} rows={rows as never} />
      )}
    </>
  );
}
