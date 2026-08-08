import { test, expect } from '@playwright/test';
import {
  createWorkspaceViaWizard,
  login,
  loginPlatformOwner,
  logout,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

/**
 * The platform administration area used to be output only: it listed workspaces
 * and had nowhere to change one. This drives the edit form, then re-reads the
 * page to confirm the change was persisted rather than held in component state.
 *
 * The last case is the one that matters most — a workspace administrator must
 * not reach the platform area at all. An edit form is only as safe as the guard
 * in front of it.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Platform workspace editing', () => {
  const run = uniq();
  const workspace = {
    displayName: `Editable Workspace ${run}`,
    slug: `editable-${run}`,
    adminName: 'Editable Administrator',
    adminEmail: `admin.editable.${run}@masterapp.local`,
    adminPassword: strongPassword(`edt${run}`),
    modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
  };

  const renamed = `Renamed Workspace ${run}`;
  let workspaceId = '';

  test.beforeAll(resetLoginThrottle);

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginPlatformOwner(page);
    workspaceId = await createWorkspaceViaWizard(page, workspace);
    await page.close();
  });

  test('the owner renames a workspace and the change survives a reload', async ({ page }) => {
    await loginPlatformOwner(page);

    await page.goto(`/platform/workspaces/${workspaceId}`);
    await expect(page.getByText(workspace.displayName).first()).toBeVisible();

    await page.getByLabel('Display name', { exact: true }).fill(renamed);
    // Reloading straight after the click races the PATCH, and the reload then
    // legitimately renders the old name.
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/v1/platform/workspaces/') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Save changes' }).click(),
    ]);
    expect(saved.status(), await saved.text()).toBeLessThan(300);

    await page.reload();
    await expect(page.getByLabel('Display name', { exact: true })).toHaveValue(renamed);

    await page.goto('/platform/workspaces');
    await expect(page.getByText(renamed)).toBeVisible();
  });

  test('the rename reaches the workspace itself', async ({ page }) => {
    await logout(page);
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(`/${workspace.slug}/dashboard`);
    await expect(page.getByText(renamed).first()).toBeVisible();
  });

  test('a workspace administrator cannot reach the platform area', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);

    await page.goto('/platform/workspaces');
    await expect(page.getByLabel('Display name', { exact: true })).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/platform\/workspaces$/);

    // And not through the API either, which is the door the form uses.
    const res = await page.request.patch(`/api/v1/platform/workspaces/${workspaceId}`, {
      data: { displayName: 'Escalated' },
    });
    expect([401, 403, 404]).toContain(res.status());
  });
});
