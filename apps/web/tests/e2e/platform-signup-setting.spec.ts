import { test, expect, type Page } from '@playwright/test';
import { loginPlatformOwner } from './helpers';

/**
 * Self-serve sign-up is opened from the console. Phase 6 shipped the setting
 * without a row on this page, so the owner had no way to open it (10 Oct). The
 * row also says whether sign-up is actually open, since a trial length alone is
 * not enough without an active plan that includes Lead Eagle.
 */
async function setTrialDays(page: Page, days: string) {
  await page.goto('/platform/settings');
  const row = page.getByRole('row', { name: /Self-serve sign-up/ });
  await row.getByRole('button', { name: 'Edit' }).click();
  await row.getByLabel('signupTrialDays').fill(days);
  await row.getByRole('button', { name: 'Save' }).click();
  return row;
}

test('the console opens self-serve sign-up, and says it is open', async ({ page }) => {
  await loginPlatformOwner(page);

  // An active plan with Lead Eagle, as large as a plan may be, so it is never
  // the smallest one sign-up would choose in a database other specs share.
  const code = `e2e-le-${Date.now().toString(36)}`;
  await page.goto('/platform/plans');
  await page.getByLabel('Plan name').fill('E2E Lead Eagle');
  await page.getByLabel('Plan code').fill(code);
  for (const label of ['People / HRMS', 'Sales CRM', 'Real Estate']) {
    await page.getByLabel(label, { exact: true }).uncheck();
  }
  await page.getByLabel('Maximum users').fill('100000');
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByText(code, { exact: true })).toBeVisible();

  try {
    const row = await setTrialDays(page, '14');
    await expect(row).toContainText('Open at /signup');

    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: 'Start your Lead Eagle trial' })).toBeVisible();
    await expect(page.getByText('14 days free')).toBeVisible();
  } finally {
    // Closed again whatever happened: no other spec expects sign-up open.
    const row = await setTrialDays(page, '0');
    await expect(row).toContainText('Closed');
  }
});
