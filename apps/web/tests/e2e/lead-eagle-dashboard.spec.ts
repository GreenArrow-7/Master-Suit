import { test, expect, type Page } from '@playwright/test';
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
 * The Lead Eagle board (audit rows M3-01–05, M3-09–15) in a wizard-made
 * Lead-Eagle-only workspace: its tiles and charts at 1280 and 390 px, light and
 * dark, with no sideways scroll on a phone, and a tile opening the list of what
 * it counted: Callbacks lists the call due today and not the meeting due today;
 * Untouched lists the leads nobody has contacted; Overdue the one from two days
 * ago.
 */
test.describe.configure({ mode: 'serial' });

test.describe('The Lead Eagle board', () => {
  const run = uniq();
  const eagle = {
    displayName: `Eagle Board ${run}`,
    slug: `eagle-board-${run}`,
    adminName: 'Board Administrator',
    adminEmail: `admin.board.${run}@masterapp.local`,
    adminPassword: strongPassword(`bd${run}`),
    modules: ['LEAD_EAGLE' as const],
  };
  const at = (path: string) => `/${eagle.slug}${path}`;
  const FRESH = `Fresh Board Lead ${run}`;
  const CALLED = `Called Board Lead ${run}`;

  /** A time later today in Dubai (at least a minute ahead), or `days` from now. */
  function due(days = 0) {
    if (days) return new Date(Date.now() + days * 86_400_000).toISOString();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
    const [y, m, d] = today.split('-').map(Number);
    const lateToday = Date.UTC(y!, m! - 1, d!, 19, 0); // 23:00 in Dubai
    return new Date(Math.max(Date.now() + 60_000, Math.min(lateToday, Date.now() + 3_600_000))).toISOString();
  }

  /** The figure a tile shows. */
  const figure = (page: Page, label: string) =>
    page.locator('a.lf-card', { has: page.locator('.lf-eyebrow', { hasText: new RegExp(`^${label}$`) }) });

  test.beforeAll(resetLoginThrottle);

  test('tiles and charts at desktop and phone width, each opening its list', async ({ page }) => {
    await test.step('a Lead-Eagle-only workspace with two leads and three follow-ups', async () => {
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, eagle);
      await logout(page);
      await login(page, eagle.adminEmail, eagle.adminPassword);
      const stamp = String(Date.now()).slice(-7);
      const ids: string[] = [];
      for (const [index, fullName] of [FRESH, CALLED].entries()) {
        const res = await page.request.post('/api/v1/leads', { data: { fullName, phone: `+97155${index}${stamp}` } });
        expect(res.status(), await res.text()).toBeLessThan(300);
        ids.push((await res.json()).id);
      }
      // One lead called: it is no longer untouched.
      const logged = await page.request.post(`/api/v1/leads/${ids[1]}/call-log`, { data: { outcome: 'Connected' } });
      expect(logged.status(), await logged.text()).toBe(200);
      for (const [title, dueAt, kind] of [
        [`Ring back ${run}`, due(), 'CALL'],
        [`Show the villa ${run}`, due(), 'MEETING'],
        [`Missed call ${run}`, due(-2), 'CALL'],
      ]) {
        const res = await page.request.post('/api/v1/follow-ups', { data: { leadId: ids[0], title, dueAt, kind } });
        expect(res.status(), await res.text()).toBeLessThan(300);
      }
    });

    await test.step('1280 px: every tile and chart, with today’s callbacks apart from today’s follow-ups', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(at('/lead-eagle/dashboard'));
      await expect(page.getByRole('heading', { name: 'Lead Eagle' })).toBeVisible();
      await expect(figure(page, 'Due Today').locator('.lf-hero-figure')).toHaveText('2');
      await expect(figure(page, 'Callbacks').locator('.lf-hero-figure')).toHaveText('1');
      await expect(figure(page, 'Overdue').locator('.lf-hero-figure')).toHaveText('1');
      await expect(figure(page, 'Untouched').locator('.lf-hero-figure')).toHaveText('1');
      await expect(figure(page, 'Total Leads').locator('.lf-hero-figure')).toHaveText('2');
      for (const panel of [
        'Leads by Stage',
        'Leads by Source',
        'Received vs Worked',
        'Follow-ups This Week',
        'Calls',
      ]) {
        await expect(page.getByRole('heading', { name: panel, exact: true })).toBeVisible();
      }
      await expect(page.getByRole('heading', { name: 'Leaderboard', exact: true })).toBeVisible();
      await expect(page.getByText('Revenue Today')).toHaveCount(0);
      await page.screenshot({ path: `test-results/lead-eagle-board-1280-${run}.png`, fullPage: true });
    });

    await test.step('Callbacks opens the call due today, and not the meeting', async () => {
      await figure(page, 'Callbacks').click();
      await expect(page).toHaveURL(new RegExp(`${at('/lead-eagle/follow-ups')}\\?due=today&kind=CALL$`));
      await expect(page.getByText(`Ring back ${run}`)).toBeVisible();
      await expect(page.getByText(`Show the villa ${run}`)).toHaveCount(0);
      await expect(page.getByText(`Missed call ${run}`)).toHaveCount(0);
    });

    await test.step('390 px, light and dark: no sideways scroll; Untouched opens the uncontacted lead', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(at('/lead-eagle/dashboard'));
      await expect(figure(page, 'Untouched')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.screenshot({ path: `test-results/lead-eagle-board-390-${run}.png`, fullPage: true });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.screenshot({ path: `test-results/lead-eagle-board-390-dark-${run}.png`, fullPage: true });
      await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));

      await figure(page, 'Untouched').click();
      await expect(page).toHaveURL(new RegExp(`${at('/lead-eagle/leads')}\\?filter=untouched$`));
      await expect(page.getByText(FRESH).first()).toBeVisible();
      await expect(page.getByText(CALLED)).toHaveCount(0);
    });

    await test.step('390 px: Overdue in the week strip opens the follow-up from two days ago', async () => {
      await page.goto(at('/lead-eagle/dashboard'));
      await page.locator('.lf-strip__day[data-tone="overdue"]').click();
      await expect(page).toHaveURL(new RegExp(`${at('/lead-eagle/follow-ups')}\\?due=overdue$`));
      await expect(page.getByText(`Missed call ${run}`).first()).toBeVisible();
      await expect(page.getByText(`Ring back ${run}`)).toHaveCount(0);
    });
  });
});
