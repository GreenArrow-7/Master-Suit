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

  test('the owner takes write access from the console, and hands it back', async ({ page }) => {
    /**
     * M-4: the break-glass API existed and the console had no button, so an
     * owner who needed a write had to call the endpoint by hand. That is the
     * kind of friction that gets a control removed rather than obeyed, so the
     * thing worth proving is not that the endpoint works — a unit suite covers
     * that — but that a person can actually use it from the screen.
     */
    await loginPlatformOwner(page);
    await page.goto(`/platform/workspaces/${workspaceId}`);

    const panel = page.locator('.lf-card').filter({ hasText: 'Write access' });
    await expect(panel).toBeVisible();

    const take = panel.getByRole('button', { name: 'Take write access' });
    // Disabled until the reason is a sentence: the console refuses the same
    // input the API refuses, before the round trip rather than after.
    await expect(take).toBeDisabled();
    await panel.getByLabel(/Why do you need to change/).fill('Ticket 4471 — repair a duplicated payroll run.');
    await expect(take).toBeEnabled();

    await take.click();

    // The reason and the clock, both — the countdown is what makes a self-expiring
    // grant legible to whoever is holding it.
    await expect(panel.getByTestId('break-glass-active')).toContainText('Ticket 4471');
    await expect(panel.getByTestId('break-glass-active')).toContainText(/left/);

    await panel.getByRole('button', { name: 'Hand it back now' }).click();

    // Back to the form, which is the only honest rendering of "no access".
    await expect(panel.getByRole('button', { name: 'Take write access' })).toBeVisible();
    await expect(panel.getByTestId('break-glass-active')).toHaveCount(0);
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
