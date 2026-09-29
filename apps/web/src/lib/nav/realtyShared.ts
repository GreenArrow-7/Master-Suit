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
] as const;

/**
 * The same screen under Real Estate, or null when Real Estate has none.
 *
 * `/acme/sales/leads/42?tab=calls` → `/acme/realty/leads/42?tab=calls`.
 */
export function realtyEquivalent(url: string): string | null {
  const match = /^\/([^/?#]+)\/sales\/([^/?#]+)(.*)$/.exec(url);
  if (!match) return null;
  const [, slug, root, rest] = match;
  if (!(REALTY_SHARED_ROOTS as readonly string[]).includes(root!)) return null;
  return `/${slug}/realty/${root}${rest}`;
}
