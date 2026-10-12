import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { grantPermissions } from '../helpers/fixtures';
import { login, strongPassword, uniq } from './helpers';

/**
 * A Custom webhook lead source, end to end (audit rows M6-08, M6-20, M6-21,
 * M6-22): an administrator connects it and is shown its signing secret once, a
 * signed delivery (sent twice under one Idempotency-Key) becomes one lead
 * through the worker, the Deliveries tab shows it with the lead it made, and a
 * replay runs it again. The tab fits a phone in the dark theme.
 *
 * Needs the BullMQ worker running beside the dev server, as CI's E2E job has.
 */
test.describe('a Custom webhook lead source and its deliveries', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(5 * 60_000);

  const run = uniq();
  const slug = `hook-${run}`.toLowerCase();
  const email = `hook-admin-${run}@masterapp.local`;
  const password = strongPassword(`hk${run}`);
  const number = `05${String(Date.now()).slice(-8)}`;
  const at = (path: string) => `/${slug}${path}`;
  let tenantId = '';

  test.beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { slug, legalName: `Hook ${run} LLC`, displayName: `Hook Realty ${run}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
    await prisma.leadStage.create({
      data: { tenantId, key: 'new', name: 'New', category: 'OPEN', isDefault: true, position: 0 },
    });
    const role = await prisma.role.create({
      data: { tenantId, key: `admin-${run}`, name: 'Administrator', rank: 10, defaultScope: 'ORGANIZATION' },
    });
    await grantPermissions(tenantId, role.id, [
      ['integrations', 'VIEW'],
      ['integrations', 'MANAGE_CONFIGURATION'],
      ['leads', 'VIEW'],
    ]);
    const platformUser = await prisma.platformUser.create({
      data: {
        email,
        normalizedEmail: email,
        fullName: 'Hook Administrator',
        status: 'ACTIVE',
        passwordHash: await hashPassword(password),
        passwordChangedAt: new Date(),
        emailVerifiedAt: new Date(),
      },
    });
    const user = await prisma.user.create({
      data: { tenantId, email, fullName: 'Hook Administrator', roleId: role.id, status: 'ACTIVE' },
    });
    await prisma.workspaceMembership.create({
      data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
    });
  });

  test.afterAll(async () => {
    // A connected source left behind would trip the next run's isolation guard.
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.platformUser.deleteMany({ where: { email } }).catch(() => {});
  });

  test('connect, deliver signed, see it on Deliveries, replay it', async ({ page }, testInfo) => {
    await login(page, email, password);
    await page.goto(at('/admin/integrations'));
    const card = page.locator('.lf-card').filter({ has: page.locator('strong', { hasText: /^Custom webhook$/ }) });

    let secret = '';
    let url = '';
    await test.step('connecting shows a signing secret once, and the URL to post to', async () => {
      await card.getByRole('button', { name: 'Connect' }).click();
      await card.getByRole('button', { name: 'Save and verify' }).click();
      await expect(card.getByText('Signing secret: copy it now, it is not shown again')).toBeVisible();
      secret = (await card.locator('[role="status"] code').innerText()).trim();
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      url = (await card.locator('code', { hasText: '/api/v1/webhooks/leads/' }).innerText()).trim();
      await card.screenshot({ path: testInfo.outputPath('custom-webhook-connected.png') });
    });

    await test.step('a signed delivery, retried under the same Idempotency-Key, makes one lead', async () => {
      const body = JSON.stringify({ name: `Hook Buyer ${run}`, phone: number, message: 'Sea view, two beds' });
      const headers = {
        'content-type': 'application/json',
        'x-signature': `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`,
        'idempotency-key': `delivery-${run}`,
      };
      const path = new URL(url).pathname;
      for (let i = 0; i < 2; i++) {
        const res = await page.request.post(path, { data: body, headers });
        expect(res.status(), await res.text()).toBe(200);
      }
      await expect
        .poll(() => prisma.lead.count({ where: { tenantId, phoneNormalized: `+971${number.slice(1)}` } }), {
          timeout: 90_000,
        })
        .toBe(1);
    });

    await test.step('the Deliveries tab shows it once, with the lead it made', async () => {
      await page.goto(at('/admin/integrations'));
      await card.getByRole('link', { name: 'Deliveries and field mapping' }).click();
      await expect(page.getByRole('heading', { name: 'Custom webhook' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Deliveries' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByText('Lead created')).toHaveCount(1);
      await expect(page.getByRole('link', { name: `Hook Buyer ${run}` })).toBeVisible();
    });

    await test.step('Replay runs it again: the lead it made already holds the number', async () => {
      await page.getByRole('button', { name: 'Replay' }).click();
      await expect
        .poll(
          async () =>
            (await prisma.webhookEvent.findFirst({ where: { tenantId, externalId: `delivery-${run}` } }))?.outcome,
          { timeout: 90_000 },
        )
        .toBe('attached');
      await page.reload();
      await expect(page.getByText('Added to an existing lead')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('deliveries-after-replay.png'), fullPage: true });
      expect(
        await prisma.auditLog.count({
          where: { tenantId, objectType: 'webhook_event', event: 'INTEGRATION_MODIFIED' },
        }),
      ).toBe(1);
    });

    await test.step('the field mapping is saved from its tab', async () => {
      await page.getByRole('tab', { name: 'Field mapping' }).click();
      await page.getByLabel('Sender field').fill('mobile_no');
      await page.getByLabel('Lead field').selectOption({ label: 'Phone' });
      await page.getByRole('button', { name: 'Save mapping' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
      const connection = await prisma.integrationConnection.findFirstOrThrow({
        where: { tenantId, provider: 'custom_webhook' },
      });
      expect((connection.metadata as { fieldMap?: unknown }).fieldMap).toEqual({ mobile_no: 'phone' });
    });
  });

  test('the Deliveries tab fits a phone in the dark theme', async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await login(page, email, password);
    for (const tab of ['', '?tab=mapping']) {
      await page.goto(at(`/admin/lead-sources/custom_webhook${tab}`));
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'dark';
      });
      await expect(page.getByRole('heading', { name: 'Custom webhook' })).toBeVisible();
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.screenshot({ path: testInfo.outputPath(`lead-source${tab ? '-mapping' : ''}-390-dark.png`) });
    }
    await context.close();
  });
});
