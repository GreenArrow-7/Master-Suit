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
import { PROTECTED_PLATFORM_ROUTES, fetchPlatformRefusal, sessionCookieFor } from './platform-refusal';
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

let hostWorkspaceId = '';

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
    hostWorkspaceId = id;

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

  /**
   * `REG-003` — BUG-008 / SEC-OBS-014, across every protected route and every
   * persona that must not reach it.
   *
   * Asserted on the **body of the refusal**, with redirects not followed. The
   * security property is not "the request was redirected" — it is that the
   * protected page body was never generated. Following the redirect inspects
   * the login page and proves nothing, which is why `fetchPlatformRefusal`
   * owns `maxRedirects: 0` rather than each call site repeating it.
   *
   * Markers are route-specific: a string that only appears if that page's own
   * body rendered. A generic marker list would pass while a different page
   * leaked something else.
   */
  test('no protected platform route leaks its body to an unauthorized caller', async ({ baseURL }) => {
    const routes = PROTECTED_PLATFORM_ROUTES.map((r) => ({
      ...r,
      path: r.path.replace('{workspaceId}', hostWorkspaceId),
    }));
    // Every route the fix covers, not a sample of them.
    expect(routes.length).toBe(11);

    // A signed-in company administrator: `platformRole` USER, correctly refused
    // the control plane. The second persona that must see nothing.
    const admin = await sessionCookieFor(baseURL!, host.adminEmail, host.adminPassword);

    for (const { path, markers } of routes) {
      for (const persona of [undefined, admin]) {
        const who = persona ? 'workspace administrator' : 'anonymous';
        const { response, body } = await fetchPlatformRefusal(baseURL!, path, persona);
        expect(response.status(), `${path} (${who}) should refuse`).toBeGreaterThanOrEqual(300);

        for (const marker of markers) {
          expect(body, `${path} (${who}) leaked "${marker}"`).not.toContain(marker);
        }
        // The workspace this run created, which several of these pages list.
        expect(body, `${path} (${who}) leaked a workspace name`).not.toContain(host.displayName);
      }
    }
  });

  /**
   * The other half of the property: refusing everyone is not a fix, it is an
   * outage. The owner must still get each page.
   */
  test('the platform owner still reaches every protected route', async ({ page }) => {
    await loginPlatformOwner(page);
    for (const { path, markers } of PROTECTED_PLATFORM_ROUTES) {
      const target = path.replace('{workspaceId}', hostWorkspaceId);
      const response = await page.request.get(target);
      expect(response.status(), `${target} should serve the owner`).toBe(200);
      const body = await response.text();
      // Present, not merely 200: the page's own content rendered.
      expect(
        markers.some((m) => body.includes(m)),
        `${target} served the owner no page content`,
      ).toBe(true);
    }
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
