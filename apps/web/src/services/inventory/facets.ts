/**
 * The catalogue's facet counts, against the same `where` the list reads, so
 * the numbers beside the filters and the rows below them agree. Read by
 * `/api/v1/projects/facets` and by the catalogue page's filter bar (M11-08),
 * inside one transaction: one connection however many groups.
 */
import type { Prisma } from '@prisma/client';
import type { TxClient } from '@/lib/db';

export async function catalogueFacets(tx: TxClient, where: Prisma.ProjectWhereInput) {
  const [byMicromarket, byDeveloper, byStatus, byPossession, total, available] = await Promise.all([
    tx.project.groupBy({ by: ['micromarketId'], where, _count: { _all: true } }),
    tx.project.groupBy({ by: ['developerId'], where, _count: { _all: true } }),
    tx.project.groupBy({ by: ['status'], where, _count: { _all: true } }),
    tx.project.groupBy({ by: ['possessionStatus'], where, _count: { _all: true } }),
    tx.project.count({ where }),
    tx.project.count({ where: { ...where, availableUnits: { gt: 0 } } }),
  ]);
  const counts = <K extends string>(rows: (Record<K, string | null> & { _count: { _all: number } })[], key: K) =>
    Object.fromEntries(rows.filter((r) => r[key]).map((r) => [r[key] as string, r._count._all])) as Record<
      string,
      number
    >;
  return {
    total,
    available,
    micromarket: counts(byMicromarket, 'micromarketId'),
    developer: counts(byDeveloper, 'developerId'),
    status: counts(byStatus, 'status'),
    possession: counts(byPossession, 'possessionStatus'),
  };
}
