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
 * Lead Eagle, sold from the platform portal (owner, 5 Oct): the platform owner
 * creates a workspace with Lead Eagle alone, and its administrator works leads in
 * the Lead Eagle section — and reaches none of the money or marketing registers.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Lead Eagle, from the platform portal to a lead', () => {
  const run = uniq();
  const eagle = {
    displayName: `Eagle Realty ${run}`,
    slug: `eagle-${run}`,
    adminName: 'Eagle Administrator',
    adminEmail: `admin.eagle.${run}@masterapp.local`,
    adminPassword: strongPassword(`le${run}`),
    modules: ['LEAD_EAGLE' as const],
  };
  const at = (path: string) => `/${eagle.slug}${path}`;

  test.beforeAll(resetLoginThrottle);

  test('the owner sells it, and its administrator works leads in it', async ({ page }) => {
    await test.step('the platform portal creates a Lead-Eagle-only workspace', async () => {
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, eagle);
      await logout(page);
    });

    await test.step('its administrator lands in Lead Eagle, without bookings or revenue', async () => {
      await login(page, eagle.adminEmail, eagle.adminPassword);
      await page.goto(at('/lead-eagle/dashboard'));
      await expect(page.getByRole('heading', { name: 'Lead Eagle' })).toBeVisible();
      await expect(page.getByText('Revenue Today')).toHaveCount(0);
      await expect(page.getByText('Confirmed Bookings')).toHaveCount(0);
    });

    let leadId = '';
    await test.step('a lead is created and opened under Lead Eagle', async () => {
      const res = await page.request.post('/api/v1/leads', {
        data: { fullName: `Eagle Lead ${run}`, phone: `+97150${String(Date.now()).slice(-7)}` },
      });
      expect(res.status(), await res.text()).toBeLessThan(300);
      leadId = (await res.json()).id;
      await page.goto(at(`/lead-eagle/leads/${leadId}`));
      await expect(page.getByText(`Eagle Lead ${run}`).first()).toBeVisible();
    });

    await test.step('a /sales/ link lands on the same screen under Lead Eagle', async () => {
      await page.goto(at(`/sales/leads/${leadId}`));
      await expect(page).toHaveURL(new RegExp(`/${eagle.slug}/lead-eagle/leads/${leadId}`));
    });

    await test.step('the money and marketing registers are not part of it', async () => {
      await page.goto(at('/realty/collections'));
      await expect(page).toHaveURL(new RegExp(`/${eagle.slug}/dashboard`));
      expect((await page.request.get('/api/v1/collections/receipts')).status()).toBe(403);
      expect((await page.request.get('/api/v1/opportunities')).status()).toBe(403);
    });
  });
});
