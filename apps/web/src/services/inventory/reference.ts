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

export async function resolveReferences(
  tx: TxClient,
  tenantId: string,
  input: { developerName?: string; community?: string; city?: string; amenityNames?: string[] },
) {
  const developerId = input.developerName
    ? (
        await tx.developer.upsert({
          where: { tenantId_name: { tenantId, name: input.developerName } },
          update: {},
          create: { tenantId, name: input.developerName },
          select: { id: true },
        })
      ).id
    : undefined;
  // ponytail: a community typed without a city is taken as Dubai, the standalone's default; ask when a second emirate signs up.
  const city = input.city ?? 'Dubai';
  const micromarketId = input.community
    ? (
        await tx.micromarket.upsert({
          where: { tenantId_city_name: { tenantId, city, name: input.community } },
          update: {},
          create: { tenantId, city, name: input.community },
          select: { id: true },
        })
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
