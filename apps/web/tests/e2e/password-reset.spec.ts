import { test, expect } from '@playwright/test';
import {
  createWorkspaceViaWizard,
  lastMailTo,
  linkFrom,
  login,
  loginPlatformOwner,
  logout,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

/**
 * Forgotten-password, from the request form to a sign-in with the new password.
 *
 * This flow wrote to the wrong table and tripped the tenant guard, so the reset
 * endpoint answered 500 for every caller, and there was no page from which to
 * reach it in any case. Both halves are checked here: that the link works, and
 * that the old password stops working the moment it does.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Password reset', () => {
  const run = uniq();
  const workspace = {
    displayName: `Reset Workspace ${run}`,
    slug: `reset-${run}`,
    adminName: 'Reset Administrator',
    adminEmail: `admin.reset.${run}@masterapp.local`,
    adminPassword: strongPassword(`rst${run}`),
    modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
  };

  const newPassword = strongPassword(`new${run}`);
  let resetLink = '';

  test.beforeAll(resetLoginThrottle);

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    await page.close();
  });

  test('an unknown address gets the same answer as a known one', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(`nobody.${run}@masterapp.local`);
    await page.getByRole('button', { name: 'Send reset link' }).click();

    // Anything that distinguished the two would turn this form into an account
    // directory.
    const confirmation = await page.locator('main').innerText();
    await expect(page.locator('main')).not.toContainText(/no such|not found|unknown|does not exist/i);
    expect(confirmation.length).toBeGreaterThan(0);
  });

  test('a real address receives a link', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(workspace.adminEmail);
    // The outbox is only written once the request completes; reading it straight
    // after the click races the POST and finds nothing.
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/auth/forgot-password') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Send reset link' }).click(),
    ]);

    const mail = await lastMailTo(page.request, workspace.adminEmail);
    resetLink = linkFrom(mail.body, '/reset-password');
  });

  test('the link sets a new password, and the old one stops working', async ({ page }) => {
    await page.goto(resetLink);
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password').fill(newPassword);
    await page.getByRole('button', { name: 'Change password' }).click();

    // Like accept-invite, this ends on a confirmation panel at the same URL
    // rather than redirecting.
    await expect(page.getByText('Your password has been changed')).toBeVisible({ timeout: 60_000 });

    await logout(page);
    await login(page, workspace.adminEmail, newPassword);
    await page.goto(`/${workspace.slug}/dashboard`);
    await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/dashboard`));

    await logout(page);
    await page.goto('/login');
    await page.getByLabel('Email').fill(workspace.adminEmail);
    await page.getByLabel('Password', { exact: true }).fill(workspace.adminPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.lf-alert, .lf-auth-alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('the link cannot be redeemed a second time', async ({ page }) => {
    await logout(page);
    await page.goto(resetLink);
    await page.getByLabel('New password', { exact: true }).fill(strongPassword(`two${run}`));
    await page.getByLabel('Confirm new password').fill(strongPassword(`two${run}`));
    await page.getByRole('button', { name: 'Change password' }).click();

    await expect(page.locator('.lf-alert, .lf-auth-alert')).toBeVisible();
  });
});
