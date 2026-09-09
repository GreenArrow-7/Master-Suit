/**
 * Who may create a workspace, from the screen rather than from the route.
 *
 * The reported symptom was "users/administrators are unable to create a
 * workspace", and the API answered `201` throughout — so the question was never
 * whether provisioning works but whether each persona is told the truth about
 * it. A company administrator is `platformRole` `USER` and is correctly refused
 * the control plane (`lib/auth/platform-policy.ts`: "`USER` — an ordinary
 * workspace member — is deliberately not privileged here"). Refusing them is
 * right. Refusing them by throwing them onto a sign-in screen while they are
 * signed in is what made it read as the application being broken.
 */
import { expect, test } from '@playwright/test';
import {
  createWorkspaceViaWizard,
  login,
  loginPlatformOwner,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

const run = uniq();
const host = {
  displayName: `Personas ${run}`,
  slug: `personas-${run}`,
  adminName: 'Personas Administrator',
  adminEmail: `admin.personas.${run}@masterapp.local`,
  adminPassword: strongPassword(`pw${run}`),
  modules: ['SALES'] as ('SALES' | 'HRMS')[],
};

test.describe('workspace creation, per persona', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    await resetLoginThrottle();
  });

  /** CASE A — the platform owner. This one must pass. */
  test('the platform owner creates a workspace through the wizard', async ({ page }) => {
    await loginPlatformOwner(page);
    await page.goto('/platform/workspaces');
    await expect(page.getByRole('link', { name: 'Create workspace' }).first()).toBeVisible();

    const id = await createWorkspaceViaWizard(page, host);
    expect(id).toBeTruthy();

    // Provisioned, not merely inserted: the administrator it created can sign
    // in and the workspace's first page loads for them.
    await page.goto(`/platform/workspaces/${id}`);
    await expect(page.getByText(host.displayName).first()).toBeVisible();

    await login(page, host.adminEmail, host.adminPassword);
    await page.goto(`/${host.slug}/dashboard`);
    await expect(page).toHaveURL(new RegExp(`/${host.slug}/dashboard`));
  });

  /** Field-level validation, not the bare words "Validation failed". */
  test('a rejected field is named on the review step', async ({ page }) => {
    await loginPlatformOwner(page);
    await page.goto('/platform/workspaces/new');
    const slug = `reject-${run}`;
    await page.fill('input[name=workspaceName]', 'Reject Co');
    await page.fill('input[name=displayName]', 'Reject');
    await page.fill('input[name=legalName]', 'Reject Co LLC');
    await page.fill('input[name=slug]', slug);
    await page.click('[data-step-panel="1"] button:has-text("Continue")');
    await page.fill('input[name=primaryAdminName]', 'Reject Admin');
    await page.fill('input[name=primaryAdminEmail]', `${slug}@example.com`);
    await page.fill('input[name=primaryAdminPassword]', strongPassword(`rj${run}`));
    await page.click('[data-step-panel="2"] button:has-text("Continue")');
    await page.click('[data-step-panel="3"] button:has-text("Continue")');
    // Both modules off: the client lets it through, the server does not.
    for (const box of await page.locator('[data-step-panel="4"] input[type=checkbox]').all()) await box.uncheck();
    await page.click('[data-step-panel="4"] button:has-text("Continue")');
    await page.click('[data-step-panel="5"] button:has-text("Create workspace")');

    const alert = page.locator('.lf-alert[role=alert]').first();
    await expect(alert).toBeVisible({ timeout: 30_000 });
    // The field, not just the verdict.
    await expect(alert).toContainText('enabledModules');
  });

  /** CASE B — a company administrator. Denied, and told why. */
  test('a workspace administrator is refused the console without being logged out', async ({ page }) => {
    await login(page, host.adminEmail, host.adminPassword);
    await page.goto('/platform/workspaces/new');

    await expect(page).toHaveURL(/\/no-platform-access$/);
    await expect(page.getByText(/platform console is not part of your account/i)).toBeVisible();
    // The specific regression: they must not land on the sign-in screen.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);

    // And the API refuses independently of anything the screen did.
    const refused = await page.request.post('/api/v1/platform/workspaces', { data: {} });
    expect(refused.status()).toBe(403);
  });
});
