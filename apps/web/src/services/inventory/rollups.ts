/**
 * The denormalised fields on Project, and the only thing allowed to write them.
 *
 * Price band, area band and unit counts are stored rather than derived because
 * the catalogue filters and sorts on them at 100k rows, where a correlated
 * aggregate per row is the difference between 40 ms and four seconds. The cost
 * of that decision is drift, so every writer of a UnitPlan or a UnitInventory
 * row calls this in the same transaction — never afterwards, and never from a
 * cron that "fixes it up later", because a catalogue showing stale availability
 * is a salesperson pitching a sold flat.
 */
import type { TxClient } from '@/lib/db';
import { Prisma } from '@prisma/client';

export interface Rollups {
  minPrice: Prisma.Decimal | null;
  maxPrice: Prisma.Decimal | null;
  pricePerSqft: Prisma.Decimal | null;
  minAreaSqft: number | null;
  maxAreaSqft: number | null;
  unitTypes: string[];
  totalUnits: number;
  availableUnits: number;
  soldUnits: number;
}

export async function recalculateProjectRollups(tx: TxClient, tenantId: string, projectId: string): Promise<Rollups> {
  const [plans, counts] = await Promise.all([
    tx.unitPlan.findMany({
      where: { tenantId, projectId },
      select: { price: true, carpetAreaSqft: true, builtUpAreaSqft: true, unitType: true },
    }),
    tx.unitInventory.groupBy({
      by: ['status'],
      where: { tenantId, projectId },
      _count: { _all: true },
    }),
  ]);

  const prices = plans.map((p) => p.price).filter((p): p is Prisma.Decimal => p != null);
  // Saleable area, with carpet preferred: it is the number a buyer is quoted
  // against in this market, and mixing the two produces a price-per-sqft that
  // compares nothing to anything.
  const areas = plans
    .map((p) => p.carpetAreaSqft ?? p.builtUpAreaSqft)
    .filter((a): a is number => typeof a === 'number' && a > 0);

  const minPrice = prices.length ? prices.reduce((a, b) => (a.lt(b) ? a : b)) : null;
  const maxPrice = prices.length ? prices.reduce((a, b) => (a.gt(b) ? a : b)) : null;

  /**
   * Price per square foot is the mean across plans, each computed on its own
   * area — not `minPrice / minAreaSqft`, which is a different and wrong number
   * whenever the cheapest plan is not also the smallest.
   */
  const rates = plans
    .map((p) => {
      const area = p.carpetAreaSqft ?? p.builtUpAreaSqft;
      return p.price && area && area > 0 ? p.price.div(area) : null;
    })
    .filter((r): r is Prisma.Decimal => r != null);
  const pricePerSqft = rates.length
    ? rates
        .reduce((a, b) => a.add(b), new Prisma.Decimal(0))
        .div(rates.length)
        .toDecimalPlaces(2)
    : null;

  const by = (status: string) => counts.find((c) => c.status === status)?._count._all ?? 0;
  const totalUnits = counts.reduce((sum, c) => sum + c._count._all, 0);

  const rollups: Rollups = {
    minPrice,
    maxPrice,
    pricePerSqft,
    minAreaSqft: areas.length ? Math.min(...areas) : null,
    maxAreaSqft: areas.length ? Math.max(...areas) : null,
    unitTypes: [...new Set(plans.map((p) => p.unitType).filter(Boolean))].sort(),
    totalUnits,
    availableUnits: by('AVAILABLE'),
    // BOOKED counts as sold for the catalogue. A salesperson asking "how much
    // is gone" means "how much can I not sell", and a booked unit cannot be
    // sold twice. The two are still distinct on the unit itself.
    soldUnits: by('SOLD') + by('BOOKED'),
  };

  await tx.project.update({ where: { id: projectId, tenantId }, data: rollups });
  return rollups;
}
