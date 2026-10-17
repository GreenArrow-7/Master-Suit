/**
 * Developers, communities and amenities typed by name on the project and
 * listing forms (Lead Eagle audit row M11-01). A workspace made in the wizard
 * starts with none of the three, and they had no screen of their own, so a
 * project could not name its developer or community. Each is found by name or
 * created, so the catalogue's filters, facets and the matching that key on
 * them work from the first project.
 */
import { z } from 'zod';
import type { TxClient } from '@/lib/db';

/** Comma-separated on the form, a list from the API. */
export const namesInput = z.union([z.array(z.string()), z.string()]).transform((v) =>
  (Array.isArray(v) ? v : v.split(','))
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .slice(0, 30),
);

export const referenceFields = {
  developerName: z.string().trim().min(2).max(120).optional(),
  community: z.string().trim().min(2).max(120).optional(),
  city: z.string().trim().min(2).max(80).optional(),
  amenityNames: namesInput.optional(),
};

/** "Swimming pool" → "swimming-pool": the amenity's key, so one name is one filter. */
export const amenityKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/** A name matched as a person would read it: case and spacing aside. */
const tidy = (name?: string) => name?.replace(/\s+/g, ' ').trim() || undefined;
const same = (name: string) => ({ equals: name, mode: 'insensitive' as const });

/**
 * The communities on file that a lead's typed areas name (M12-06), so units and
 * listings narrow by community. An area that names no community stays text on
 * the requirement; when none does, nothing narrows rather than everything hides.
 */
export async function communitiesNamed(tx: TxClient, tenantId: string, names: string[]) {
  const wanted = names.map(tidy).filter((n): n is string => !!n);
  if (!wanted.length) return [];
  const rows = await tx.micromarket.findMany({
    where: { tenantId, OR: wanted.map((name) => ({ name: same(name) })) },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function resolveReferences(
  tx: TxClient,
  tenantId: string,
  input: { developerName?: string; community?: string; city?: string; amenityNames?: string[] },
) {
  // "emaar" or "Dubai  hills" is the one already on file, not a second one.
  const developerName = tidy(input.developerName);
  const developerId = developerName
    ? (
        (await tx.developer.findFirst({ where: { tenantId, name: same(developerName) }, select: { id: true } })) ??
        (await tx.developer.upsert({
          where: { tenantId_name: { tenantId, name: developerName } },
          update: {},
          create: { tenantId, name: developerName },
          select: { id: true },
        }))
      ).id
    : undefined;
  // ponytail: a community typed without a city is taken as Dubai, the standalone's default; ask when a second emirate signs up.
  const city = tidy(input.city) ?? 'Dubai';
  const community = tidy(input.community);
  const micromarketId = community
    ? (
        (await tx.micromarket.findFirst({
          where: { tenantId, city: same(city), name: same(community) },
          select: { id: true },
        })) ??
        (await tx.micromarket.upsert({
          where: { tenantId_city_name: { tenantId, city, name: community } },
          update: {},
          create: { tenantId, city, name: community },
          select: { id: true },
        }))
      ).id
    : undefined;
  const amenityKeys: string[] = [];
  for (const label of input.amenityNames ?? []) {
    const key = amenityKey(label);
    if (!key || amenityKeys.includes(key)) continue;
    await tx.amenity.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: {},
      create: { tenantId, key, label },
    });
    amenityKeys.push(key);
  }
  return { developerId, micromarketId, amenityKeys };
}
