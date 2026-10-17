import { test, expect } from '@playwright/test';
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
 * The phone app's outbox beyond the lead page (audit M20, PROD-14): on a 390 px
 * phone with no connection, a follow-up completed, a new follow-up and a cold
 * call's outcome are kept on the device and counted by the offline notice;
 * back online they are sent once each.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Working offline on a phone', () => {
  const run = uniq();
  const eagle = {
    displayName: `Eagle Offline ${run}`,
    slug: `eagle-offline-${run}`,
    adminName: 'Offline Administrator',
    adminEmail: `admin.offline.${run}@masterapp.local`,
    adminPassword: strongPassword(`of${run}`),
    modules: ['LEAD_EAGLE' as const],
  };
  const at = (path: string) => `/${eagle.slug}${path}`;
  const DUE = `Call back offline ${run}`;
  const NEW = `Booked offline ${run}`;
  const COLD = `Cold offline ${run}`;

  test.beforeAll(resetLoginThrottle);

  test('changes made offline wait on the device and are sent once when the phone is back online', async ({
    page,
    context,
  }) => {
    let tenantId = '';
    await test.step('a Lead-Eagle-only workspace with a lead, its follow-up and a cold record', async () => {
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, eagle);
      await logout(page);
      await login(page, eagle.adminEmail, eagle.adminPassword);
      tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: eagle.slug }, select: { id: true } })).id;
      const stamp = String(Date.now()).slice(-7);
      const lead = await page.request.post('/api/v1/leads', {
        data: { fullName: `Offline Buyer ${run}`, phone: `+97150${stamp}` },
      });
      expect(lead.status(), await lead.text()).toBeLessThan(300);
      const followUp = await page.request.post('/api/v1/follow-ups', {
        data: {
          leadId: (await lead.json()).id,
          title: DUE,
          dueAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        },
      });
      expect(followUp.status(), await followUp.text()).toBeLessThan(300);
      const imported = await page.request.post('/api/v1/cold-data/import', {
        data: {
          fileName: `Expo ${run}.xlsx`,
          rows: [{ line: 2, values: { fullName: COLD, phone: `+97152${stamp}` } }],
        },
      });
      expect(imported.status(), await imported.text()).toBeLessThan(300);
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const notice = page.locator('.lf-outbox');

    await test.step('offline: complete a follow-up and book another', async () => {
      await page.goto(at('/lead-eagle/follow-ups'));
      const row = page.getByRole('row', { name: new RegExp(DUE) });
      await expect(row.getByRole('button', { name: 'Complete' })).toBeEnabled();
      await context.setOffline(true);
      await row.getByRole('button', { name: 'Complete' }).click();
      await expect(notice).toContainText('You are offline.');
      await expect(notice).toContainText('1 change waiting to be sent');

      await page.getByRole('button', { name: 'New follow-up' }).click();
      const composer = page.locator('form', { has: page.locator('#f-title') });
      await composer.locator('#f-title').fill(NEW);
      const due = new Date(Date.now() + 2 * 86_400_000);
      const pad = (n: number) => String(n).padStart(2, '0');
      await composer.locator('#f-due').fill(`${pad(due.getDate())}/${pad(due.getMonth() + 1)}/${due.getFullYear()}`);
      await composer.getByLabel('Time', { exact: true }).fill('11:00');
      await composer.getByRole('button', { name: 'Create follow-up' }).click();
      await expect(composer).toBeHidden();
      await expect(notice).toContainText('2 changes waiting to be sent');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });

    await test.step('back online for a moment to open Cold Data, then offline again: a cold call', async () => {
      // Opening a screen needs the server; the change made on it does not.
      // What waits is sent on reconnecting and on arrival: held back here (the
      // send fails as a dropped connection does, which keeps it) so all three go
      // together below.
      await page.route('**/api/v1/follow-ups**', (route) => route.abort('internetdisconnected'));
      await context.setOffline(false);
      await page.goto(at('/lead-eagle/cold-data'));
      const row = page.getByRole('row', { name: new RegExp(COLD) });
      await expect(row.getByRole('combobox', { name: 'Outcome' })).toBeEnabled();
      await context.setOffline(true);
      await row.getByRole('combobox', { name: 'Outcome' }).selectOption('INTERESTED');
      await expect(row.getByRole('status')).toHaveText('Call kept on this phone; sent when online.');
      await expect(notice).toContainText('3 changes waiting to be sent');
      await page.unroute('**/api/v1/follow-ups**');
    });

    await test.step('online again: each is sent once, and the notice says so', async () => {
      // Sent on reconnecting, and on arriving at any screen. Both may start
      // here; sends run one at a time (lib/offline.ts flush), so the later one
      // finds only what the earlier left, and each change is created once.
      await context.setOffline(false);
      await page.reload();
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('youhan.outbox.v1')), { timeout: 30_000 })
        .toBe('[]');
      await expect
        .poll(() =>
          prisma.followUpTask.findMany({
            where: { tenantId, title: { in: [DUE, NEW] } },
            select: { title: true, status: true },
            orderBy: { title: 'asc' },
          }),
        )
        .toEqual([
          { title: NEW, status: 'OPEN' },
          { title: DUE, status: 'COMPLETED' },
        ]);
      expect(await prisma.activity.count({ where: { tenantId, dataRecord: { fullName: COLD } } })).toBe(1);
    });
  });
});
