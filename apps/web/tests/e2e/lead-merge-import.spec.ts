import { readFileSync } from 'node:fs';
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
 * Lead Eagle audit rows M4-31, M4-41, M4-42 and M4-43, in a Lead-Eagle-only
 * workspace: a lead's page names a duplicate of it, the compare screen merges
 * the two (the other's timeline moves over, its page says where it went); and a
 * spreadsheet is checked without saving anything, then imported with matches
 * filled in, and its refused rows download as a CSV. Each screen fits 390 px.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Merging two leads, and an import checked before it runs', () => {
  const run = uniq();
  const eagle = {
    displayName: `Eagle Merge ${run}`,
    slug: `eagle-merge-${run}`,
    adminName: 'Merge Administrator',
    adminEmail: `admin.merge.${run}@masterapp.local`,
    adminPassword: strongPassword(`mg${run}`),
    modules: ['LEAD_EAGLE' as const],
  };
  const at = (path: string) => `/${eagle.slug}${path}`;
  // Leads are unique by number in a workspace: every number here is this run's.
  const digits = String(Date.now()).slice(-7);

  /** No sideways scroll at phone width. */
  async function fitsPhone(page: Page) {
    const desktop = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.setViewportSize(desktop);
  }

  async function newLead(page: Page, data: Record<string, unknown>) {
    const res = await page.request.post('/api/v1/leads', { data });
    expect(res.status(), await res.text()).toBeLessThan(300);
    return (await res.json()) as { id: string; reference: string };
  }

  test.beforeAll(resetLoginThrottle);

  test('a duplicate named on the lead page is merged from the compare screen (M4-31)', async ({ page }) => {
    await test.step('a Lead-Eagle-only workspace is created', async () => {
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, eagle);
      await logout(page);
      await login(page, eagle.adminEmail, eagle.adminPassword);
    });

    const shared = `+97155${digits}`;
    const NOTE = `Asked about Marina towers ${run}`;
    let kept = { id: '', reference: '' };
    let other = { id: '', reference: '' };
    await test.step('two leads share a number; the second has a company and a logged note', async () => {
      kept = await newLead(page, { fullName: `Merge Kept ${run}`, phone: shared });
      other = await newLead(page, {
        fullName: `Merge Other ${run}`,
        phone: shared,
        company: 'Other Co',
        onDuplicate: 'WARN',
      });
      const tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: eagle.slug }, select: { id: true } }))
        .id;
      const type = await prisma.activityType.findFirstOrThrow({ where: { tenantId, key: 'call_out' } });
      const res = await page.request.post('/api/v1/activities', {
        data: { typeId: type.id, leadId: other.id, outcome: 'Spoke', notes: NOTE },
      });
      expect(res.status(), await res.text()).toBeLessThan(300);
    });

    await test.step('the lead page names the duplicate and opens the compare screen', async () => {
      await page.goto(at(`/lead-eagle/leads/${kept.id}`));
      await expect(page.getByText(`May be the same person as ${other.reference}`)).toBeVisible();
      await fitsPhone(page);
      await page.getByRole('link', { name: 'Compare and merge' }).click();
      await expect(
        page.getByRole('heading', { name: `Merge ${other.reference} into ${kept.reference}` }),
      ).toBeVisible();
      // The kept lead has no company: the other's is picked; the names differ and the kept one stays.
      await expect(page.getByLabel(`Company from ${other.reference}`)).toBeChecked();
      await expect(page.getByLabel(`Name from ${kept.reference}`)).toBeChecked();
      await fitsPhone(page);
    });

    await test.step('merging lands on the kept lead, with the other’s note on its timeline', async () => {
      await page.getByRole('button', { name: `Merge into ${kept.reference}` }).click();
      await expect(page).toHaveURL(new RegExp(`/${eagle.slug}/lead-eagle/leads/${kept.id}$`));
      await expect(page.getByText('Other Co').first()).toBeVisible();
      await expect(page.getByText(`May be the same person as`)).toHaveCount(0);
      await page.getByRole('tab', { name: 'Timeline' }).click();
      await expect(page.getByText(NOTE)).toBeVisible();
    });

    await test.step('the other lead’s page says where it went', async () => {
      await page.goto(at(`/lead-eagle/leads/${other.id}`));
      await expect(page.getByText(`${other.reference} was merged into`)).toBeVisible();
      await page.getByRole('link', { name: new RegExp(kept.reference) }).click();
      await expect(page).toHaveURL(new RegExp(`/lead-eagle/leads/${kept.id}$`));
    });
  });

  test('an import is checked without saving, then run, and its refused rows download (M4-41/42/43)', async ({
    page,
  }) => {
    await login(page, eagle.adminEmail, eagle.adminPassword);
    const existing = await newLead(page, { fullName: `Import Existing ${run}`, phone: `+97154${digits}` });
    const csv = [
      'Name,Mobile,Email',
      `Import One ${run},050${digits},`,
      `Import Two ${run},052${digits},two.${run}@import.test`,
      `=HYPERLINK("http://x.test"),053${digits},not-an-email`,
      `Import Existing ${run},054${digits},existing.${run}@import.test`,
    ].join('\n');

    await page.goto(at('/lead-eagle/leads'));
    await page.getByRole('button', { name: 'Import' }).click();
    await page
      .getByLabel('Spreadsheet file')
      .setInputFiles({ name: `expo-${run}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByText('Line 4: Invalid email "not-an-email"')).toBeVisible();
    await page.getByLabel('Rows that match a lead already in the workspace').selectOption('UPDATE');

    await page.getByRole('button', { name: 'Check first' }).click();
    const checked = page.getByRole('status').filter({ hasText: 'Checked, nothing saved' });
    await expect(checked).toContainText('2 would be created · 1 updated · 1 refused');
    await fitsPhone(page);
    const before = await (await page.request.get(`/api/v1/leads?q=${encodeURIComponent(`Import One ${run}`)}`)).json();
    expect((before.items ?? before.data ?? before).length).toBe(0);

    await page.getByRole('button', { name: 'Import 3 leads' }).click();
    await expect(page.getByText('2 leads created.')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('1 lead updated.')).toBeVisible();
    const filled = await (await page.request.get(`/api/v1/leads/${existing.id}`)).json();
    expect(filled.email ?? filled.data?.email).toBe(`existing.${run}@import.test`);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download rejected rows' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`expo-${run}-rejected-rows.csv`);
    const text = readFileSync((await file.path())!, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1).split('\r\n')).toEqual([
      '"Line","Reason","Name","Mobile","Email"',
      `"4","Invalid email ""not-an-email""","'=HYPERLINK(http://x.test)","053${digits}","not-an-email"`,
      '',
    ]);
  });
});
