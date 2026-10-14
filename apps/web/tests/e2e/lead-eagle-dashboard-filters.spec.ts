import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
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
 * The Lead Eagle board's filters and drill-down (audit rows M3-16, M3-17,
 * M3-18) in a wizard-made Lead-Eagle-only workspace: a manager picks the last
 * 7 days, a team and a project; opened again with nothing in the URL the
 * board puts the choice back; the Calls panel and a leaderboard cell open
 * lists of exactly what they counted, logged calls included; at 1280 and 390
 * px, light and dark, with no sideways scroll on a phone.
 */
test.describe.configure({ mode: 'serial' });

test.describe('The Lead Eagle board’s filters', () => {
  const run = uniq();
  const eagle = {
    displayName: `Eagle Filters ${run}`,
    slug: `eagle-filters-${run}`,
    adminName: 'Filters Manager',
    adminEmail: `admin.filters.${run}@masterapp.local`,
    adminPassword: strongPassword(`fl${run}`),
    modules: ['LEAD_EAGLE' as const],
  };
  const at = (path: string) => `/${eagle.slug}${path}`;
  const IN_PROJECT = `Project Lead ${run}`;
  const ELSEWHERE = `Other Lead ${run}`;
  const TEAM = `Closers ${run}`;
  const PROJECT = `Marina Heights ${run}`;

  /** The team, seeded as the app would under row-level security: no screen makes teams yet. */
  async function seedTeam() {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
    try {
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: eagle.slug } });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        const admin = await tx.user.findFirstOrThrow({ where: { tenantId: tenant.id, email: eagle.adminEmail } });
        const team = await tx.team.create({ data: { tenantId: tenant.id, name: TEAM, code: `C-${run}` } });
        await tx.userTeam.create({ data: { tenantId: tenant.id, userId: admin.id, teamId: team.id } });
      });
    } finally {
      await prisma.$disconnect();
    }
  }

  const callFigure = (page: Page, word: string) =>
    page.locator('.lf-callfigures a', { hasText: new RegExp(`\\b${word}$`) });

  test.beforeAll(resetLoginThrottle);

  test('a manager filters, comes back to the same choice, and drills into calls', async ({ page }) => {
    await test.step('a workspace with a project, two leads (one interested in it) and a call logged on each', async () => {
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, eagle);
      await logout(page);
      await login(page, eagle.adminEmail, eagle.adminPassword);
      await seedTeam();
      const project = await page.request.post('/api/v1/projects', { data: { name: PROJECT, code: `MH-${run}` } });
      expect(project.status(), await project.text()).toBeLessThan(300);
      const projectId = (await project.json()).id;
      const stamp = String(Date.now()).slice(-7);
      for (const [index, fullName] of [IN_PROJECT, ELSEWHERE].entries()) {
        const res = await page.request.post('/api/v1/leads', { data: { fullName, phone: `+97156${index}${stamp}` } });
        expect(res.status(), await res.text()).toBeLessThan(300);
        const leadId = (await res.json()).id;
        if (fullName === IN_PROJECT) {
          const interest = await page.request.post(`/api/v1/leads/${leadId}/interests`, { data: { projectId } });
          expect(interest.status(), await interest.text()).toBeLessThan(300);
        }
        const logged = await page.request.post(`/api/v1/leads/${leadId}/call-log`, {
          data: { outcome: 'Connected' },
        });
        expect(logged.status(), await logged.text()).toBe(200);
      }
    });

    await test.step('1280 px: last 7 days, the team and the project narrow the board', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(at('/lead-eagle/dashboard'));
      await expect(callFigure(page, 'made').locator('strong')).toHaveText('2');
      await page.locator('.lf-boardfilter > summary').click();
      await page.locator('select[name=range]').selectOption('7d');
      await page.locator('select[name=team]').selectOption({ label: TEAM });
      await page.locator('select[name=project]').selectOption({ label: PROJECT });
      await page.getByRole('button', { name: 'Apply' }).click();
      await expect(page).toHaveURL(/range=7d&team=[^&]+&project=/);
      await expect(page.locator('.lf-boardfilter > summary')).toContainText(`Last 7 days · ${TEAM} · ${PROJECT}`);
      await expect(callFigure(page, 'made').locator('strong')).toHaveText('1');
      await page.screenshot({ path: `test-results/lead-eagle-filters-1280-${run}.png`, fullPage: true });
    });

    await test.step('opened again with nothing in the URL, the board puts the choice back', async () => {
      await page.goto(at('/lead-eagle/dashboard'));
      await expect(page).toHaveURL(/range=7d&team=[^&]+&project=/);
      await expect(callFigure(page, 'made').locator('strong')).toHaveText('1');
    });

    await test.step('Calls made opens the call it counted: the logged call on the project’s lead', async () => {
      await callFigure(page, 'made').click();
      await expect(page).toHaveURL(/\/lead-eagle\/calls\?tab=placed&logged=1&from=.*&project=/);
      await expect(page.getByText('0 placed and 1 logged')).toBeVisible();
      const logged = page.locator('[data-logged-call]');
      await expect(logged).toHaveCount(1);
      await expect(logged.getByText(IN_PROJECT)).toBeVisible();
    });

    await test.step('a leaderboard cell opens the calls it counted', async () => {
      await page.goto(at('/lead-eagle/dashboard'));
      const cell = page.locator('.lf-leaderboard tbody tr').first().locator('td').first();
      await expect(cell).toHaveText('1');
      await cell.locator('a').click();
      await expect(page).toHaveURL(/\/lead-eagle\/calls\?tab=completed&logged=1&owner=/);
      await expect(page.locator('[data-logged-call]')).toHaveCount(1);
      await expect(page.getByText(ELSEWHERE)).toHaveCount(0);
    });

    await test.step('390 px, light and dark: the filter bar folds to a line, no sideways scroll', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(at('/lead-eagle/dashboard'));
      await expect(page.locator('.lf-boardfilter > summary')).toBeVisible();
      await expect(page.locator('select[name=range]')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.locator('.lf-boardfilter > summary').click();
      await expect(page.locator('select[name=range]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.screenshot({ path: `test-results/lead-eagle-filters-390-${run}.png`, fullPage: true });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.screenshot({ path: `test-results/lead-eagle-filters-390-dark-${run}.png`, fullPage: true });
      await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    });

    await test.step('Clear forgets the choice', async () => {
      await page.getByRole('link', { name: 'Clear' }).click();
      await page.goto(at('/lead-eagle/dashboard'));
      await expect(page).toHaveURL(new RegExp(`${at('/lead-eagle/dashboard')}$`));
      await expect(callFigure(page, 'made').locator('strong')).toHaveText('2');
    });
  });
});
