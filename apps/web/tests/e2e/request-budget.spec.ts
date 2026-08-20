import { test, expect, type Page, type Request } from '@playwright/test';
import {
  createWorkspaceViaWizard,
  login,
  loginPlatformOwner,
  logout,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

/**
 * The regression guard for navigation cost.
 *
 * Each in-app navigation below must stay a *soft* navigation (zero document
 * loads — a raw <a href> in the chrome turns every click into a full reload
 * that re-runs the whole layout), must not call the same endpoint twice, and
 * must stay under a small total-request budget. This is the executable form of
 * the 2026-08 latency audit: the numbers are generous enough for legitimate
 * additions and tight enough that a refetch storm or a hard-navigation
 * regression fails loudly.
 */
test.describe.configure({ mode: 'serial' });

/** Requests that count against the budget: same-origin app traffic only. */
function counted(req: Request, origin: string): boolean {
  const url = new URL(req.url());
  if (!req.url().startsWith(origin)) return false;
  // Framework internals: static chunks, images, HMR, dev overlay, favicon.
  if (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/__nextjs')) return false;
  if (url.pathname === '/favicon.ico') return false;
  // Speculative prefetches are free — the router may or may not issue them
  // depending on build mode, and they must not read as duplicates.
  const headers = req.headers();
  if (headers['next-router-prefetch'] !== undefined || headers['purpose'] === 'prefetch') return false;
  return true;
}

/** Runs `act`, settles the network, and returns the counted requests it fired. */
async function requestsDuring(page: Page, origin: string, act: () => Promise<void>): Promise<Request[]> {
  const seen: Request[] = [];
  const listener = (req: Request) => {
    if (counted(req, origin)) seen.push(req);
  };
  page.on('request', listener);
  try {
    await act();
    await page.waitForLoadState('networkidle');
  } finally {
    page.off('request', listener);
  }
  return seen;
}

function assertBudget(label: string, requests: Request[], { maxTotal = 8 }: { maxTotal?: number } = {}) {
  const lines = requests.map((r) => `${r.method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`);

  // 1. Still a soft navigation: a document request means a full reload.
  const documents = requests.filter((r) => r.resourceType() === 'document');
  expect(
    documents.map((d) => d.url()),
    `${label}: navigation caused a full document load`,
  ).toEqual([]);

  // 2. No endpoint is asked twice within one navigation.
  const duplicates = lines.filter((line, index) => lines.indexOf(line) !== index);
  expect(duplicates, `${label}: duplicate requests within one navigation`).toEqual([]);

  // 3. The total stays small.
  expect(lines.length, `${label}: request budget exceeded — fired:\n${lines.join('\n')}`).toBeLessThanOrEqual(maxTotal);
}

test.describe('Request budget: the five hot navigations', () => {
  test.beforeAll(resetLoginThrottle);

  const run = uniq();
  const workspace = {
    displayName: `Budget ${run}`,
    slug: `budget-${run}`,
    adminName: 'Budget Admin',
    adminEmail: `admin.budget.${run}@masterapp.local`,
    adminPassword: strongPassword(`bg${run}`),
    modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
  };
  const leadName = `Budget Lead ${run}`;

  test('each navigation is soft, duplicate-free and under budget', async ({ page, baseURL }) => {
    const origin = baseURL!;

    await test.step('setup: workspace, admin, one lead', async () => {
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, workspace);
      await logout(page);
      await login(page, workspace.adminEmail, workspace.adminPassword);

      await page.goto(`/${workspace.slug}/sales/leads/new`);
      await expect(page.getByRole('heading', { name: 'Add lead' })).toBeVisible();
      await page.getByLabel('Full name').fill(leadName);
      await page.getByLabel('Email').fill(`budget.lead.${run}@example.com`);
      const [created] = await Promise.all([
        page.waitForResponse((res) => res.url().includes('/api/v1/leads') && res.request().method() === 'POST'),
        page.getByRole('button', { name: 'Create lead' }).click(),
      ]);
      expect(created.status(), await created.text()).toBeLessThan(300);
    });

    await test.step('warmup: compile/visit every route once', async () => {
      // First visits pay dev-server route compilation; the measured pass below
      // must observe steady-state behaviour, not compile time.
      for (const path of ['/dashboard', '/sales/leads', '/people/employees', '/admin/settings']) {
        await page.goto(`/${workspace.slug}${path}`);
        await page.waitForLoadState('networkidle');
      }
    });

    // Measured pass — every navigation via the persistent chrome.
    await test.step('leads list', async () => {
      await page.goto(`/${workspace.slug}/dashboard`);
      await page.waitForLoadState('networkidle');
      const requests = await requestsDuring(page, origin, async () => {
        await page.locator(`aside a[href="/${workspace.slug}/sales/leads"]`).first().click();
        await expect(page.getByText(leadName)).toBeVisible();
      });
      assertBudget('dashboard → leads list', requests);
    });

    await test.step('lead detail', async () => {
      const requests = await requestsDuring(page, origin, async () => {
        await page.getByRole('link', { name: leadName }).first().click();
        await expect(page).toHaveURL(/\/sales\/leads\/[^/]+$/);
        await expect(page.getByText(leadName).first()).toBeVisible();
      });
      assertBudget('leads list → lead detail', requests);
    });

    await test.step('dashboard, via the top bar', async () => {
      // Directly guards the TopBar Dashboard control staying a <Link>: as a raw
      // <a> this click is a document load and the assertion fails.
      const requests = await requestsDuring(page, origin, async () => {
        // exact: the sidebar brand link's label is "<workspace> dashboard".
        await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/dashboard`));
      });
      assertBudget('lead detail → dashboard', requests);
    });

    await test.step('employees', async () => {
      // Module switch first (its own navigation, not measured), then the item.
      await page.locator(`a[href="/${workspace.slug}/people"]`).first().click();
      await page.waitForLoadState('networkidle');
      const requests = await requestsDuring(page, origin, async () => {
        await page.locator(`aside a[href="/${workspace.slug}/people/employees"]`).first().click();
        await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible();
      });
      assertBudget('people → employees', requests);
    });

    await test.step('settings', async () => {
      // The HR chrome has no product switcher by design; Overview is the way
      // back to the sales chrome, where the admin section lives.
      await page.locator(`aside a[href="/${workspace.slug}/dashboard"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/dashboard`));
      await page.waitForLoadState('networkidle');
      const requests = await requestsDuring(page, origin, async () => {
        await page.locator(`aside a[href="/${workspace.slug}/admin/settings"]`).first().click();
        await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/admin/settings`));
      });
      assertBudget('sales → settings', requests);
    });
  });
});
