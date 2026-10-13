import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEAD_EAGLE_SHARED_ROOTS, sameScreenElsewhere } from '@/lib/nav/realtyShared';
import { buildNavigation } from '@/lib/nav/workspaceNav';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { PRODUCT_MODULE_KEYS } from '@/lib/modules/catalogue';

/**
 * Lead Eagle is the lead-management product on the same records (owner, 5 Oct):
 * its routes re-export the Sales pages for lead work, the pages and APIs behind
 * them admit it, and the money and marketing registers do not. The drift guard
 * for both directions, as tests/unit/realty-routes.spec.ts is for Real Estate.
 */
const web = path.join(__dirname, '..', '..');
const APP = path.join(web, 'src', 'app', '(workspace)', '[workspaceSlug]');
const API = path.join(web, 'src', 'app', 'api', 'v1');
const read = (file: string) => readFileSync(file, 'utf8');

function files(root: string, name: string): string[] {
  if (!existsSync(root)) return [];
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((rel) => path.basename(rel) === name)
    .map((rel) => rel.split(path.sep).join('/'));
}

const SHARED: readonly string[] = LEAD_EAGLE_SHARED_ROOTS;
const isShared = (route: string) => SHARED.some((root) => route.startsWith(`${root}/`));
const leadEagleRoutes = files(path.join(APP, 'lead-eagle'), 'page.tsx').filter(isShared);
/** POST /targets/progress: a hand-typed increment to a target. */
const PROGRESS_TALLY = 'targets/progress/route.ts';
const apiRoutes = (roots: readonly string[]) =>
  roots.flatMap((root) => files(path.join(API, root), 'route.ts').map((rel) => `${root}/${rel}`));

describe('Lead Eagle is a module', () => {
  it('is in the catalogue and the lead-work set', () => {
    expect(PRODUCT_MODULE_KEYS).toContain('LEAD_EAGLE');
    expect(LEAD_MODULES).toEqual(['SALES', 'REAL_ESTATE', 'LEAD_EAGLE']);
  });

  it('counts Targets among its shared registers: the daily calling quota is lead work', () => {
    expect(LEAD_EAGLE_SHARED_ROOTS).toContain('targets');
  });

  it('gates its URLs on its own entitlement', () => {
    expect(read(path.join(APP, 'lead-eagle', 'layout.tsx'))).toContain("workspaceOwns(workspaceSlug, 'LEAD_EAGLE')");
  });

  it('shares the calendar: tasks, follow-ups and site visits are lead work (M4-22)', () => {
    expect(LEAD_EAGLE_SHARED_ROOTS).toContain('calendar');
    expect(read(path.join(APP, 'lead-eagle', 'calendar', 'page.tsx'))).toContain(
      "export { default, metadata } from '../../sales/calendar/page';",
    );
    const tabs = buildNavigation({ slug: 'eagle', modules: ['LEAD_EAGLE'], permitted: ['leads', 'tasks'] })
      .flatMap((section) => section.areas)
      .flatMap((area) => area.tabs);
    expect(tabs.find((tab) => tab.href === '/eagle/lead-eagle/calendar')?.label).toBe('Calendar');
    expect(new Map(sameScreenElsewhere('/acme/sales/calendar?month=2026-12')).get('LEAD_EAGLE')).toBe(
      '/acme/lead-eagle/calendar?month=2026-12',
    );
  });

  it('shares the website forms and landing pages, its own lead sources (M6-06, M6-09)', () => {
    expect(LEAD_EAGLE_SHARED_ROOTS).toEqual(expect.arrayContaining(['forms', 'landing-pages']));
  });
});

describe('the Lead Eagle routes re-export the Sales pages for lead work', () => {
  it('covers every Sales screen under the shared registers', () => {
    expect(leadEagleRoutes.length).toBeGreaterThanOrEqual(21);
    expect([...leadEagleRoutes].sort()).toEqual(files(path.join(APP, 'sales'), 'page.tsx').filter(isShared).sort());
  });

  it.each(leadEagleRoutes)('%s is a re-export of its Sales page', (route) => {
    const source = read(path.join(APP, 'lead-eagle', route));
    expect(source).toMatch(/^export \{ default(, metadata)? \} from '/m);
    for (const forbidden of ['prisma', 'requirePageAccess', 'visibilityWhere', 'useState']) {
      expect(source).not.toContain(forbidden);
    }
    const target = /from '(\.[^']+)'/.exec(source);
    const resolved = path.join(path.dirname(path.join(APP, 'lead-eagle', route)), `${target![1]!}.tsx`);
    expect(existsSync(resolved), `${route} re-exports ${target![1]}`).toBe(true);
    expect(resolved).toContain(`${path.sep}sales${path.sep}`);
    // And the Sales page admits Lead Eagle, or the layout lets it through to a refusal.
    expect(read(resolved)).toContain('module: LEAD_MODULES');
  });

  it('reuses the Real Estate dashboard and Properties, which admit Lead Eagle', () => {
    expect(read(path.join(APP, 'lead-eagle', 'dashboard', 'page.tsx'))).toContain("from '../../realty/dashboard/page'");
    expect(read(path.join(APP, 'realty', 'dashboard', 'page.tsx'))).toContain("'LEAD_EAGLE'");
    expect(read(path.join(APP, 'lead-eagle', 'properties', 'page.tsx'))).toContain(
      "from '../../realty/properties/page'",
    );
    expect(read(path.join(APP, 'realty', 'properties', 'page.tsx'))).toContain("module: ['REAL_ESTATE', 'LEAD_EAGLE']");
  });
});

describe('the APIs admit Lead Eagle for lead work and nothing else', () => {
  const lead = apiRoutes([...SHARED, 'documents', 'activities']).filter((route) =>
    read(path.join(API, route)).includes('productModule'),
  );
  const money = apiRoutes(['collections', 'commissions', 'commission-slabs', 'proposals', 'portals', 'events']);

  it('finds routes on both sides', () => {
    expect(lead.length).toBeGreaterThanOrEqual(50);
    expect(money.length).toBeGreaterThanOrEqual(20);
  });

  it.each(lead)('%s admits Lead Eagle', (route) => {
    const source = read(path.join(API, route));
    // A listing's portal publishing is marketing, not lead work.
    if (route.includes('/portals/')) expect(source).not.toContain('LEAD_MODULES');
    // A seller's own unaudited tally stays Sales-only: nothing calls it, and the work itself counts progress.
    else if (route === PROGRESS_TALLY) expect(source).toContain("productModule: 'SALES'");
    else expect(source).toContain('productModule: LEAD_MODULES');
  });

  it.each(money)('%s does not', (route) => {
    expect(read(path.join(API, route))).not.toContain('LEAD_MODULES');
  });
});

describe('a /sales/ link reaches a Lead-Eagle-only workspace', () => {
  const leadEagleEquivalent = (url: string) => new Map(sameScreenElsewhere(url)).get('LEAD_EAGLE') ?? null;

  it('maps lead work to the same screen under Lead Eagle, and nothing else', () => {
    expect(leadEagleEquivalent('/acme/sales/leads/42?tab=calls')).toBe('/acme/lead-eagle/leads/42?tab=calls');
    expect(leadEagleEquivalent('/acme/sales/follow-ups')).toBe('/acme/lead-eagle/follow-ups');
    expect(leadEagleEquivalent('/acme/sales/collections')).toBeNull();
    expect(leadEagleEquivalent('/acme/sales/opportunities/7')).toBeNull();
  });

  it('a /sales/ link tries Real Estate first, then Lead Eagle', () => {
    expect(sameScreenElsewhere('/acme/sales/leads/42').map(([product]) => product)).toEqual([
      'REAL_ESTATE',
      'LEAD_EAGLE',
    ]);
  });

  it('lead-eagle is a module root for module-relative links', () => {
    expect(read(path.join(web, 'src', 'components', 'workspace', 'SalesLink.tsx'))).toContain("'lead-eagle'");
  });
});

describe('the Administration screens every lead module shares', () => {
  const admin = path.join(APP, 'admin');

  it.each(['lead-stages', 'lead-sources', 'custom-fields', 'email-templates'])(
    'admin/%s admits Lead Eagle, with its API',
    (screen) => {
      expect(read(path.join(admin, screen, 'page.tsx'))).toContain('module: LEAD_MODULES');
    },
  );

  it.each(['lead-sources', 'custom-fields', 'lead-scoring', 'email-templates'])(
    'the %s API admits Lead Eagle',
    (api) => {
      expect(read(path.join(API, api, 'route.ts'))).toContain('productModule: LEAD_MODULES');
    },
  );

  it.each(['lead-sources', 'custom-fields', 'email-templates'])(
    'admin/%s shows NotInPlan outside a lead product',
    (screen) => {
      const layout = read(path.join(admin, screen, 'layout.tsx'));
      expect(layout).toContain('workspaceOwns(workspaceSlug, LEAD_MODULES)');
      expect(layout).toContain('<NotInPlan slug={workspaceSlug} module={LEAD_MODULES} />');
    },
  );

  it('a Lead-Eagle-only administrator is offered Lead Stages, Sources, Custom Fields and Email Templates under Settings', () => {
    const tabs = buildNavigation({ slug: 'eagle', modules: ['LEAD_EAGLE'], permitted: ['settings'] })
      .flatMap((section) => section.areas)
      .flatMap((area) => area.tabs)
      .map((tab) => tab.href);
    expect(tabs).toEqual(
      expect.arrayContaining([
        '/eagle/admin/lead-stages',
        '/eagle/admin/lead-sources',
        '/eagle/admin/custom-fields',
        '/eagle/admin/email-templates',
      ]),
    );
  });
});
