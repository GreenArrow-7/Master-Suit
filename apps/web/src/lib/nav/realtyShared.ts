/**
 * The registers Real Estate shares with Sales, as route roots under both
 * `/{slug}/sales/` and `/{slug}/realty/`.
 *
 * The `realty/` pages under these roots re-export the `sales/` pages, and
 * tests/unit/realty-routes.spec.ts holds that true for every page beneath them.
 */
export const REALTY_SHARED_ROOTS = [
  'leads',
  'follow-ups',
  'calls',
  'site-visits',
  'projects',
  'listings',
  'requirements',
  'allocation',
  'collections',
  'commissions',
  'reports',
  'events',
  'proposals',
  'portals',
  'capture-links',
  'cold-data',
] as const;

/**
 * The registers Lead Eagle shares with Sales, under `/{slug}/lead-eagle/`: Real
 * Estate's, without the money and marketing ones (collections, commissions,
 * events, proposals, portals). tests/unit/lead-eagle-routes.spec.ts holds the
 * re-exports true.
 */
export const LEAD_EAGLE_SHARED_ROOTS = [
  'leads',
  'follow-ups',
  'calls',
  'site-visits',
  'projects',
  'listings',
  'requirements',
  'allocation',
  'reports',
  'capture-links',
  'cold-data',
] as const;

/** The same screen under another product root, or null when that product has none. */
function equivalent(url: string, product: string, roots: readonly string[]): string | null {
  const match = /^\/([^/?#]+)\/sales\/([^/?#]+)(.*)$/.exec(url);
  if (!match) return null;
  const [, slug, root, rest] = match;
  if (!roots.includes(root!)) return null;
  return `/${slug}/${product}/${root}${rest}`;
}

/**
 * The same screen under Real Estate, or null when Real Estate has none.
 *
 * `/acme/sales/leads/42?tab=calls` → `/acme/realty/leads/42?tab=calls`.
 */
export const realtyEquivalent = (url: string) => equivalent(url, 'realty', REALTY_SHARED_ROOTS);

/** The same screen under Lead Eagle, or null when Lead Eagle has none. */
export const leadEagleEquivalent = (url: string) => equivalent(url, 'lead-eagle', LEAD_EAGLE_SHARED_ROOTS);
