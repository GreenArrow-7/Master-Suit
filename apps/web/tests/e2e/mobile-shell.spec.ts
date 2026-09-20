import { test, expect, type Page } from '@playwright/test';
import { login, resetLoginThrottle } from './helpers';

/**
 * Phone-shell regressions reproduced from the owner's iPhone screenshots of
 * 20 Sep 2026: the Columns editor opened off-screen (x = −219 on Products, past
 * the bottom on Leads), the dark-theme top bar lost its status-bar padding, the
 * tab strip's edge chevrons sat on the labels, and long intro paragraphs pushed
 * the first action below the fold. Runs at 390 × 844 in every theme; skips
 * without the demo workspace.
 */
const slug = process.env.E2E_DEMO_SLUG!;
const email = process.env.E2E_DEMO_EMAIL!;
const password = process.env.E2E_DEMO_PASSWORD!;

const SCREENS = [
  '/dashboard',
  '/sales/leads',
  '/sales/projects',
  '/sales/products',
  '/sales/playbook',
  '/sales/leadership?view=conversion',
  '/admin/audit',
  '/admin/roles',
  '/admin/integrations',
  '/people/settings',
  '/people/recruitment',
  '/people/payroll',
  '/people/attendance',
];

async function setTheme(page: Page, theme: 'light' | 'dark' | 'glass') {
  await page.evaluate((t) => {
    if (t === 'light') localStorage.removeItem('lf-theme');
    else localStorage.setItem('lf-theme', t);
  }, theme);
}

async function columnsSheetFits(page: Page, path: string) {
  await page.goto(`/${slug}${path}`);
  const more = page.locator('details.lf-overflow > summary').first();
  if (await more.count()) await more.click();
  await page.getByRole('button', { name: 'Columns' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Grid columns' });
  await expect(dialog).toBeVisible();
  // The ••• menu it came from is closed, not stacked under it.
  await expect(page.locator('details.lf-overflow[open]')).toHaveCount(0);
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x, `${path}: sheet left edge`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${path}: sheet right edge`).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box.y + box.height, `${path}: sheet bottom edge`).toBeLessThanOrEqual(viewport.height + 0.5);
  await expect(dialog.getByRole('button', { name: 'Save for workspace' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // Focus lands on the button, or on the ••• summary that hid it.
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return `${el?.tagName.toLowerCase()} ${el?.getAttribute('aria-label') ?? el?.textContent?.trim()}`;
  });
  expect(focused, `${path}: focus after closing`).toMatch(/button Columns|summary More actions/);
}

test.describe('phone shell', () => {
  test.skip(!slug || !email || !password, 'E2E_DEMO_SLUG / E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD not set');
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test.beforeEach(resetLoginThrottle);

  for (const theme of ['light', 'dark', 'glass'] as const) {
    test(`${theme}: no sideways scroll, padded top bar, no edge glyphs, help folded`, async ({ page }) => {
      await login(page, email, password);
      await setTheme(page, theme);
      for (const path of SCREENS) {
        await page.goto(`/${slug}${path}`);
        await expect(page.locator('.lf-shell-topbar')).toBeVisible();
        const probe = await page.evaluate(() => {
          const bar = getComputedStyle(document.querySelector('.lf-shell-topbar')!);
          const tabs = document.querySelector('.lf-area-tabs');
          const before = tabs ? getComputedStyle(tabs, '::before').content : 'none';
          return {
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            paddingTop: parseFloat(bar.paddingTop),
            edgeGlyph: before,
            theme: document.documentElement.dataset.theme ?? 'light',
          };
        });
        expect(probe.theme, `${path}: theme applied`).toBe(theme);
        expect(probe.scrollWidth, `${path}: page-wide horizontal scroll`).toBeLessThanOrEqual(probe.innerWidth);
        // 8px of its own plus the status-bar inset (0 in a browser).
        expect(probe.paddingTop, `${path}: top bar padding-top`).toBeGreaterThanOrEqual(8);
        expect(probe.edgeGlyph, `${path}: tab strip edge glyph`).not.toMatch(/[‹›]/);
      }
      // Long explanations sit behind a disclosure, closed by default.
      await page.goto(`/${slug}/admin/audit`);
      const help = page.locator('details.lf-help').first();
      await expect(help).toBeVisible();
      await expect(help).not.toHaveAttribute('open', '');
      await help.locator('summary').click();
      await expect(help).toHaveAttribute('open', '');
    });
  }

  test('Columns editor is a sheet inside the screen on Leads and Products', async ({ page }) => {
    await login(page, email, password);
    await columnsSheetFits(page, '/sales/leads');
    await columnsSheetFits(page, '/sales/products');
  });

  test('a list screen with its own primary action shows one Create, not two', async ({ page }) => {
    await login(page, email, password);
    await page.goto(`/${slug}/sales/leads`);
    await expect(page.locator('.lf-list-header__actions').getByText('Add lead')).toBeVisible();
    await expect(page.locator('.lf-topbar-create')).toBeHidden();
    await page.goto(`/${slug}/admin/audit`);
    await expect(page.locator('.lf-topbar-create')).toBeVisible();
  });
});
