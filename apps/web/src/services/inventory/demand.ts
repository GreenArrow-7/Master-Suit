/**
 * The demand check: which live stock answers which open requirement.
 *
 * Both directions, because both questions get asked. An agent opening a client
 * asks "what can I show them"; an agent taking on a property asks "who wanted
 * this". They are the same predicate read from opposite ends, so it is written
 * once here rather than twice in two routes that would drift.
 *
 * Deliberately not a scoring engine. A weighted model would need somebody to
 * decide that a bedroom is worth 0.3 of a micromarket, nobody has, and an
 * invented number dressed as relevance is worse than an honest filter. The hard
 * criteria filter; the ordering is closeness to the middle of the stated budget,
 * which is the one preference a client has actually expressed.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/** Purpose maps to listing type. A buyer is not shown rentals. */
const TYPE_FOR: Record<string, 'SALE' | 'RENT'> = { BUY: 'SALE', RENT: 'RENT' };

/** Only stock the agency may actually show. */
const MARKETABLE = ['ACTIVE', 'UNDER_OFFER'] as const;

export interface Requirement {
  id: string;
  purpose: string;
  propertyTypes: string[];
  micromarketIds: string[];
  bedroomsMin: number | null;
  bedroomsMax: number | null;
  areaMinSqft: number | null;
  budgetMin: Prisma.Decimal | null;
  budgetMax: Prisma.Decimal | null;
  possessionBy: Date | null;
  furnishing: string | null;
}

/**
 * The `where` a requirement implies.
 *
 * Every optional criterion is skipped when the client did not state it — an
 * empty `propertyTypes` means "any", not "none". That asymmetry is the whole
 * reason this is a function rather than an object spread: a naive builder that
 * emits `propertyType IN ()` returns nothing and looks like there is no stock.
 */
export function listingsMatching(tenantId: string, r: Requirement): Prisma.ListingWhereInput {
  const where: Prisma.ListingWhereInput = {
    tenantId,
    deletedAt: null,
    status: { in: [...MARKETABLE] },
    listingType: TYPE_FOR[r.purpose] ?? 'SALE',
  };

  if (r.propertyTypes.length) where.propertyType = { in: r.propertyTypes as never };
  if (r.micromarketIds.length) where.micromarketId = { in: r.micromarketIds };

  // Bedrooms: a listing that has not recorded them stays in. "Unknown" is not
  // "wrong", and excluding it hides stock over a field nobody filled in.
  const bedrooms: Prisma.ListingWhereInput[] = [];
  if (r.bedroomsMin != null) bedrooms.push({ OR: [{ bedrooms: { gte: r.bedroomsMin } }, { bedrooms: null }] });
  if (r.bedroomsMax != null) bedrooms.push({ OR: [{ bedrooms: { lte: r.bedroomsMax } }, { bedrooms: null }] });
  if (r.areaMinSqft != null) bedrooms.push({ OR: [{ areaSqft: { gte: r.areaMinSqft } }, { areaSqft: null }] });

  // Budget is the one criterion applied strictly. Showing somebody a property
  // at twice their stated ceiling is how an agent loses the client, and a price
  // is never "not recorded" — the column is required.
  if (r.budgetMin != null) bedrooms.push({ price: { gte: r.budgetMin } });
  if (r.budgetMax != null) bedrooms.push({ price: { lte: r.budgetMax } });

  // "I need to be in by March": anything available on or before that date, plus
  // anything with no date recorded, which in practice means available now.
  if (r.possessionBy) {
    bedrooms.push({ OR: [{ availableFrom: { lte: r.possessionBy } }, { availableFrom: null }] });
  }
  if (r.furnishing) bedrooms.push({ OR: [{ furnishing: r.furnishing as never }, { furnishing: null }] });

  if (bedrooms.length) where.AND = bedrooms;
  return where;
}

const LISTING_MATCH_SELECT = {
  id: true,
  reference: true,
  title: true,
  listingType: true,
  propertyType: true,
  status: true,
  price: true,
  currency: true,
  rentFrequency: true,
  bedrooms: true,
  bathrooms: true,
  areaSqft: true,
  furnishing: true,
  availableFrom: true,
  mandateExpires: true,
  micromarket: { select: { id: true, name: true, city: true } },
} satisfies Prisma.ListingSelect;

/** What can I show this client? */
export async function matchesForRequirement(tenantId: string, requirementId: string, limit = 25) {
  const requirement = await prisma.clientRequirement.findFirst({
    where: { id: requirementId, tenantId, deletedAt: null },
  });
  if (!requirement) return null;

  const rows = await prisma.listing.findMany({
    where: listingsMatching(tenantId, requirement as Requirement),
    select: LISTING_MATCH_SELECT,
    // Bounded generously: an agent scans a shortlist, not a catalogue.
    take: 200,
  });

  return { requirement, matches: rankByBudget(rows, requirement.budgetMin, requirement.budgetMax).slice(0, limit) };
}

/**
 * Who wanted this?
 *
 * The inverse predicate, expressed against the requirement table. It cannot
 * reuse `listingsMatching` — that builds a Listing where-clause — so the two
 * live side by side and the test asserts they agree on the same pair.
 */
export async function requirementsWanting(tenantId: string, listingId: string, limit = 25) {
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, tenantId, deletedAt: null },
  });
  if (!listing) return null;

  const purpose = listing.listingType === 'RENT' ? 'RENT' : 'BUY';
  const price = listing.price;

  const requirements = await prisma.clientRequirement.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: 'OPEN',
      purpose,
      // An unstated criterion matches everything, so each clause is
      // "not stated OR satisfied" — the mirror of listingsMatching.
      AND: [
        { OR: [{ propertyTypes: { isEmpty: true } }, { propertyTypes: { has: listing.propertyType } }] },
        listing.micromarketId
          ? { OR: [{ micromarketIds: { isEmpty: true } }, { micromarketIds: { has: listing.micromarketId } }] }
          : { micromarketIds: { isEmpty: true } },
        { OR: [{ budgetMin: null }, { budgetMin: { lte: price } }] },
        { OR: [{ budgetMax: null }, { budgetMax: { gte: price } }] },
        ...(listing.bedrooms != null
          ? [
              { OR: [{ bedroomsMin: null }, { bedroomsMin: { lte: listing.bedrooms } }] },
              { OR: [{ bedroomsMax: null }, { bedroomsMax: { gte: listing.bedrooms } }] },
            ]
          : []),
        ...(listing.areaSqft != null
          ? [{ OR: [{ areaMinSqft: null }, { areaMinSqft: { lte: listing.areaSqft } }] }]
          : []),
      ],
    },
    select: {
      id: true,
      purpose: true,
      budgetMin: true,
      budgetMax: true,
      currency: true,
      bedroomsMin: true,
      bedroomsMax: true,
      possessionBy: true,
      notes: true,
      ownerId: true,
      createdAt: true,
      leadId: true,
      contactId: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return { listing, requirements };
}

/**
 * Closest to the middle of the stated budget first.
 *
 * With no budget stated there is nothing to be close to, so the original order
 * stands. Sorted here rather than in SQL because the key is a distance from a
 * value, which no index can serve, and the set is already bounded.
 */
function rankByBudget<T extends { price: Prisma.Decimal }>(
  rows: T[],
  min: Prisma.Decimal | null,
  max: Prisma.Decimal | null,
): T[] {
  if (!min && !max) return rows;
  const target = min && max ? min.add(max).div(2) : (max ?? min)!;
  return [...rows].sort((a, b) => a.price.minus(target).abs().comparedTo(b.price.minus(target).abs()));
}
