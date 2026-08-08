/**
 * The filter contract for the listing book, and the one place an owner's
 * contact details are decided to be visible.
 *
 * Mirrors lib/inventory/catalogue.ts deliberately: same shape, same rules about
 * unstated criteria, same requirement that every filter be backed by an index.
 */
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { can, type Ctx } from '@/lib/security/rbac';

export const LISTING_TYPES = ['SALE', 'RENT'] as const;
export const LISTING_STATUSES = ['DRAFT', 'ACTIVE', 'UNDER_OFFER', 'SOLD', 'RENTED', 'WITHDRAWN', 'EXPIRED'] as const;
export const PROPERTY_TYPES = [
  'APARTMENT',
  'VILLA',
  'TOWNHOUSE',
  'PENTHOUSE',
  'PLOT',
  'OFFICE',
  'RETAIL',
  'WAREHOUSE',
] as const;
export const FURNISHINGS = ['UNFURNISHED', 'SEMI_FURNISHED', 'FURNISHED'] as const;
export const RENT_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export const MANDATE_TYPES = ['EXCLUSIVE', 'NON_EXCLUSIVE', 'OPEN'] as const;

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

export const listingFilters = z.object({
  q: z.string().max(120).optional(),
  listingType: z.enum(LISTING_TYPES).optional(),
  status: csv(),
  propertyType: csv(),
  micromarket: csv(),
  amenity: csv(),
  mandateType: csv(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  bedroomsMin: z.coerce.number().int().min(0).max(50).optional(),
  furnishing: z.enum(FURNISHINGS).optional(),
  /** Only what the agency may actually show today. */
  marketableOnly: z.coerce.boolean().default(false),
  /** Live mandates ending within N days — the chase list. */
  expiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  mine: z.coerce.boolean().default(false),
});

export type ListingFilters = z.infer<typeof listingFilters>;

export function listingWhere(tenantId: string, f: ListingFilters, actorId?: string): Prisma.ListingWhereInput {
  const where: Prisma.ListingWhereInput = { tenantId, deletedAt: null };

  if (f.q) where.title = { contains: f.q, mode: 'insensitive' };
  if (f.listingType) where.listingType = f.listingType;
  if (f.status?.length) where.status = { in: f.status as never };
  if (f.propertyType?.length) where.propertyType = { in: f.propertyType as never };
  if (f.micromarket?.length) where.micromarketId = { in: f.micromarket };
  if (f.amenity?.length) where.amenityKeys = { hasSome: f.amenity };
  if (f.mandateType?.length) where.mandateType = { in: f.mandateType as never };
  if (f.furnishing) where.furnishing = f.furnishing;
  if (f.bedroomsMin != null) where.bedrooms = { gte: f.bedroomsMin };
  if (f.mine && actorId) where.ownerId = actorId;

  // Marketable means "has a live mandate and is on the market", which is two
  // facts. Both are on the row, so neither costs a join.
  if (f.marketableOnly) {
    where.status = { in: ['ACTIVE', 'UNDER_OFFER'] };
    where.mandateExpires = { gt: new Date() };
  }

  if (f.expiringWithinDays != null) {
    const until = new Date(Date.now() + f.expiringWithinDays * 86_400_000);
    where.mandateExpires = { gt: new Date(), lte: until };
  }

  // Price is a required column on a listing, so unlike the project catalogue
  // there is no "not recorded" case to keep.
  const price: Prisma.ListingWhereInput[] = [];
  if (f.minPrice != null) price.push({ price: { gte: f.minPrice } });
  if (f.maxPrice != null) price.push({ price: { lte: f.maxPrice } });
  if (price.length) where.AND = price;

  return where;
}

export const LISTING_LIST_SELECT = {
  id: true,
  reference: true,
  title: true,
  listingType: true,
  status: true,
  propertyType: true,
  price: true,
  currency: true,
  rentFrequency: true,
  bedrooms: true,
  bathrooms: true,
  areaSqft: true,
  furnishing: true,
  mandateType: true,
  mandateExpires: true,
  availableFrom: true,
  updatedAt: true,
  micromarket: { select: { id: true, name: true, city: true } },
  propertyOwner: { select: { id: true, fullName: true } },
} satisfies Prisma.ListingSelect;

/**
 * An owner's phone number is the agency's book.
 *
 * An agent who can export every landlord's mobile can take the business to a
 * competitor in an afternoon, so the contact details come back only for roles
 * holding `listings:VIEW_SENSITIVE_FIELDS` — granted by the migration to
 * whoever already holds the equivalent on leads. Everyone else sees the name,
 * which is what they need to talk about the property, and a mask where the
 * number would be.
 *
 * Masked rather than omitted: a missing field reads as "no number on file" and
 * sends somebody hunting for one that already exists.
 */
export function maskOwner<T extends { phone?: string | null; email?: string | null; whatsappNumber?: string | null }>(
  ctx: Ctx,
  owner: T | null,
): T | null {
  if (!owner) return null;
  if (can(ctx, 'listings', 'VIEW_SENSITIVE_FIELDS')) return owner;
  return {
    ...owner,
    phone: owner.phone ? maskTail(owner.phone) : owner.phone,
    email: owner.email ? maskEmail(owner.email) : owner.email,
    whatsappNumber: owner.whatsappNumber ? maskTail(owner.whatsappNumber) : owner.whatsappNumber,
  };
}

/** Keeps the country code and the last two digits: enough to recognise, not to dial. */
const maskTail = (value: string) =>
  value.length <= 6 ? '•••' : `${value.slice(0, 4)}${'•'.repeat(Math.max(3, value.length - 6))}${value.slice(-2)}`;

const maskEmail = (value: string) => {
  const at = value.indexOf('@');
  if (at < 1) return '•••';
  return `${value[0]}${'•'.repeat(Math.max(3, at - 1))}${value.slice(at)}`;
};
