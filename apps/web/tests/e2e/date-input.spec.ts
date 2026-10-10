import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * The shared date field (components/forms/DateInput.tsx), on a real screen: the
 * Attendance filter, whose From/To go to the address bar, so what the form
 * submits is visible. Typed DD/MM/YYYY and the calendar both fill it; an
 * impossible date is refused with a reason and stops the submit; the calendar
 * button is visible on the dark themes; the field fits a phone.
 */
const slug = process.env.E2E_DEMO_SLUG ?? '';
const email = process.env.E2E_DEMO_EMAIL ?? '';
const password = process.env.E2E_DEMO_PASSWORD ?? '';

const field = (page: Page, name: string) => page.getByLabel(name, { exact: true });
const calendar = (page: Page, name: string) =>
  page.locator('.lf-date', { has: field(page, name) }).locator('input.lf-date__native');

test.describe('date field', () => {
  test.skip(!slug || !email || !password, 'E2E_DEMO_SLUG / E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD not set');

  test('takes a typed date and a calendar pick, and submits YYYY-MM-DD', async ({ page }) => {
    await login(page, email, password);
    await page.goto(`/${slug}/people/attendance`);

    await field(page, 'From').fill('01/10/2026');
    await calendar(page, 'To').fill('2026-10-05');
    await expect(field(page, 'To')).toHaveValue('05/10/2026');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page).toHaveURL(/from=2026-10-01/);
    await expect(page).toHaveURL(/to=2026-10-05/);
    // Back from the server as the same day, in the one format the app shows.
    await expect(field(page, 'From')).toHaveValue('01/10/2026');
    await expect(field(page, 'To')).toHaveValue('05/10/2026');
  });

  test('refuses a date that does not exist, says why, and does not submit', async ({ page }) => {
    await login(page, email, password);
    await page.goto(`/${slug}/people/attendance`);
    const before = page.url();

    await field(page, 'From').fill('31/04/2026');
    await field(page, 'From').blur();
    await expect(page.getByText('Enter a real date as DD/MM/YYYY.')).toBeVisible();
    await expect(field(page, 'From')).toHaveAttribute('aria-invalid', 'true');

    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(before);
  });

  test('draws its calendar button on the dark theme and fits a phone', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await login(page, email, password);
    await page.goto(`/${slug}/people/attendance`);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    // Native controls follow the theme: the calendar is drawn light on dark.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');

    const button = page.getByRole('button', { name: 'Choose a date from the calendar' }).first();
    await expect(button).toBeVisible();
    const box = (await page.locator('.lf-date').first().boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390 + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await context.close();
  });
});
