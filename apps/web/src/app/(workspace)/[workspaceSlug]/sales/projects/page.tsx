import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import { columnsFor } from '@/lib/grid/resolve';
import { catalogueFilters, catalogueWhere, PROJECT_LIST_SELECT } from '@/lib/inventory/catalogue';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ProjectFilters from './ProjectFilters';

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
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['projects', 'VIEW'] });

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

  const [rows, total, columns, micromarkets, developers] = await Promise.all([
    prisma.project.findMany({
      where,
      select: PROJECT_LIST_SELECT,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE,
    }),
    prisma.project.count({ where }),
    columnsFor(ctx.tenantId, 'PROJECT'),
    prisma.micromarket.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      select: { id: true, name: true, city: true },
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
      take: 200,
    }),
    prisma.developer.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 200,
    }),
  ]);

  const mayCreate = can(ctx, 'projects', 'CREATE');

  return (
    <>
      <ListHeader
        title="Projects"
        description={
          <>
            {total.toLocaleString('en-GB')} project{total === 1 ? '' : 's'}
            {total > PAGE_SIZE ? ` — showing the first ${PAGE_SIZE}` : ''}
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

      <ProjectFilters micromarkets={micromarkets} developers={developers} />

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="No projects match these filters"
            description={
              total === 0 && Object.keys(raw).length === 0
                ? 'Add a project, or import the catalogue, to start pitching from live inventory.'
                : 'Widen the price band or clear a facet to see more.'
            }
          />
        </div>
      ) : (
        <ConfigurableGrid object="PROJECT" columns={columns} rows={rows as never} />
      )}
    </>
  );
}
