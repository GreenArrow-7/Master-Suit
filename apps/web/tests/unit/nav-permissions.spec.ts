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
