import { LEAD_MODULES } from '@/lib/security/entitlements';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { catalogueFilters, catalogueWhere } from '@/lib/inventory/catalogue';
import { catalogueFacets } from '@/services/inventory/facets';

/**
 * Counts for the filter sidebar, computed against the *same* `where` the list
 * uses so the numbers above the results and the results themselves agree.
 *
 * Deliberately not "faceted search" in the search-engine sense: each count is a
 * grouped aggregate over the current filter, so selecting Dubai Marina narrows
 * the developer counts too. That is what a user expects, and it is what a
 * `GROUP BY` over an indexed column gives without a second system to operate.
 *
 * The array facets — unit type and amenity — are counted with `unnest`, because
 * Prisma cannot group by an element of an array column. The GIN indexes serve
 * the filtering; this aggregate is a scan of the already-filtered set, which is
 * small by the time a user is looking at facets.
 */
export const GET = route(
  { module: 'projects', productModule: LEAD_MODULES, action: 'VIEW', query: catalogueFilters },
  async ({ ctx, query }) => {
    const favouriteIds = query.favourites
      ? (
          await prisma.projectFavourite.findMany({
            where: { tenantId: ctx.tenantId, userId: ctx.actor.id },
            select: { projectId: true },
          })
        ).map((f) => f.projectId)
      : undefined;

    const where = catalogueWhere(ctx.tenantId, query, favouriteIds);
    const facets = await withTx(ctx.tenantId, (tx) => catalogueFacets(tx, where));

    // Names for the ids, in one round trip each rather than a join per group.
    const [micromarkets, developers] = await Promise.all([
      prisma.micromarket.findMany({
        where: { tenantId: ctx.tenantId, id: { in: Object.keys(facets.micromarket) } },
        select: { id: true, name: true, city: true },
      }),
      prisma.developer.findMany({
        where: { tenantId: ctx.tenantId, id: { in: Object.keys(facets.developer) } },
        select: { id: true, name: true },
      }),
    ]);

    const mmName = new Map(micromarkets.map((m) => [m.id, `${m.name}, ${m.city}`]));
    const devName = new Map(developers.map((d) => [d.id, d.name]));
    const rows = (counts: Record<string, number>, label: (value: string) => string) =>
      Object.entries(counts)
        .map(([value, count]) => ({ value, label: label(value), count }))
        .sort(byCount);

    return {
      total: facets.total,
      available: facets.available,
      micromarket: rows(facets.micromarket, (id) => mmName.get(id) ?? '—'),
      developer: rows(facets.developer, (id) => devName.get(id) ?? '—'),
      status: rows(facets.status, title),
      possession: rows(facets.possession, title),
    };
  },
);

const byCount = (a: { count: number }, b: { count: number }) => b.count - a.count;

const title = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');
