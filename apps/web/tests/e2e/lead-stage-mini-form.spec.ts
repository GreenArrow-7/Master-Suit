/**
 * The status mini-form (M4-18) and the stage rail (M4-45), in a Lead Eagle
 * workspace from the wizard, at phone width: the lead page shows the pipeline
 * with its exits apart; moving the lead to Site Visit Scheduled opens a dialog
 * that will not submit without the visit's date, time and project, and the move
 * books the visit, at the time typed on the workspace's clock.
 */
import { test, expect } from '@playwright/test';
import { prisma } from '@/lib/db';
import {
  createWorkspaceViaWizard,
  login,
  loginPlatformOwner,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test.describe('Moving a lead to Site Visit Scheduled', () => {
  const run = uniq();
  const eagle = {
    displayName: `Mini Form ${run}`,
    slug: `miniform-${run}`,
    adminName: 'Mini Form Administrator',
    adminEmail: `admin.miniform.${run}@masterapp.local`,
    adminPassword: strongPassword(`mf${run}`),
    modules: ['LEAD_EAGLE' as const],
  };
  const at = (path: string) => `/${eagle.slug}${path}`;
  // Ten days ahead, as the date field takes it, and as the workspace's day.
  const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const typed = day.split('-').reverse().join('/');

  test.beforeAll(resetLoginThrottle);

  test('through the dialog, with the visit booked in the same step', async ({ browser }) => {
    const owner = await browser.newPage();
    await loginPlatformOwner(owner);
    await createWorkspaceViaWizard(owner, eagle);
    await owner.close();
    const tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: eagle.slug }, select: { id: true } })).id;
    const project = await prisma.project.create({ data: { tenantId, name: `Marina ${run}`, code: `MF-${run}` } });

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, eagle.adminEmail, eagle.adminPassword);
    const created = await page.request.post('/api/v1/leads', {
      data: { fullName: `Visit Lead ${run}`, phone: `+97150${String(Date.now()).slice(-7)}` },
    });
    expect(created.status(), await created.text()).toBeLessThan(300);
    const leadId = (await created.json()).id as string;

    await page.goto(at(`/lead-eagle/leads/${leadId}`));
    const pipeline = page.getByRole('group', { name: 'Pipeline' });
    const exits = page.getByRole('group', { name: 'Exits' });
    await expect(pipeline.locator('[aria-current="step"]')).toHaveAttribute('title', 'New', { timeout: 60_000 });
    await expect(exits.locator('[title="Dropped"]')).toHaveCount(1);
    await expect(exits.locator('[aria-current="step"]')).toHaveCount(0);

    // The Stage row of the record's side panel, not the More or Owner menus.
    const stageButton = page
      .locator('.lf-kv > div', { has: page.locator('dt', { hasText: /^Stage$/ }) })
      .locator('button.lf-kv__btn');
    await stageButton.click();
    await page.locator('.lf-menu__item', { hasText: 'Site Visit Scheduled' }).click();

    const dialog = page.getByRole('dialog', { name: 'Move to Site Visit Scheduled' });
    const move = dialog.getByRole('button', { name: 'Move to Site Visit Scheduled' });
    await expect(dialog).toBeVisible();
    // Without the visit's details the form does not submit.
    await move.click();
    await expect(dialog).toBeVisible();
    expect(await prisma.siteVisit.count({ where: { tenantId, leadId } })).toBe(0);

    await dialog.getByLabel('Visit date and time, date', { exact: true }).fill(typed);
    await dialog.getByLabel('Visit date and time, time', { exact: true }).fill('16:30');
    await dialog.getByLabel('Project', { exact: true }).selectOption({ label: project.name });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await move.click();

    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await expect(stageButton).toContainText('Site Visit Scheduled');
    await expect(pipeline.locator('[aria-current="step"]')).toHaveAttribute('title', 'Site Visit Scheduled');
    const visits = await prisma.siteVisit.findMany({ where: { tenantId, leadId } });
    expect(visits).toHaveLength(1);
    expect(visits[0]!.projectId).toBe(project.id);
    // 16:30 in Dubai, the workspace's zone, is 12:30 UTC.
    expect(visits[0]!.scheduledAt.toISOString()).toBe(`${day}T12:30:00.000Z`);
    await context.close();
  });
});
