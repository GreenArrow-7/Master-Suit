/**
 * The workspace navigation and the permissions it gates on must stay one list.
 *
 * `(workspace)/[workspaceSlug]/layout.tsx` used to keep its own copy of the
 * permission modules, filter it with `can()`, and hand the result to the nav as
 * `permitted`. The two drifted: thirteen modules the nav gates items on were
 * absent from the layout's copy, so `permitted` could never contain them and
 * `itemAllowed` removed those items for every user in every workspace — no
 * matter what their role actually granted.
 *
 * Site visits was the visible one. The page answered 200 to anyone who typed the
 * URL and `visits:VIEW` was a real, grantable permission; there was simply no
 * link to it anywhere in the product, and had not been since the list was
 * introduced.
 *
 * `NAV_PERMISSIONS` now reads the nav itself, so the drift cannot recur by
 * construction. These cases exist for the other direction: someone reintroducing
 * a hand-written list, or a nav item quietly losing its gate.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNavigation, NAV_PERMISSIONS, tabAllowed, type NavSection } from '@/lib/nav/workspaceNav';

const ALL_MODULES = ['SALES', 'HRMS'];
const navPermissionKeys = () => NAV_PERMISSIONS.map((token) => token.split(':')[0]!);
const tabsOf = (sections: NavSection[]) => sections.flatMap((section) => section.areas).flatMap((area) => area.tabs);
const tokensOf = (permission: string | string[] | undefined) =>
  permission ? (Array.isArray(permission) ? permission : [permission]) : [];

describe('nav permission keys', () => {
  it('covers every permission any nav item gates on', () => {
    const keys = new Set(NAV_PERMISSIONS);
    const missing = tabsOf(
      buildNavigation({ slug: 'w', modules: ALL_MODULES, permitted: NAV_PERMISSIONS, peopleOversight: true }),
    )
      .flatMap((tab) => tokensOf(tab.permission))
      .filter((permission) => !keys.has(permission));
    expect(missing).toEqual([]);
  });

  it('includes the modules the hand-written list had lost', () => {
    // Named rather than counted: a regression that drops one of these should say
    // which, and these are the ones that were actually unreachable. `contests` is
    // not listed: in the work-area navigation contests live inside Team Feed,
    // gated on `posts`, and the page still checks `contests:VIEW` for that data
    // (asserted against its source below).
    for (const key of [
      'visits',
      'projects',
      'listings',
      'requirements',
      'clientprofiles',
      'commissions',
      'commissionslabs',
      'posts',
      'referrals',
      'testimonials',
      'allocation',
      'payroll',
    ]) {
      expect(navPermissionKeys()).toContain(key);
    }
  });

  it('renders a site-visits link for a role that holds the permission', () => {
    const nav = buildNavigation({ slug: 'w', modules: ALL_MODULES, permitted: ['visits'] });
    const hrefs = tabsOf(nav).map((tab) => tab.href);
    expect(hrefs).toContain('/w/sales/site-visits');
  });

  it('still hides an item whose permission is not held', () => {
    const nav = buildNavigation({ slug: 'w', modules: ALL_MODULES, permitted: [] });
    const gated = tabsOf(nav).filter((tab) => tab.permission);
    expect(gated).toEqual([]);
    // And the ungated ones survive, so this is a filter and not an empty nav.
    expect(tabsOf(nav).length).toBeGreaterThan(0);
  });

  it('hides the People section from platform staff, permissions notwithstanding', () => {
    for (const peopleOversight of [false, true]) {
      const staff = buildNavigation({
        slug: 'w',
        modules: ALL_MODULES,
        permitted: NAV_PERMISSIONS,
        peopleOversight,
        platformStaff: true,
      });
      expect(staff.map((section) => section.key)).not.toContain('people');
      // The self-service tabs carry no permission, which is why the section is
      // removed outright. A People route may still appear elsewhere only behind a
      // permission (Reports › HR, Settings › HR Policies), which a monitoring
      // actor never holds.
      expect(tabsOf(staff).filter((tab) => tab.href.startsWith('/w/people') && !tab.permission)).toEqual([]);

      const employee = buildNavigation({
        slug: 'w',
        modules: ALL_MODULES,
        permitted: NAV_PERMISSIONS,
        peopleOversight,
      });
      expect(employee.map((section) => section.key)).toContain('people');
    }
  });

  it('tabAllowed needs every permission a tab names, not just one', () => {
    const tab = { label: 'x', href: '/x', permission: ['leads', 'reports'] };
    expect(tabAllowed(tab, { slug: 'w', modules: ALL_MODULES, permitted: ['leads'] })).toBe(false);
    expect(tabAllowed(tab, { slug: 'w', modules: ALL_MODULES, permitted: ['leads', 'reports'] })).toBe(true);
  });
});

/**
 * Making a nav key resolve must not make its destination reachable.
 *
 * Thirteen permission modules became visible in the sidebar when the layout
 * stopped filtering against its own stale copy of the list. Three of them —
 * `contests`, `referrals`, `testimonials` — are not pages of their own but
 * `?view=` tabs on a shared page gated by a *different, coarser* permission.
 * So "the link appears" and "the data loads" are two questions, and the second
 * is the one that matters.
 *
 * Asserted against the source because these are server components: a page that
 * stopped consulting the finer permission would still render, and the failure
 * would be silent data exposure rather than an error anybody sees.
 */
describe('newly reachable nav keys do not widen what their pages serve', () => {
  const pageSource = (relative: string) =>
    readFileSync(path.resolve(__dirname, '../../src/app/(workspace)/[workspaceSlug]', relative), 'utf8');

  it('every nav permission resolves to a page that declares a product-module entitlement', () => {
    // A key that resolves to a page with no entitlement would let a workspace
    // that never bought the module reach it by holding the permission alone.
    for (const [key, page] of [
      ['visits', 'sales/site-visits/page.tsx'],
      ['projects', 'sales/projects/page.tsx'],
      ['listings', 'sales/listings/page.tsx'],
      ['requirements', 'sales/requirements/page.tsx'],
      ['clientprofiles', 'sales/clients/page.tsx'],
      ['commissions', 'sales/commissions/page.tsx'],
      ['commissionslabs', 'sales/commissions/slabs/page.tsx'],
      ['allocation', 'sales/allocation/page.tsx'],
      ['posts', 'sales/engagement/page.tsx'],
      ['payroll', 'people/payroll/page.tsx'],
    ] as const) {
      const source = pageSource(page);
      // A literal, or one of the named constants that stands for a set of
      // them. `SALES_OR_REALTY` is still an entitlement assertion — it means
      // "either product", for the registers Sales and Real Estate share — so
      // what this guard is really checking, that the page asserts *some*
      // module, is unchanged. A page with no `module:` at all still fails.
      expect(source, `${page} declares no product module`).toMatch(
        /module: ('(SALES|HRMS|REAL_ESTATE)'|SALES_OR_REALTY)/,
      );
      expect(navPermissionKeys(), `${key} is not a nav permission`).toContain(key);
    }
  });

  it('the three ?view= tabs gate their data on their own permission, not the page’s', () => {
    const engagement = pageSource('sales/engagement/page.tsx');
    // Entry is `posts:VIEW`; the contests data must additionally require
    // `contests:VIEW`, or a link gated on contests lands somewhere that serves
    // it to anyone holding posts.
    expect(engagement).toMatch(/can\(ctx, 'contests', 'VIEW'\)/);
    expect(engagement).toMatch(/view === 'contests' && canSeeContests/);

    const clients = pageSource('sales/clients/page.tsx');
    expect(clients).toMatch(/can\(ctx, 'testimonials', 'VIEW'\)/);
    expect(clients).toMatch(/can\(ctx, 'referrals', 'VIEW'\)/);
  });

  it('a monitoring identity reaches none of the thirteen', () => {
    // The allowlist in buildSupportActor is the control; this states the
    // consequence for the nav, so widening one without the other fails here.
    const monitoring = ['leads', 'calls', 'activities', 'tasks', 'visits', 'tickets'];
    const newlyReachable = [
      'projects',
      'listings',
      'requirements',
      'clientprofiles',
      'commissions',
      'commissionslabs',
      'contests',
      'posts',
      'referrals',
      'testimonials',
      'allocation',
      'payroll',
    ];
    for (const key of newlyReachable) expect(monitoring).not.toContain(key);
    // `visits` is deliberately on both lists: it is one of the thirteen the nav
    // regained and one of the six monitoring may read.
    expect(monitoring).toContain('visits');
  });
});
