/**
 * Every route in the application, opened as a persona entitled to it.
 *
 * The rest of the e2e suite drives a handful of deep journeys — a workspace is
 * provisioned, an invitation is redeemed, payroll runs to paid. Those prove the
 * flows they touch and say nothing at all about the other two thirds of the
 * product: at the time this was written, 33 Sales routes had 11 covered and 26
 * People routes had 6, so a page could 500 on every load and the suite stayed
 * green. This is the breadth pass that closes that gap.
 *
 * What it asserts per route is deliberately shallow but not weak:
 *
 *   - the response is not an error status;
 *   - the page rendered its own heading, so the shell is not standing in for a
 *     page that threw during render;
 *   - a viewer who *is* entitled is not shown the access-refused screen, which
 *     is how the People module read as "down" — offered in the navigation and
 *     refused on arrival;
 *   - nothing rendered Next's error boundary.
 *
 * It runs against the seeded demo workspace rather than provisioning its own.
 * A freshly wizarded tenant is empty, and an empty page cannot distinguish "no
 * records yet" from "the query threw and the empty state is the fallback" —
 * the seeded tenant has real leads, employees, calls and payroll behind it.
 * Every navigation here is a GET; nothing in this file mutates demo data.
 */
import { expect, test, type Page } from '@playwright/test';
import { login, loginPlatformOwner } from './helpers';

const WORKSPACE = process.env.E2E_DEMO_SLUG ?? 'manath-homes';
const ADMIN_EMAIL = process.env.E2E_DEMO_ADMIN ?? 'admin@manathhomes.ae';
const ADMIN_PASSWORD = process.env.DEMO_PASSWORD ?? 'ManathDemo-2026';

/** Sales module, every route the workspace admin may open. */
const SALES = [
  'accounts', 'activities', 'allocation', 'automation', 'calendar', 'call-audits',
  'calls', 'campaigns', 'clients', 'commissions', 'commissions/slabs', 'communications',
  'contacts', 'dashboards', 'documents', 'engagement', 'events', 'field-sales',
  'follow-ups', 'forms', 'landing-pages', 'leadership', 'leads', 'listings',
  'opportunities', 'people', 'products', 'projects', 'reports', 'requirements',
  'service', 'site-visits', 'smart-views', 'targets', 'tasks',
];

/** People / HRMS module. */
const PEOPLE = [
  'attendance', 'check-in', 'compliance', 'departments', 'documents', 'employees',
  'face-activity', 'holidays', 'leave', 'lifecycle', 'offboarding', 'onboarding',
  'overtime', 'payroll', 'payslips', 'performance', 'recruitment', 'reports',
  'requests', 'roles', 'roster', 'security', 'settings', 'shifts', 'users',
  'work-locations',
];

/** Workspace-level screens outside the two modules. */
const WORKSPACE_LEVEL = [
  // `profile` itself is deliberately absent: the directory holds only `security`
  // and `role`, nothing links to the bare path, and it correctly 404s.
  'dashboard', 'notifications', 'tasks', 'profile/security', 'profile/role',
  'admin/users', 'admin/roles', 'admin/settings', 'admin/audit', 'admin/integrations',
];

/** Control plane, owner only. */
const PLATFORM = [
  '', 'workspaces', 'subscriptions', 'plans', 'users', 'audit', 'system-health', 'settings',
];

/**
 * One route, opened and judged.
 *
 * The failure message carries the path and what was actually on screen, because
 * a bare "expected visible" for a route table this size tells you nothing about
 * which of sixty pages broke or how.
 */
async function opens(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  const status = response?.status() ?? 0;
  expect(status, `${url} responded ${status}`).toBeLessThan(400);

  const body = (await page.locator('body').innerText().catch(() => '')) || '';

  // The refusal screen is a *rendered* page with a 200, so it never trips the
  // status check. For a workspace administrator it is always a defect.
  expect(body, `${url} refused an entitled viewer`).not.toContain('You do not have access to this page');
  expect(body, `${url} rendered an application error`).not.toMatch(
    /Application error: a (client|server)-side exception|Internal Server Error/,
  );

  // A page that threw during render leaves the shell — sidebar and top bar —
  // with no page heading under it.
  await expect(
    page.locator('main h1, main h2, h1').first(),
    `${url} rendered no heading; body began: ${body.slice(0, 160)}`,
  ).toBeVisible({ timeout: 30_000 });
}

test.describe('Every route renders for an entitled viewer', () => {
  test.describe.configure({ mode: 'serial' });

  test('the Sales module opens on every route', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    for (const route of SALES) {
      await test.step(`sales/${route}`, async () => {
        await opens(page, `/${WORKSPACE}/sales/${route}`);
      });
    }
  });

  test('the People module opens on every route', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    for (const route of PEOPLE) {
      await test.step(`people/${route}`, async () => {
        await opens(page, `/${WORKSPACE}/people/${route}`);
      });
    }
  });

  test('the workspace-level screens open', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    for (const route of WORKSPACE_LEVEL) {
      await test.step(route, async () => {
        await opens(page, `/${WORKSPACE}/${route}`);
      });
    }
  });

  test('the platform console opens on every route', async ({ page }) => {
    await loginPlatformOwner(page);
    for (const route of PLATFORM) {
      await test.step(`platform/${route || 'overview'}`, async () => {
        await opens(page, `/platform${route ? `/${route}` : ''}`);
      });
    }
  });
});
