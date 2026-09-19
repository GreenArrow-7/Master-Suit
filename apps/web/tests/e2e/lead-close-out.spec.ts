import { test, expect } from '@playwright/test';
import { login, resetLoginThrottle } from './helpers';

/**
 * Closing a lead out from the detail screen: More → Archive removes it from the
 * working list and shows the state; the "Closed out" view lists it; Reopen brings
 * it back. Runs against the seeded demo workspace when its credentials are given.
 */
const slug = process.env.E2E_DEMO_SLUG;
const email = process.env.E2E_DEMO_EMAIL;
const password = process.env.E2E_DEMO_PASSWORD;

test.describe('lead close-out from the detail screen', () => {
  test.skip(!slug || !email || !password, 'E2E_DEMO_SLUG / E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD not set');
  test.beforeEach(resetLoginThrottle);

  test('archive, see it under Closed out, reopen', async ({ page }) => {
    await login(page, email!, password!);

    const created = await page.request.post('/api/v1/leads', {
      data: { fullName: `Close Out ${Date.now()}`, phone: `05${String(Date.now()).slice(-8)}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const lead = await created.json();

    await page.goto(`/${slug}/sales/leads/${lead.id}`);
    await page.getByRole('button', { name: /^More/ }).click();
    await page.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByText('archived', { exact: true })).toBeVisible();

    await page.goto(`/${slug}/sales/leads`);
    await expect(page.getByRole('link', { name: lead.reference })).toHaveCount(0);
    await page.getByRole('link', { name: 'Closed out' }).click();
    await expect(page.getByRole('link', { name: lead.reference })).toBeVisible();

    await page.goto(`/${slug}/sales/leads/${lead.id}`);
    await page.getByRole('button', { name: /^More/ }).click();
    await page.getByRole('button', { name: 'Reopen lead' }).click();
    await expect(page.getByText('archived', { exact: true })).toHaveCount(0);
  });
});
