import type { ProductModuleKey } from '@/lib/modules/catalogue';

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
  'tasks',
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
  'forms',
  'landing-pages',
  'targets',
  'calendar',
] as const;

/**
 * The registers Lead Eagle shares with Sales, under `/{slug}/lead-eagle/`: Real
 * Estate's, without the money and marketing ones (collections, commissions,
 * events, proposals, portals). The website forms and landing pages are lead
 * sources, not marketing, so every lead module has them (M6-06, M6-09), and the
 * calendar of tasks, follow-ups and site visits is lead work (M4-22).
 * tests/unit/lead-eagle-routes.spec.ts holds the re-exports true.
 */
export const LEAD_EAGLE_SHARED_ROOTS = [
  'leads',
  'follow-ups',
  'tasks',
  'calls',
  'site-visits',
  'projects',
  'listings',
  'requirements',
  'allocation',
  'reports',
  'capture-links',
  'cold-data',
  'forms',
  'landing-pages',
  'targets',
  'calendar',
] as const;

/** Each module folder and its product, in the order a link prefers them: Sales, the fullest, first. */
const FOLDERS = [
  ['sales', 'SALES'],
  ['realty', 'REAL_ESTATE'],
  ['lead-eagle', 'LEAD_EAGLE'],
] as const;

/** The module folders that carry a screen root. Every shared register is under `/sales/` too. */
function foldersCarrying(root: string): readonly string[] {
  if ((LEAD_EAGLE_SHARED_ROOTS as readonly string[]).includes(root)) return ['sales', 'realty', 'lead-eagle'];
  if ((REALTY_SHARED_ROOTS as readonly string[]).includes(root)) return ['sales', 'realty'];
  // Lead Eagle's board and properties are Real Estate's pages, re-exported.
  if (root === 'dashboard' || root === 'properties') return ['realty', 'lead-eagle'];
  return [];
}

/**
 * HR screens every plan has outside People, at the workspace root: check-in is
 * self-service, and a workspace without HR keeps attendance, its requests and
 * work locations there (the moved check-in page under People says why).
 */
const OUTSIDE_PEOPLE: readonly (readonly [RegExp, string])[] = [
  [/^check-in$/, 'check-in'],
  [/^attendance$/, 'attendance'],
  [/^requests$/, 'attendance/requests'],
  [/^work-locations$/, 'admin/work-locations'],
  [/^employees\/([^/]+)\/face$/, 'admin/work-locations/$1/face'],
];

/**
 * Where else the screen at `url` lives: each product that carries it under
 * another folder, with the screen's address there (Sales, then Real Estate,
 * then Lead Eagle), or `null` as the product for a screen every plan has.
 *
 * Record links (the bell, a push notification, the assistant) are built as
 * `/sales/...` (lib/nav/entityRoute.ts), and old bookmarks name whichever
 * folder they were made in, so a module layout sends a workspace without its
 * product to the same screen under one it has (components/workspace/NotInPlan.tsx).
 *
 * `/acme/realty/leads/42?tab=calls` → `[['SALES', '/acme/sales/leads/42?tab=calls'],
 * ['LEAD_EAGLE', '/acme/lead-eagle/leads/42?tab=calls']]`.
 */
export function sameScreenElsewhere(url: string): [ProductModuleKey | null, string][] {
  const match = /^\/([^/?#]+)\/(sales|realty|lead-eagle|people)\/([^?#]*)(.*)$/.exec(url);
  if (!match) return [];
  const [, slug, folder, path, query] = match as unknown as [string, string, string, string, string];
  if (folder === 'people') {
    const moved = OUTSIDE_PEOPLE.find(([from]) => from.test(path));
    return moved ? [[null, `/${slug}/${path.replace(moved[0], moved[1])}${query}`]] : [];
  }
  const carriers = foldersCarrying(path.split('/')[0]!);
  if (!carriers.includes(folder)) return [];
  return FOLDERS.filter(([other]) => other !== folder && carriers.includes(other)).map(([other, product]) => [
    product,
    `/${slug}/${other}/${path}${query}`,
  ]);
}
