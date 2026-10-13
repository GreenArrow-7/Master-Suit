import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { wrapCredentials } from '@/lib/integrations/connection';
import { grantPermissions } from '../helpers/fixtures';
import { BAYUT, NOT_A_PORTAL } from '../helpers/portalEmails';
import { login, strongPassword, uniq } from './helpers';

/**
 * Lead intake from WhatsApp, calls and portal emails, on Integrations (audit
 * rows M6-10, M6-11, M6-12): in a Lead Eagle workspace the WhatsApp Business
 * and telephony cards say new numbers and unknown callers become leads, and the
 * switch is saved from the card; a Portal emails source is connected, a signed
 * Bayut email becomes a lead through the worker, and an email from nobody the
 * parser knows is listed on Deliveries as unread. At 390 px in the dark theme.
 *
 * Needs the BullMQ worker running beside the dev server, as CI's E2E job has.
 */
test.describe('lead intake switches and portal emails', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(5 * 60_000);

  const run = uniq();
  const slug = `intake-${run}`.toLowerCase();
  const email = `intake-admin-${run}@masterapp.local`;
  const password = strongPassword(`in${run}`);
  // Leads are unique by number in a workspace: this run's own.
  const digits = String(Date.now()).slice(-7);
  const at = (path: string) => `/${slug}${path}`;
  const card = (page: import('@playwright/test').Page, label: string) =>
    page.locator('.lf-card').filter({ has: page.locator('strong', { hasText: new RegExp(`^${label}$`) }) });
  let tenantId = '';

  test.beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { slug, legalName: `Intake ${run} LLC`, displayName: `Intake Realty ${run}`, status: 'ACTIVE' },
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
        fullName: 'Intake Administrator',
        status: 'ACTIVE',
        passwordHash: await hashPassword(password),
        passwordChangedAt: new Date(),
        emailVerifiedAt: new Date(),
      },
    });
    const user = await prisma.user.create({
      data: { tenantId, email, fullName: 'Intake Administrator', roleId: role.id, status: 'ACTIVE' },
    });
    await prisma.workspaceMembership.create({
      data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
    });
    // A telephony vendor with no read-only endpoint, so saving the card asks nobody outside.
    await prisma.integrationConnection.create({
      data: {
        tenantId,
        provider: 'knowlarity',
        status: 'CONNECTED',
        credentials: wrapCredentials({ srNumber: '+97144000000', apiKey: 'e2e-key', authToken: 'e2e-token' }),
      },
    });
  });

  test.afterAll(async () => {
    // A connected source left behind would trip the next run's isolation guard.
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.platformUser.deleteMany({ where: { email } }).catch(() => {});
  });

  test('the WhatsApp and telephony cards say what happens to a new number, and the switch saves', async ({
    page,
  }, testInfo) => {
    await login(page, email, password);
    await page.goto(at('/admin/integrations'));

    const whatsapp = card(page, 'WhatsApp Business');
    await expect(whatsapp.getByText('Create leads from new numbers: on')).toBeVisible();
    await whatsapp.getByRole('button', { name: 'Connect' }).click();
    await expect(whatsapp.getByRole('checkbox', { name: 'Create leads from new numbers' })).toBeChecked();

    const knowlarity = card(page, 'Knowlarity');
    await expect(knowlarity.getByText('Create leads from unknown callers: on')).toBeVisible();
    await knowlarity.getByRole('button', { name: 'Configure' }).click();
    const box = knowlarity.getByRole('checkbox', { name: 'Create leads from unknown callers' });
    await expect(box).toBeChecked();
    await box.uncheck();
    await knowlarity.getByRole('button', { name: 'Save and verify' }).click();
    await expect(knowlarity.getByText('Create leads from unknown callers: off')).toBeVisible();
    const saved = await prisma.integrationConnection.findFirstOrThrow({ where: { tenantId, provider: 'knowlarity' } });
    expect((saved.metadata as Record<string, unknown>).createLeadsFromUnknownCallers).toBe(false);
    expect(saved.status).toBe('CONNECTED');
    await knowlarity.screenshot({ path: testInfo.outputPath('knowlarity-switch-off.png') });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await expect(knowlarity.getByRole('checkbox', { name: 'Create leads from unknown callers' })).not.toBeChecked();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await whatsapp.screenshot({ path: testInfo.outputPath('whatsapp-switch-390-dark.png') });
    await knowlarity.screenshot({ path: testInfo.outputPath('knowlarity-switch-390-dark.png') });
  });

  test('a Portal emails source turns a Bayut email into a lead and keeps any other email unread', async ({
    page,
  }, testInfo) => {
    await login(page, email, password);
    await page.goto(at('/admin/integrations'));
    const mail = card(page, 'Portal emails');

    let secret = '';
    let url = '';
    await test.step('connecting shows a signing secret once, and the URL the mail service posts to', async () => {
      await mail.getByRole('button', { name: 'Connect' }).click();
      await mail.getByRole('button', { name: 'Save and verify' }).click();
      await expect(mail.getByText('Signing secret: copy it now, it is not shown again')).toBeVisible();
      secret = (await mail.locator('[role="status"] code').innerText()).trim();
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      url = (await mail.locator('code', { hasText: '/api/v1/webhooks/leads/' }).innerText()).trim();
      await mail.screenshot({ path: testInfo.outputPath('portal-emails-connected.png') });
    });

    await test.step('two signed emails: a Bayut lead email and a newsletter', async () => {
      const bayut = {
        ...BAYUT,
        messageId: `<by-${run}@notifications.bayut.com>`,
        text: BAYUT.text!.replace('055 000 3302', `055 ${digits}`).replace('omar.haddad@', `omar.${run}@`),
      };
      const digest = { ...NOT_A_PORTAL, messageId: `<digest-${run}@realestate-digest.example.com>` };
      const path = new URL(url).pathname;
      for (const body of [bayut, digest].map((m) => JSON.stringify(m))) {
        const res = await page.request.post(path, {
          data: body,
          headers: {
            'content-type': 'application/json',
            'x-signature': `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`,
          },
        });
        expect(res.status(), await res.text()).toBe(200);
      }
      await expect
        .poll(() => prisma.lead.count({ where: { tenantId, phoneNormalized: `+97155${digits}` } }), { timeout: 90_000 })
        .toBe(1);
      await expect
        .poll(
          async () =>
            (
              await prisma.webhookEvent.findFirst({
                where: { tenantId, externalId: `<digest-${run}@realestate-digest.example.com>` },
              })
            )?.outcome,
          { timeout: 90_000 },
        )
        .toBe('unparsed');
    });

    await test.step('Deliveries shows the lead it made and the email it did not read', async () => {
      await mail.getByRole('link', { name: 'Deliveries and field mapping' }).click();
      await expect(page.getByRole('heading', { name: 'Portal emails' })).toBeVisible();
      await expect(page.getByText('Lead created')).toHaveCount(1);
      await expect(page.getByText('Not read: unknown email')).toHaveCount(1);
      await expect(page.getByRole('link', { name: 'Omar Haddad' })).toBeVisible();
      const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, phoneNormalized: `+97155${digits}` } });
      expect(lead).toMatchObject({ source: 'MARKETPLACE', sourceDetail: 'bayut:BY-88213' });
      await page.screenshot({ path: testInfo.outputPath('portal-email-deliveries.png'), fullPage: true });
    });

    await test.step('the card and Deliveries fit a phone in the dark theme', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'dark';
      });
      await expect(page.getByText('Not read: unknown email')).toBeVisible();
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.screenshot({ path: testInfo.outputPath('portal-email-deliveries-390-dark.png'), fullPage: true });
      await page.goto(at('/admin/integrations'));
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'dark';
      });
      await expect(mail).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await mail.screenshot({ path: testInfo.outputPath('portal-emails-card-390-dark.png') });
    });
  });
});
