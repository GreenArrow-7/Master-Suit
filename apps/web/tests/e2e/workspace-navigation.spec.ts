/**
 * The work-area navigation, driven as the people who use it.
 *
 * An agent sees CRM work and none of finance, HR administration or settings,
 * moves between a work area's tabs, and uses back and forward. A screen the
 * role cannot open refuses it by URL and by API. Finance sees the areas the old
 * sidebar hid from everyone. An administrator's filters survive a tab change,
 * and HR screens are labelled for oversight. Then the same navigation on a phone
 * and a tablet.
 */
import { test, expect, devices, type Browser, type Page } from '@playwright/test';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import {
  createWorkspaceViaWizard,
  login,
  loginPlatformOwner,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

const run = uniq();
const workspace = {
  displayName: `Nav ${run}`,
  slug: `nav-${run}`.toLowerCase(),
  adminName: `Nav Admin ${run}`,
  adminEmail: `nav-admin-${run}@masterapp.local`,
  adminPassword: strongPassword(`nav${run}`),
  modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
};
const password = strongPassword(`n${run}`);
const at = (path: string) => `/${workspace.slug}${path}`;

let tenantId = '';
let agent = { email: '' };
let finance = { email: '' };

type Scope = 'OWN' | 'TEAM' | 'ORGANIZATION';
async function person(label: string, grants: readonly (readonly [string, string, Scope])[]) {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${run}`, name: label, rank: 40, defaultScope: 'OWN' },
  });
  for (const [module, action, scope] of grants) {
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { module_action: { module, action: action as never } },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope },
    });
  }
  const email = `${label}-${run}@masterapp.local`;
  const platformUser = await prisma.platformUser.create({
    data: {
      email,
      normalizedEmail: email,
      fullName: label,
      status: 'ACTIVE',
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      emailVerifiedAt: new Date(),
    },
  });
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: label, roleId: role.id, status: 'ACTIVE' },
  });
  await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  return { email };
}

async function signedIn(
  browser: Browser,
  email: string,
  pw = password,
  profile: 'desktop' | 'phone' | 'tablet' = 'desktop',
) {
  const context = await browser.newContext(
    profile === 'phone'
      ? { ...devices['Pixel 7'] }
      : profile === 'tablet'
        ? { viewport: { width: 820, height: 1100 } }
        : {},
  );
  const page = await context.newPage();
  await resetLoginThrottle();
  await login(page, email, pw);
  return { page, close: () => context.close() };
}

const rail = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });
const tabs = (page: Page, area: string) => page.getByRole('navigation', { name: `${area} screens` });
const currentTab = (page: Page, area: string) => tabs(page, area).locator('[aria-current="page"]');

test.describe('Work-area navigation', () => {
  test.describe.configure({ mode: 'serial' });

  test('a workspace with Sales and People, an agent and a finance officer', async ({ page }) => {
    await resetLoginThrottle();
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: workspace.slug }, select: { id: true } })).id;
    agent = await person('nav-agent', [
      ['leads', 'VIEW', 'OWN'],
      ['leads', 'CREATE', 'OWN'],
      ['contacts', 'VIEW', 'OWN'],
      ['accounts', 'VIEW', 'OWN'],
      ['opportunities', 'VIEW', 'OWN'],
      ['tasks', 'VIEW', 'OWN'],
      ['calls', 'VIEW', 'OWN'],
      ['visits', 'VIEW', 'OWN'],
      ['employee', 'VIEW', 'OWN'],
    ]);
    finance = await person('nav-finance', [
      ['bookings', 'VIEW', 'ORGANIZATION'],
      ['collections', 'VIEW', 'ORGANIZATION'],
      ['commissions', 'VIEW', 'ORGANIZATION'],
      ['commissionslabs', 'VIEW', 'ORGANIZATION'],
    ]);
  });

  test('agent: CRM work only; tabs, back and forward, keyboard', async ({ browser }) => {
    const { page, close } = await signedIn(browser, agent.email);
    try {
      await page.goto(at('/dashboard'));
      for (const area of [
        'My Workspace',
        'Inbox',
        'Leads',
        'Customers',
        'Opportunities',
        'Activities',
        'Calls & Coaching',
        'My HR',
      ])
        await expect(rail(page).getByRole('link', { name: area, exact: true })).toBeVisible();
      for (const area of [
        'Collections',
        'Commissions & Payouts',
        'Settings',
        'Employees',
        'Attendance & Leave',
        'Payroll',
      ])
        await expect(rail(page).getByRole('link', { name: area, exact: true })).toHaveCount(0);
      // Reports offers an agent only what their role opens: the dashboards over
      // their leads, and their own targets. No sales, finance or HR report.
      await rail(page).getByRole('link', { name: 'Reports', exact: true }).click();
      await expect(tabs(page, 'Reports').getByRole('link')).toHaveText(['Dashboards', 'Targets']);

      await rail(page).getByRole('link', { name: 'Leads', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${at('/sales/leads')}$`));
      await expect(tabs(page, 'Leads').getByRole('link')).toHaveText(['All Leads', 'My Leads', 'Unassigned']);
      await expect(currentTab(page, 'Leads')).toHaveText('All Leads');
      await expect(rail(page).getByRole('link', { name: 'Leads', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await page.screenshot({ path: 'test-results/nav-agent-leads.png', fullPage: false });

      await tabs(page, 'Leads').getByRole('link', { name: 'My Leads' }).click();
      await expect(page).toHaveURL(/filter=mine/);
      await expect(currentTab(page, 'Leads')).toHaveText('My Leads');

      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${at('/sales/leads')}$`));
      await expect(currentTab(page, 'Leads')).toHaveText('All Leads');
      await page.goForward();
      await expect(currentTab(page, 'Leads')).toHaveText('My Leads');

      // Keyboard: a tab is a link — focus it and press Enter.
      await tabs(page, 'Leads').getByRole('link', { name: 'Unassigned' }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/filter=unassigned/);
      await expect(currentTab(page, 'Leads')).toHaveText('Unassigned');

      // My HR is labelled for someone who sees only their own records.
      await page.goto(at('/people/check-in'));
      await expect(tabs(page, 'My HR').getByRole('link', { name: 'My Leave' })).toBeVisible();
      await expect(tabs(page, 'My HR').getByRole('link', { name: 'Leave Requests' })).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test('agent: a hidden screen still refuses by URL and by API, and another workspace is not reachable', async ({
    browser,
  }) => {
    const { page, close } = await signedIn(browser, agent.email);
    try {
      await page.goto(at('/sales/collections'));
      await expect(page.getByRole('heading', { name: 'You do not have access to this page' })).toBeVisible();
      await expect(rail(page).getByRole('link', { name: 'Leads', exact: true })).toBeVisible();

      expect((await page.request.get('/api/v1/leadership?view=pl')).status()).toBe(403);

      await page.goto(`/manath-homes/sales/leads`);
      await expect(tabs(page, 'Leads')).toHaveCount(0);
      await expect(page).not.toHaveURL(/\/manath-homes\/sales\/leads$/);
    } finally {
      await close();
    }
  });

  test('finance: Collections and Commissions & Payouts are shown and their tabs work', async ({ browser }) => {
    const { page, close } = await signedIn(browser, finance.email);
    try {
      await page.goto(at('/dashboard'));
      await expect(rail(page).getByRole('link', { name: 'Collections', exact: true })).toBeVisible();
      await rail(page).getByRole('link', { name: 'Commissions & Payouts', exact: true }).click();
      await expect(tabs(page, 'Commissions & Payouts').getByRole('link')).toHaveText([
        'Commissions',
        'Payout Runs',
        'Commission Plans',
      ]);
      await tabs(page, 'Commissions & Payouts').getByRole('link', { name: 'Payout Runs' }).click();
      await expect(page).toHaveURL(/\/sales\/commissions\?view=payouts$/);
      await expect(currentTab(page, 'Commissions & Payouts')).toHaveText('Payout Runs');
      for (const area of ['Leads', 'Settings', 'Employees'])
        await expect(rail(page).getByRole('link', { name: area, exact: true })).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test('administrator: filters survive a tab change; HR screens labelled for oversight; old routes land in their area', async ({
    browser,
  }) => {
    const { page, close } = await signedIn(browser, workspace.adminEmail, workspace.adminPassword);
    try {
      await page.goto(at('/sales/leadership?view=compliance&period=qtd'));
      await expect(currentTab(page, 'Reports')).toHaveText('Team Activity');
      await tabs(page, 'Reports').getByRole('link', { name: 'Finance' }).click();
      await expect(page).toHaveURL(/view=pl/);
      await expect(page).toHaveURL(/period=qtd/);
      await expect(rail(page).getByRole('link', { name: 'Reports', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );

      await page.goto(at('/people/leave'));
      await expect(currentTab(page, 'Attendance & Leave')).toHaveText('Leave Requests');
      await page.goto(at('/people/check-in'));
      await expect(tabs(page, 'My HR').getByRole('link', { name: 'My Leave' })).toHaveCount(0);

      await page.goto(at('/people/users'));
      await expect(currentTab(page, 'Settings')).toHaveText('Users');
      await page.screenshot({ path: 'test-results/nav-admin-settings.png', fullPage: false });
    } finally {
      await close();
    }
  });

  test('phone: the drawer opens, an area closes it, tabs scroll and work', async ({ browser }) => {
    const { page, close } = await signedIn(browser, agent.email, password, 'phone');
    try {
      await page.goto(at('/dashboard'));
      await page.locator('.lf-mobile-nav-button').click();
      await expect(page.locator('.lf-workspace-sidebar')).toBeInViewport();
      await rail(page).getByRole('link', { name: 'Leads', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${at('/sales/leads')}$`));
      await expect(page.locator('.lf-workspace-sidebar')).not.toBeInViewport();
      await expect(tabs(page, 'Leads')).toBeVisible();
      await tabs(page, 'Leads').getByRole('link', { name: 'Unassigned' }).click();
      await expect(page).toHaveURL(/filter=unassigned/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({ path: 'test-results/nav-agent-phone.png', fullPage: false });
    } finally {
      await close();
    }
  });

  test('tablet: the rail collapses to icons that still name their area', async ({ browser }) => {
    const { page, close } = await signedIn(browser, agent.email, password, 'tablet');
    try {
      await page.goto(at('/sales/leads'));
      await expect(page.locator('.lf-workspace-sidebar')).toHaveAttribute('data-collapsed', 'true');
      await expect(rail(page).getByRole('link', { name: 'Leads', exact: true })).toHaveAttribute('title', 'Leads');
      await expect(tabs(page, 'Leads')).toBeVisible();
    } finally {
      await close();
    }
  });
});
