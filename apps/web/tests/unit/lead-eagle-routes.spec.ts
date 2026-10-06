import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEAD_EAGLE_SHARED_ROOTS, leadEagleEquivalent } from '@/lib/nav/realtyShared';
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
const apiRoutes = (roots: readonly string[]) =>
  roots.flatMap((root) => files(path.join(API, root), 'route.ts').map((rel) => `${root}/${rel}`));

describe('Lead Eagle is a module', () => {
  it('is in the catalogue and the lead-work set', () => {
    expect(PRODUCT_MODULE_KEYS).toContain('LEAD_EAGLE');
    expect(LEAD_MODULES).toEqual(['SALES', 'REAL_ESTATE', 'LEAD_EAGLE']);
  });

  it('gates its URLs on its own entitlement', () => {
    expect(read(path.join(APP, 'lead-eagle', 'layout.tsx'))).toContain(
      "requestWorkspace(ctx, workspaceSlug, 'LEAD_EAGLE')",
    );
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
  const lead = apiRoutes([...SHARED, 'documents', 'tasks', 'activities']).filter((route) =>
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
    else expect(source).toContain('productModule: LEAD_MODULES');
  });

  it.each(money)('%s does not', (route) => {
    expect(read(path.join(API, route))).not.toContain('LEAD_MODULES');
  });
});

describe('a /sales/ link reaches a Lead-Eagle-only workspace', () => {
  it('maps lead work to the same screen under Lead Eagle, and nothing else', () => {
    expect(leadEagleEquivalent('/acme/sales/leads/42?tab=calls')).toBe('/acme/lead-eagle/leads/42?tab=calls');
    expect(leadEagleEquivalent('/acme/sales/follow-ups')).toBe('/acme/lead-eagle/follow-ups');
    expect(leadEagleEquivalent('/acme/sales/collections')).toBeNull();
    expect(leadEagleEquivalent('/acme/sales/opportunities/7')).toBeNull();
  });

  it('the Sales layout tries Real Estate first, then Lead Eagle', () => {
    const layout = read(path.join(APP, 'sales', 'layout.tsx'));
    expect(layout.indexOf("'REAL_ESTATE', realtyEquivalent")).toBeLessThan(
      layout.indexOf("'LEAD_EAGLE', leadEagleEquivalent"),
    );
  });

  it('lead-eagle is a module root for module-relative links', () => {
    expect(read(path.join(web, 'src', 'components', 'workspace', 'SalesLink.tsx'))).toContain("'lead-eagle'");
  });
});
