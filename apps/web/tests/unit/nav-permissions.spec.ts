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
 * `navPermissionKeys()` now reads the nav itself, so the drift cannot recur by
 * construction. These cases exist for the other direction: someone reintroducing
 * a hand-written list, or a nav item quietly losing its gate.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWorkspaceNav, itemAllowed, navPermissionKeys } from '@/lib/nav/workspaceNav';

const ALL_MODULES = ['SALES', 'HRMS'];

describe('nav permission keys', () => {
  it('covers every permission any nav item gates on', () => {
    const keys = new Set(navPermissionKeys());
    const missing = buildWorkspaceNav({ slug: 'w', modules: ALL_MODULES, permitted: navPermissionKeys() })
      .flatMap((group) => group.items)
      .flatMap((item) =>
        item.permission ? (Array.isArray(item.permission) ? item.permission : [item.permission]) : [],
      )
      .filter((permission) => !keys.has(permission));
    expect(missing).toEqual([]);
  });

  it('includes the thirteen the hand-written list had lost', () => {
    // Named rather than counted: a regression that drops one of these should say
    // which, and these are the ones that were actually unreachable.
    for (const key of [
      'visits',
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
    ]) {
      expect(navPermissionKeys()).toContain(key);
    }
  });

  it('renders a site-visits link for a role that holds the permission', () => {
    const nav = buildWorkspaceNav({ slug: 'w', modules: ALL_MODULES, permitted: ['visits'] });
    const hrefs = nav.flatMap((group) => group.items).map((item) => item.href);
    expect(hrefs).toContain('/w/sales/site-visits');
  });

  it('still hides an item whose permission is not held', () => {
    const nav = buildWorkspaceNav({ slug: 'w', modules: ALL_MODULES, permitted: [] });
    const gated = nav.flatMap((group) => group.items).filter((item) => item.permission);
    expect(gated).toEqual([]);
    // And the ungated ones survive, so this is a filter and not an empty nav.
    expect(nav.flatMap((group) => group.items).length).toBeGreaterThan(0);
  });

  it('hides the People group from platform staff, permissions notwithstanding', () => {
    const staff = buildWorkspaceNav({
      slug: 'w',
      modules: ALL_MODULES,
      permitted: navPermissionKeys(),
      platformStaff: true,
    });
    expect(staff.map((group) => group.key)).not.toContain('people');

    const employee = buildWorkspaceNav({ slug: 'w', modules: ALL_MODULES, permitted: navPermissionKeys() });
    expect(employee.map((group) => group.key)).toContain('people');
  });

  it('itemAllowed needs every permission an item names, not just one', () => {
    const item = { label: 'x', href: '/x', icon: 'home' as const, permission: ['leads', 'reports'] };
    expect(itemAllowed(item, ['leads'])).toBe(false);
    expect(itemAllowed(item, ['leads', 'reports'])).toBe(true);
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
      expect(source, `${page} declares no product module`).toMatch(/module: '(SALES|HRMS)'/);
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
