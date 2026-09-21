import { test, expect } from '@playwright/test';
import { login, resetLoginThrottle } from './helpers';

/**
 * The phone redesign's first slice, reproduced from the owner's iPhone
 * screenshots of 20 Sep 2026: content on the screen edge (no gutter), a wide
 * empty search box in the bar, From/To date fields colliding, the same three
 * lead views as tabs and as chips, and metrics buried under the filters.
 * Runs at 390 × 844 and 320 × 568; skips without the demo workspace.
 */
const slug = process.env.E2E_DEMO_SLUG!;
const email = process.env.E2E_DEMO_EMAIL!;
const password = process.env.E2E_DEMO_PASSWORD!;

test.describe('phone redesign: shell, Leads, Leadership', () => {
  test.skip(!slug || !email || !password, 'E2E_DEMO_SLUG / E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD not set');
  test.beforeEach(resetLoginThrottle);
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('shell: 16px gutter, icon search, no page-wide scroll, header below the inset', async ({ page }) => {
    await login(page, email, password);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/${slug}/sales/leads`);
      await expect(page.getByRole('heading', { level: 1, name: 'Leads' })).toBeVisible();
      const probe = await page.evaluate(() => ({
        docWidth: document.documentElement.scrollWidth,
        gutter: getComputedStyle(document.querySelector('.lf-page-main')!).paddingLeft,
        h1Left: Math.round(document.querySelector('h1')!.getBoundingClientRect().left),
        search: document.querySelector('.lf-cmdk-trigger')!.getBoundingClientRect().width,
        title: document.querySelector('.lf-appbar-title')!.getBoundingClientRect().width,
      }));
      expect(probe.docWidth, `document width at ${width}`).toBeLessThanOrEqual(width);
      expect(probe.gutter).toBe('16px');
      expect(probe.h1Left).toBe(16);
      expect(probe.search, 'search is an icon button').toBeLessThanOrEqual(48);
      expect(probe.title, 'the title has room').toBeGreaterThan(60);
    }
  });

  test('leads: search leads, no duplicate view chips, name opens the record', async ({ page }) => {
    await login(page, email, password);
    await page.goto(`/${slug}/sales/leads`);
    await expect(page.getByPlaceholder('Search leads')).toBeVisible();
    const chips = page.getByRole('navigation', { name: 'Saved views' });
    await expect(chips.getByRole('link', { name: 'Mine', exact: true })).toHaveCount(0);
    await expect(chips.getByRole('link', { name: 'Overdue', exact: false }).first()).toBeVisible();
    // The area tabs still carry the three views.
    await expect(page.getByRole('link', { name: 'My Leads' })).toBeVisible();
    const first = page.locator('.lf-grid tbody tr').first();
    await expect(first.getByRole('checkbox')).toBeVisible();
    const name = first.locator('td[data-priority="primary"] a');
    await name.click();
    await expect(page).toHaveURL(/\/sales\/leads\/[a-z0-9]+$/);
  });

  test('leadership: metrics first, filters folded, From/To never collide', async ({ page }) => {
    await login(page, email, password);
    await page.goto(`/${slug}/sales/leadership`);
    const filters = page.locator('details.lf-report-filters');
    await expect(filters).not.toHaveAttribute('open', '');
    await expect(filters.locator('summary')).toContainText('This month');
    // The first figure sits above the fold, before any filter control.
    const figure = page.locator('.lf-stat-strip .lf-figure').first();
    await expect(figure).toBeVisible();
    expect((await figure.boundingBox())!.y).toBeLessThan(700);

    await filters.locator('summary').click();
    await expect(page.locator('.lf-report-filters__form input[name=from]')).toBeVisible();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const [from, to] = await Promise.all([
        page.locator('.lf-report-filters__form input[name=from]').boundingBox(),
        page.locator('.lf-report-filters__form input[name=to]').boundingBox(),
      ]);
      const apart = from!.x + from!.width <= to!.x || to!.x + to!.width <= from!.x || from!.y + from!.height <= to!.y;
      expect(apart, `From/To apart at ${width}`).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    // A chosen period opens the panel and is named in its summary.
    await page.goto(`/${slug}/sales/leadership?period=30d`);
    await expect(page.locator('details.lf-report-filters')).toHaveAttribute('open', '');
    await expect(page.locator('details.lf-report-filters summary')).toContainText('Last 30 days');
  });
});
