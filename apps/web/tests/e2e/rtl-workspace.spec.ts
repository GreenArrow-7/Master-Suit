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
 * An Arabic workspace reads right to left (audit NFR-09): its language set under
 * Company profile, the Lead Eagle leads screen on a 390 px phone is laid out
 * right to left, nothing scrolls sideways, and the closed menu is off the edge
 * it slides in from. The words stay English until the interface is translated.
 */
test.describe.configure({ mode: 'serial' });

test.describe('A right-to-left workspace', () => {
  const run = uniq();
  const eagle = {
    displayName: `Eagle RTL ${run}`,
    slug: `eagle-rtl-${run}`,
    adminName: 'RTL Administrator',
    adminEmail: `admin.rtl.${run}@masterapp.local`,
    adminPassword: strongPassword(`rt${run}`),
    modules: ['LEAD_EAGLE' as const],
  };
  const at = (path: string) => `/${eagle.slug}${path}`;
  const LEAD = `RTL Buyer ${run}`;

  test.beforeAll(resetLoginThrottle);

  test('the leads screen on a phone is laid out right to left with no sideways scroll', async ({ page }) => {
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, eagle);
    await logout(page);
    await login(page, eagle.adminEmail, eagle.adminPassword);
    const lead = await page.request.post('/api/v1/leads', {
      data: { fullName: LEAD, phone: `+97150${String(Date.now()).slice(-7)}` },
    });
    expect(lead.status(), await lead.text()).toBeLessThan(300);

    // Chosen on the Company profile screen, as an administrator would.
    await page.goto(at('/admin/company'));
    await page.getByLabel('Language').selectOption('ar-AE');
    const saved = page.waitForResponse(
      (r) => r.url().includes(`/settings/company`) && r.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Save changes' }).click();
    expect((await saved).status()).toBe(200);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(at('/lead-eagle/leads'));
    await expect(page.getByText(LEAD).first()).toBeVisible();
    await expect(page.locator('.lf-app-frame')).toHaveAttribute('dir', 'rtl');
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.lf-page-main')!).direction)).toBe('rtl');
    // Measured with the root both ways round. <html> stays left to right, and a
    // left-to-right root cannot scroll to (or count) what a right-to-left frame
    // spills past its left edge; turned right to left, it counts that side.
    const width = await page.evaluate(() => {
      const root = document.documentElement;
      const spill = () => root.scrollWidth - root.clientWidth;
      const right = spill();
      root.dir = 'rtl';
      const left = spill();
      root.removeAttribute('dir');
      return { spill: Math.max(right, left), client: root.clientWidth };
    });
    expect(width.spill).toBeLessThanOrEqual(0);
    // The closed menu waits past the right edge, the side it opens from.
    const rail = await page.locator('.lf-workspace-sidebar').boundingBox();
    if (rail) expect(rail.x).toBeGreaterThanOrEqual(width.client - 1);
  });
});
