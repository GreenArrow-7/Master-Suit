import { randomBytes } from 'node:crypto';
import { prisma, type TxClient } from '@/lib/db';
import { NotFound } from '@/lib/errors';

type Db = TxClient | typeof prisma;

/**
 * The catalogue every lead workspace starts with (owner's brief, 12 Oct). The
 * first four keys are the portal connection kinds (`LEAD_SOURCES`,
 * lib/integrations/leadSources.ts), so an enquiry lands on its entry by key.
 */
export const DEFAULT_LEAD_SOURCES = [
  ['property_finder', 'Property Finder'],
  ['bayut', 'Bayut'],
  ['dubizzle', 'Dubizzle'],
  ['google_ads', 'Google Ads'],
  ['meta', 'Meta'],
  ['website', 'Website'],
  ['walk_in', 'Walk-in'],
  ['referral', 'Referral'],
  ['cold_data', 'Cold data'],
  ['other', 'Other'],
] as const;

/**
 * The stable key a name gets: `Marina campaign` under `website` →
 * `website_marina_campaign`. Letters of any script stay (`بيوت`); a name with
 * none gets a random one, never its parent's key.
 */
export const sourceKey = (name: string, parentKey?: string | null) => {
  const slug =
    name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '_')
      .replace(/^_|_$/g, '') || randomBytes(4).toString('hex');
  return [parentKey, slug].filter(Boolean).join('_').slice(0, 60);
};

/**
 * Seeds the defaults for a workspace that has no catalogue yet, and nothing
 * for one that has. Only on a write: provisioning (a new lead workspace), an
 * administrator's first change, and a lead arriving with a key (intake, Meta,
 * public forms). Workspaces that worked leads before the catalogue existed got
 * it from the migration (20261012004000_lead_record_fields), so no screen writes
 * it on a read — a read-only platform session included. Idempotent, and safe
 * under two concurrent first uses (the unique key skips the duplicate).
 */
export async function ensureLeadSources(db: Db, tenantId: string): Promise<void> {
  if ((await db.leadSource.count({ where: { tenantId } })) > 0) return;
  await db.leadSource.createMany({
    data: DEFAULT_LEAD_SOURCES.map(([key, name], position) => ({ tenantId, key, name, position })),
    skipDuplicates: true,
  });
}

/** The catalogue in its order (position, then name); a sub-source names its source in `parentId`. Reads only. */
export async function listLeadSources(db: Db, tenantId: string) {
  return db.leadSource.findMany({
    where: { tenantId },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    select: { id: true, key: true, name: true, parentId: true, isActive: true, position: true },
  });
}

/** The entry for a key (a portal connection's kind), or null when the workspace has none. */
export async function leadSourceIdFor(db: Db, tenantId: string, key: string): Promise<string | null> {
  await ensureLeadSources(db, tenantId);
  const entry = await db.leadSource.findFirst({ where: { tenantId, key }, select: { id: true } });
  return entry?.id ?? null;
}

/** A lead's `sourceId` from a body: the workspace's own entry, or 404 like a missing id. */
export async function assertLeadSource(db: Db, tenantId: string, id: string): Promise<void> {
  const entry = await db.leadSource.findFirst({ where: { tenantId, id }, select: { id: true } });
  if (!entry) throw NotFound('Lead source');
}

/** "Website · Marina launch", or the entry's own name. */
export const leadSourceLabel = (
  entry: { name: string; parent: { name: string } | null } | null | undefined,
  separator = ' · ',
) => (entry ? [entry.parent?.name, entry.name].filter(Boolean).join(separator) : null);
