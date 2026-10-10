import { test, expect } from '@playwright/test';
import { loginPlatformOwner } from './helpers';

/**
 * Creating a plan from the console. The form read `event.currentTarget` after
 * its await — React has cleared it by then — so a plan that had just been
 * created was reported as "The server could not be reached." and the list
 * never refreshed (8 Oct, production).
 */
test('a plan created from the console appears in the list, with no error', async ({ page }) => {
  await loginPlatformOwner(page);
  await page.goto('/platform/plans');
  const code = `e2e-plan-${Date.now().toString(36)}`;
  await page.getByLabel('Plan name').fill('E2E plan');
  await page.getByLabel('Plan code').fill(code);
  // One module, and not Lead Eagle: an active plan with Lead Eagle is what
  // opens self-serve sign-up, and plans cannot be deleted.
  for (const label of ['Sales CRM', 'Real Estate', 'Lead Eagle']) {
    await page.getByLabel(label, { exact: true }).uncheck();
  }
  await page.getByRole('button', { name: 'Create plan' }).click();

  await expect(page.getByText(code, { exact: true })).toBeVisible();
  await expect(page.getByText('The server could not be reached.')).toHaveCount(0);
  await expect(page.getByLabel('Plan code')).toHaveValue('');
});
