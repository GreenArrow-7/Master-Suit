/**
 * One filter contract for the catalogue, shared by the list, the facet counts
 * and the CSV export.
 *
 * They must agree. A facet that says "Dubai Marina (42)" above a list that
 * shows 39 is worse than no facet at all, and the way that happens is two
 * places building the same `where` slightly differently.
 *
 * Every field here is backed by an index — see the migration. Adding a filter
 * without adding the index is how a catalogue that answered in 40 ms starts
 * answering in four seconds at the same row count, so the two belong in the
 * same change.
 */
import { z } from 'zod';
import type { Prisma } from '@prisma/client';

export const PROJECT_STATUSES = [
  'PLANNED',
  'PRE_LAUNCH',
  'LAUNCHED',
  'UNDER_CONSTRUCTION',
  'READY',
  'SOLD_OUT',
  'ON_HOLD',
] as const;

export const POSSESSION_STATUSES = ['READY_TO_MOVE', 'UNDER_CONSTRUCTION', 'NEW_LAUNCH'] as const;

/** Comma-separated in the query string, because these are checkbox facets. */
const csv = (max = 20) =>
  z
    .string()
    .max(500)
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, max)
        : undefined,
    );

export const catalogueFilters = z.object({
  q: z.string().max(120).optional(),
  micromarket: csv(),
  developer: csv(),
  status: csv(),
  possession: csv(),
  unitType: csv(),
  amenity: csv(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  /** Only projects with at least one unit still sellable. */
  availableOnly: z.coerce.boolean().default(false),
  priority: z.coerce.boolean().optional(),
  pitchable: z.coerce.boolean().optional(),
  favourites: z.coerce.boolean().default(false),
});

export type CatalogueFilters = z.infer<typeof catalogueFilters>;

/**
 * Builds the `where` for one tenant's catalogue.
 *
 * `favouriteIds` is passed in rather than joined, because the favourite set is
 * per user and tiny — an `IN` list of a few dozen ids beats a relation filter
 * that the planner has to resolve for every candidate row.
 */
export function catalogueWhere(
  tenantId: string,
  f: CatalogueFilters,
  favouriteIds?: string[],
): Prisma.ProjectWhereInput {
  const where: Prisma.ProjectWhereInput = { tenantId, deletedAt: null };

  // Trigram GIN handles the leading wildcard; without that index this is the
  // one filter here that degrades into a sequential scan.
  if (f.q) where.name = { contains: f.q, mode: 'insensitive' };

  if (f.micromarket?.length) where.micromarketId = { in: f.micromarket };
  if (f.developer?.length) where.developerId = { in: f.developer };
  if (f.status?.length) where.status = { in: f.status as Prisma.ProjectWhereInput['status'] as never };
  if (f.possession?.length) {
    where.possessionStatus = { in: f.possession as Prisma.ProjectWhereInput['possessionStatus'] as never };
  }

  // `hasSome`, not `hasEvery`: a buyer asking for a 2BHK *or* a 3BHK wants both
  // lists. "Must have all of these amenities" is a different question and no
  // one has asked it yet.
  if (f.unitType?.length) where.unitTypes = { hasSome: f.unitType };
  if (f.amenity?.length) where.amenityKeys = { hasSome: f.amenity };

  /**
   * A project whose band is entirely above the buyer's ceiling, or entirely
   * below their floor, is out.
   *
   * The `IS NULL` branch is not defensive padding. A plain `minPrice <= budget`
   * silently drops every project with no band recorded, because SQL comparisons
   * against NULL are never true — and "no band recorded" is a pre-launch, which
   * is exactly the inventory a salesperson wants surfaced when a buyer names a
   * budget. Hiding it is invisible: nobody learns the project exists.
   */
  const price: Prisma.ProjectWhereInput[] = [];
  if (f.minPrice != null) price.push({ OR: [{ maxPrice: { gte: f.minPrice } }, { maxPrice: null }] });
  if (f.maxPrice != null) price.push({ OR: [{ minPrice: { lte: f.maxPrice } }, { minPrice: null }] });
  if (price.length) where.AND = price;

  if (f.availableOnly) where.availableUnits = { gt: 0 };
  if (f.priority != null) where.isPriority = f.priority;
  if (f.pitchable != null) where.isPitchable = f.pitchable;
  if (f.favourites) where.id = { in: favouriteIds ?? [] };

  return where;
}

/** The columns the grid reads. Kept narrow: the catalogue never needs `description`. */
export const PROJECT_LIST_SELECT = {
  id: true,
  name: true,
  code: true,
  status: true,
  possessionStatus: true,
  possessionAt: true,
  minPrice: true,
  maxPrice: true,
  pricePerSqft: true,
  currency: true,
  unitTypes: true,
  totalUnits: true,
  availableUnits: true,
  soldUnits: true,
  isPriority: true,
  isPitchable: true,
  updatedAt: true,
  developer: { select: { id: true, name: true } },
  micromarket: { select: { id: true, name: true, city: true } },
} satisfies Prisma.ProjectSelect;
