import { requirePageAccess } from '@/lib/workspace-page';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { prisma, withTx } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import { columnsFor } from '@/lib/grid/resolve';
import { catalogueFilters, catalogueWhere, PROJECT_LIST_SELECT } from '@/lib/inventory/catalogue';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ProjectFilters from './ProjectFilters';
import Pager from '@/components/workspace/Pager';
import InventoryViews from '@/components/workspace/InventoryViews';
import { catalogueFacets } from '@/services/inventory/facets';
import { listViews } from '@/services/inventory/views';

export const metadata = { title: 'Projects' };

const PAGE_SIZE = 50;

/**
 * The project catalogue.
 *
 * Server-rendered against the same `catalogueWhere` the API uses, so the first
 * paint is the real result set rather than a spinner that then disagrees with
 * itself. The filters are links, not client state: a filtered catalogue is
 * something a salesperson sends to a colleague, and that only works if the URL
 * carries the whole query.
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const raw = await searchParams;
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['projects', 'VIEW'] });

  // Unparseable filters fall back to none rather than throwing: a hand-edited
  // URL should show the catalogue, not an error page.
  const parsed = catalogueFilters.safeParse(raw);
  const filters = parsed.success ? parsed.data : catalogueFilters.parse({});

  const favouriteIds = filters.favourites
    ? (
        await prisma.projectFavourite.findMany({
          where: { tenantId: ctx.tenantId, userId: ctx.actor.id },
          select: { projectId: true },
        })
      ).map((f) => f.projectId)
    : undefined;

  const where = catalogueWhere(ctx.tenantId, filters, favouriteIds);
  // ponytail: OFFSET pages (M11-08); a keyset like the lead grid's (leadPage) when a catalogue passes ~10,000 projects.
  const page = Math.max(1, Math.min(10_000, Number(raw.page) || 1));

  const [found, columns, [micromarkets, developers, amenities], views] = await Promise.all([
    prisma.project.findMany({
      where,
      select: PROJECT_LIST_SELECT,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
    }),
    columnsFor(ctx.tenantId, 'PROJECT'),
    withTx(ctx.tenantId, (tx) =>
      Promise.all([
        tx.micromarket.findMany({
          where: { tenantId: ctx.tenantId, isActive: true },
          select: { id: true, name: true, city: true },
          orderBy: [{ city: 'asc' }, { name: 'asc' }],
          take: 200,
        }),
        tx.developer.findMany({
          where: { tenantId: ctx.tenantId, isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
          take: 200,
        }),
        tx.amenity.findMany({
          where: { tenantId: ctx.tenantId },
          select: { key: true, label: true },
          orderBy: [{ category: 'asc' }, { position: 'asc' }],
          take: 200,
        }),
      ]),
    ),
    listViews(ctx, 'PROJECT'),
  ]);
  // The facet counts the filter bar shows, and the total, from the same `where` (M11-08).
  const facets = await withTx(ctx.tenantId, (tx) => catalogueFacets(tx, where));
  const total = facets.total;
  const rows = found.slice(0, PAGE_SIZE);
  const { page: _page, ...kept } = raw;

  const mayCreate = can(ctx, 'projects', 'CREATE');

  return (
    <>
      <ListHeader
        title="Projects"
        description={
          <>
            {total.toLocaleString('en-GB')} project{total === 1 ? '' : 's'}
            {total > PAGE_SIZE && rows.length
              ? ` — showing ${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + rows.length}`
              : ''}
          </>
        }
        actions={
          <>
            {can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
              <ColumnEditor object="PROJECT" current={columns.map((c) => c.key)} />
            )}
            {mayCreate && (
              <SalesLink className="lf-btn lf-btn--sm" href="/projects/new">
                Add project
              </SalesLink>
            )}
          </>
        }
      />

      <InventoryViews endpoint="/api/v1/projects/views" listPath="/projects" views={views} />

      <ProjectFilters micromarkets={micromarkets} developers={developers} amenities={amenities} counts={facets} />

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title={Object.keys(raw).length === 0 ? 'No projects yet' : 'No projects match these filters'}
            description={
              Object.keys(raw).length === 0
                ? mayCreate
                  ? 'Add the first project to start pitching from live inventory.'
                  : 'Projects appear here once someone with catalogue access adds them.'
                : 'Widen the price band or clear a filter to see more.'
            }
            actionLabel={Object.keys(raw).length === 0 && mayCreate ? 'Add project' : undefined}
            actionHref={Object.keys(raw).length === 0 && mayCreate ? '/projects/new' : undefined}
          />
        </div>
      ) : (
        <ConfigurableGrid object="PROJECT" columns={columns} rows={rows as never} />
      )}
      <Pager page={page} hasMore={found.length > PAGE_SIZE} basePath="/projects" params={kept} />
    </>
  );
}
