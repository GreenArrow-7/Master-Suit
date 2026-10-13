import { test, expect, type Page } from '@playwright/test';
import { prisma } from '@/lib/db';
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
 * The lead page's second half of record fields (Lead Eagle audit rows M4-05,
 * M4-06, M4-08, M4-11, M4-13), in a Lead-Eagle-only workspace: an administrator
 * defines a custom field; on a lead, the requirement composer saves what the
 * client wants, the custom field is filled in Edit details, a project is picked
 * as an interest and the project page lists the lead, and logging a call
 * raises the score. Each screen fits 390 px.
 */
test.describe.configure({ mode: 'serial' });

test.describe('A lead’s requirement, custom fields, interests and score', () => {
  const run = uniq();
  const eagle = {
    displayName: `Eagle Fields ${run}`,
    slug: `eagle-fields-${run}`,
    adminName: 'Fields Administrator',
    adminEmail: `admin.fields.${run}@masterapp.local`,
    adminPassword: strongPassword(`lf${run}`),
    modules: ['LEAD_EAGLE' as const],
  };
  const at = (path: string) => `/${eagle.slug}${path}`;
  const PROJECT = `Harbour Point ${run}`;
  const LEAD = `Fields Lead ${run}`;

  /** No sideways scroll at phone width. */
  async function fitsPhone(page: Page) {
    const desktop = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.setViewportSize(desktop);
  }

  test.beforeAll(resetLoginThrottle);

  test('an administrator defines a field, and the lead page records what the client wants', async ({ page }) => {
    await test.step('a Lead-Eagle-only workspace is created', async () => {
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, eagle);
      await logout(page);
      await login(page, eagle.adminEmail, eagle.adminPassword);
    });

    await test.step('Administration → Custom fields defines a select (M4-13)', async () => {
      await page.goto(at('/admin/custom-fields'));
      await expect(page.getByRole('heading', { name: 'Custom fields' })).toBeVisible();
      await page.getByLabel('Label').fill('Visa status');
      await page.getByLabel('Type').selectOption({ label: 'Select' });
      await page.getByLabel('Options, comma-separated').fill('Resident, Visit, Golden');
      await page.getByRole('button', { name: 'Add field' }).click();
      await expect(page.getByRole('region', { name: 'Field Visa status' })).toBeVisible();
      await expect(page.getByText('visa_status')).toBeVisible();
      await fitsPhone(page);
    });

    let leadId = '';
    await test.step('a lead and a project exist', async () => {
      const tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: eagle.slug }, select: { id: true } }))
        .id;
      await prisma.project.create({ data: { tenantId, name: PROJECT, code: `HP-${run}` } });
      const res = await page.request.post('/api/v1/leads', {
        data: { fullName: LEAD, phone: `+97150${String(Date.now()).slice(-7)}` },
      });
      expect(res.status(), await res.text()).toBeLessThan(300);
      leadId = (await res.json()).id;
    });

    await test.step('the requirement composer saves purpose, type, sub-type, bedrooms, budget, areas and date (M4-05, M4-08)', async () => {
      await page.goto(at(`/lead-eagle/leads/${leadId}`));
      const card = page.getByRole('region', { name: 'Requirement' });
      await expect(card.getByText('Nothing recorded about what they are looking for.')).toBeVisible();
      await card.getByRole('button', { name: 'Add requirement' }).click();
      await card.getByLabel('Looking to').selectOption('BUY');
      await card.getByLabel('Apartment').check();
      await card.getByLabel('Sub-type').fill('Duplex');
      await card.getByLabel('Bedrooms from').fill('2');
      await card.getByLabel('Bedrooms to').fill('3');
      await card.getByLabel('Budget from (AED)').fill('1500000');
      await card.getByLabel('Budget to (AED)').fill('2500000');
      await card.getByLabel('Areas, comma-separated').fill('Dubai Marina, JLT');
      await card.getByLabel('Needed by').fill('01/03/2027');
      await card.getByRole('button', { name: 'Save requirement' }).click();
      await expect(card.getByText('Requirement saved.')).toBeVisible();
      await page.reload();
      for (const shown of [
        'Buy',
        'Apartment · Duplex',
        '2–3',
        'AED 1,500,000 – 2,500,000',
        'Dubai Marina, JLT',
        '01/03/2027',
      ]) {
        await expect(card.getByText(shown, { exact: true })).toBeVisible();
      }
      await fitsPhone(page);
    });

    await test.step('the custom field is filled in Edit details and stays after a reload (M4-13)', async () => {
      await page.getByRole('button', { name: /More/ }).click();
      await page.getByRole('button', { name: 'Edit details' }).click();
      await page.getByLabel('Visa status').selectOption('Golden');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByLabel('Visa status')).toHaveCount(0);
      await page.reload();
      await expect(page.getByText('Golden', { exact: true })).toBeVisible();
    });

    await test.step('a project picked as an interest is linked, and its page lists the lead (M4-06)', async () => {
      const card = page.getByRole('region', { name: 'Interested in' });
      await card.getByLabel('Add a project').selectOption({ label: PROJECT });
      await card.getByRole('button', { name: 'Add project' }).click();
      await expect(card.getByRole('link', { name: PROJECT })).toBeVisible();
      await fitsPhone(page);

      await card.getByRole('link', { name: PROJECT }).click();
      await expect(page).toHaveURL(new RegExp(`/${eagle.slug}/lead-eagle/projects/c[a-z0-9]{20,}$`));
      const interested = page.getByRole('region', { name: 'Interested leads' });
      await expect(interested.getByRole('link', { name: LEAD })).toBeVisible();
    });

    await test.step('logging an outbound call raises the score bar (M4-11)', async () => {
      const tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: eagle.slug }, select: { id: true } }))
        .id;
      const call = await prisma.activityType.findFirstOrThrow({ where: { tenantId, key: 'call_out' } });
      const res = await page.request.post('/api/v1/activities', {
        data: { typeId: call.id, leadId, outcome: 'Spoke' },
      });
      expect(res.status(), await res.text()).toBeLessThan(300);
      await page.goto(at(`/lead-eagle/leads/${leadId}`));
      await expect(page.locator('.lf-score[title^="Lead score"]')).toHaveAttribute(
        'title',
        `Lead score ${call.scoreDelta} of 100`,
      );
    });
  });
});
