/**
 * Two sign-in behaviours the mobile app depends on.
 *
 * 1. A link opened while signed out (a notification, a shared link, an app deep
 *    link) returns to that screen after sign-in — and only to a screen in one of
 *    the account's own workspaces, never to another site.
 * 2. Changing your password keeps the device that made the change signed in and
 *    ends every other session, as the security screen says.
 */
import { test, expect, devices, type Browser } from '@playwright/test';
import { createWorkspaceViaWizard, login, loginPlatformOwner, resetLoginThrottle, strongPassword } from './helpers';
import { RUN_TAG } from './run-tag';

const workspace = {
  displayName: `Return ${RUN_TAG}`,
  slug: `ret${RUN_TAG}`.toLowerCase(),
  adminName: 'Return Admin',
  adminEmail: `ret-admin-${RUN_TAG}@masterapp.local`,
  adminPassword: strongPassword(`ret${RUN_TAG}`),
  modules: ['SALES'] as 'SALES'[],
};
const at = (path: string) => `/${workspace.slug}${path}`;
const phone = { ...devices['Pixel 7'] };

async function signInOnForm(page: import('@playwright/test').Page, email: string, password: string) {
  await resetLoginThrottle();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

async function freshPhone(browser: Browser) {
  const context = await browser.newContext(phone);
  return { context, page: await context.newPage() };
}

test.describe('Sign-in return and password change', () => {
  test.describe.configure({ mode: 'serial' });

  test('a workspace to sign in to', async ({ browser }) => {
    const page = await browser.newPage();
    await resetLoginThrottle();
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    await page.close();
  });

  test('a link opened while signed out comes back after sign-in, query included', async ({ browser }) => {
    const { context, page } = await freshPhone(browser);
    await page.goto(at('/sales/leads?filter=mine'));
    await expect(page).toHaveURL(/\/login\?next=/);
    await signInOnForm(page, workspace.adminEmail, workspace.adminPassword);
    await expect(page).toHaveURL(new RegExp(`${at('/sales/leads')}\\?filter=mine$`));
    await context.close();
  });

  test('a return target on another site or another workspace is ignored', async ({ browser }) => {
    for (const next of ['//evil.example/x', 'https://evil.example/', '/someone-else-entirely/sales/leads']) {
      const { context, page } = await freshPhone(browser);
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await signInOnForm(page, workspace.adminEmail, workspace.adminPassword);
      await expect(page, next).toHaveURL(new RegExp(`${at('/dashboard')}$`));
      await context.close();
    }
  });

  test('changing the password keeps this phone signed in and signs out the other one', async ({ browser }) => {
    const mine = await freshPhone(browser);
    const other = await freshPhone(browser);
    await resetLoginThrottle();
    await login(mine.page, workspace.adminEmail, workspace.adminPassword);
    await login(other.page, workspace.adminEmail, workspace.adminPassword);
    expect((await other.page.request.get('/api/v1/leads')).status()).toBe(200);

    const next = strongPassword(`ret2${RUN_TAG}`);
    await mine.page.goto(at('/profile/security'));
    await mine.page.getByLabel('Current password', { exact: true }).fill(workspace.adminPassword);
    await mine.page.getByLabel('New password', { exact: true }).fill(next);
    await mine.page.getByRole('button', { name: 'Change password' }).click();
    await expect(mine.page.getByText(/Password changed/)).toBeVisible({ timeout: 30_000 });

    // This phone: still signed in, on the next request and the next screen.
    expect((await mine.page.request.get('/api/v1/leads')).status()).toBe(200);
    await mine.page.goto(at('/sales/leads'));
    await expect(mine.page).toHaveURL(new RegExp(`${at('/sales/leads')}$`));

    // The other phone: signed out.
    expect((await other.page.request.get('/api/v1/leads')).status()).toBe(401);
    await other.page.goto(at('/sales/leads'));
    await expect(other.page).toHaveURL(/\/login/);

    // The old password no longer works; the new one does.
    const fresh = await freshPhone(browser);
    await resetLoginThrottle();
    await fresh.page.goto('/login');
    await fresh.page.getByLabel('Email').fill(workspace.adminEmail);
    await fresh.page.getByLabel('Password', { exact: true }).fill(workspace.adminPassword);
    await fresh.page.getByRole('button', { name: 'Sign in' }).click();
    await expect(fresh.page.getByRole('alert')).toBeVisible({ timeout: 30_000 });
    await signInOnForm(fresh.page, workspace.adminEmail, next);

    for (const session of [mine, other, fresh]) await session.context.close();
  });
});
