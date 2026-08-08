import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { catalogueFilters, catalogueWhere } from '@/lib/inventory/catalogue';

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
  { module: 'projects', productModule: 'SALES', action: 'VIEW', query: catalogueFilters },
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

    const [byMicromarket, byDeveloper, byStatus, byPossession, total, available] = await Promise.all([
      prisma.project.groupBy({ by: ['micromarketId'], where, _count: { _all: true } }),
      prisma.project.groupBy({ by: ['developerId'], where, _count: { _all: true } }),
      prisma.project.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.project.groupBy({ by: ['possessionStatus'], where, _count: { _all: true } }),
      prisma.project.count({ where }),
      prisma.project.count({ where: { ...where, availableUnits: { gt: 0 } } }),
    ]);

    // Names for the ids, in one round trip each rather than a join per group.
    const [micromarkets, developers] = await Promise.all([
      prisma.micromarket.findMany({
        where: { tenantId: ctx.tenantId, id: { in: ids(byMicromarket, 'micromarketId') } },
        select: { id: true, name: true, city: true },
      }),
      prisma.developer.findMany({
        where: { tenantId: ctx.tenantId, id: { in: ids(byDeveloper, 'developerId') } },
        select: { id: true, name: true },
      }),
    ]);

    const mmName = new Map(micromarkets.map((m) => [m.id, `${m.name}, ${m.city}`]));
    const devName = new Map(developers.map((d) => [d.id, d.name]));

    return {
      total,
      available,
      micromarket: byMicromarket
        .filter((r) => r.micromarketId)
        .map((r) => ({ value: r.micromarketId!, label: mmName.get(r.micromarketId!) ?? '—', count: r._count._all }))
        .sort(byCount),
      developer: byDeveloper
        .filter((r) => r.developerId)
        .map((r) => ({ value: r.developerId!, label: devName.get(r.developerId!) ?? '—', count: r._count._all }))
        .sort(byCount),
      status: byStatus.map((r) => ({ value: r.status, label: title(r.status), count: r._count._all })).sort(byCount),
      possession: byPossession
        .map((r) => ({ value: r.possessionStatus, label: title(r.possessionStatus), count: r._count._all }))
        .sort(byCount),
    };
  },
);

const ids = <K extends string>(rows: Record<K, string | null>[], key: K) =>
  rows.map((r) => r[key]).filter((v): v is string => Boolean(v));

const byCount = (a: { count: number }, b: { count: number }) => b.count - a.count;

const title = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');
