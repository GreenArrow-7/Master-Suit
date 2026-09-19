import { test, expect } from '@playwright/test';
import path from 'node:path';
import { login, resetLoginThrottle } from './helpers';

/**
 * Spreadsheet import through the real screen: an Excel file with customer-style
 * headings is read in the browser, its columns are matched to lead fields, the rows
 * with problems are shown before anything is created, and the good rows land as
 * IMPORT-sourced leads. Runs against the seeded demo workspace when its credentials
 * are provided; skipped otherwise.
 */
const slug = process.env.E2E_DEMO_SLUG;
const email = process.env.E2E_DEMO_EMAIL;
const password = process.env.E2E_DEMO_PASSWORD;

test.describe('lead import from a spreadsheet', () => {
  test.skip(!slug || !email || !password, 'E2E_DEMO_SLUG / E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD not set');
  test.beforeEach(resetLoginThrottle);

  test('detects columns, previews problems, imports the good rows', async ({ page }) => {
    await login(page, email!, password!);
    await page.goto(`/${slug}/sales/leads`);
    await page.getByRole('button', { name: 'Import' }).click();
    await page.getByLabel('Spreadsheet file').setInputFiles(path.join(__dirname, 'fixtures', 'leads-sample.xlsx'));

    // Customer headings were matched without the user typing internal field names.
    await expect(page.getByLabel('Import "Name" as')).toHaveValue('fullName');
    await expect(page.getByLabel('Import "Mobile Number" as')).toHaveValue('phone');
    await expect(page.getByLabel('Import "Email" as')).toHaveValue('email');
    await expect(page.getByLabel('Import "Location" as')).toHaveValue('city');
    await expect(page.getByLabel('Import "Budget" as')).toHaveValue('notes+');

    // Two bad rows are named before import; the blank row is not counted at all.
    await expect(page.getByText('Line 4: Full name is missing')).toBeVisible();
    await expect(page.getByText(/Line 5: Invalid email/)).toBeVisible();
    await expect(page.getByText('1 repeat a phone or email within the file')).toBeVisible();

    await page.getByRole('button', { name: /^Import \d+ leads?$/ }).click();
    await expect(page.getByText(/^\d+ leads? created\.$/)).toBeVisible({ timeout: 60_000 });

    const created = await page.request.get(`/api/v1/leads?q=Omar%20Farouk`);
    expect(created.ok(), await created.text()).toBeTruthy();
    const body = await created.json();
    const rows: { id: string; fullName: string; source: string }[] = body.items ?? body.data ?? body;
    const omar = rows.find((r) => r.fullName === 'Omar Farouk');
    expect(omar?.source).toBe('IMPORT');
    // The list projects a column set; the record itself carries the mapped city.
    const detail = await (await page.request.get(`/api/v1/leads/${omar!.id}`)).json();
    expect(detail.city ?? detail.data?.city).toBe('Abu Dhabi');
  });
});
