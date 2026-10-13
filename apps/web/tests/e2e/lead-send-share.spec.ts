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
 * Sending to a lead and sharing a property with it (Lead Eagle audit rows
 * M4-28, M4-30, M4-38), in a Lead-Eagle-only workspace: the administrator
 * keeps an email template, an agent's Send email on the lead's Overview puts
 * it on the timeline, a shared listing opens as a public page in a browser
 * with no session and the opening shows on the lead's timeline; at 390 px the
 * lead page and the grid's Send template work without scrolling sideways.
 * Email only: the suite runs with no WhatsApp connected (tests/helpers/isolation.ts),
 * and the WhatsApp send is covered by tests/sales/lead-send.spec.ts.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Sending to a lead and sharing a listing', () => {
  const run = uniq();
  const eagle = {
    displayName: `Eagle Send ${run}`,
    slug: `eagle-send-${run}`,
    adminName: 'Send Administrator',
    adminEmail: `admin.send.${run}@masterapp.local`,
    adminPassword: strongPassword(`ss${run}`),
    modules: ['LEAD_EAGLE' as const],
  };
  const at = (path: string) => `/${eagle.slug}${path}`;
  const SARA = `Sara Send ${run}`;
  const OMAR = `Omar Send ${run}`;
  const NOMAIL = `Nomail Send ${run}`;
  const LISTING = `Marina two-bed ${run}`;

  let tenantId = '';
  const leadId = async (fullName: string) =>
    (await prisma.lead.findFirstOrThrow({ where: { tenantId, fullName }, select: { id: true } })).id;

  test.beforeAll(resetLoginThrottle);

  test('an email template from the lead, a shared listing opened, and Send template at 390 px', async ({
    page,
    browser,
  }) => {
    await test.step('a Lead-Eagle-only workspace with three leads and a listing on the market', async () => {
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, eagle);
      await logout(page);
      await login(page, eagle.adminEmail, eagle.adminPassword);
      tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: eagle.slug }, select: { id: true } })).id;
      const stamp = String(Date.now()).slice(-6);
      for (const [index, [fullName, email]] of [
        [SARA, `sara.${run}@client.test`],
        [OMAR, `omar.${run}@client.test`],
        [NOMAIL, null],
      ].entries()) {
        const res = await page.request.post('/api/v1/leads', {
          data: { fullName, phone: `+9715${index}${stamp}1`, ...(email && { email }) },
        });
        expect(res.status(), await res.text()).toBeLessThan(300);
      }
      await prisma.listing.create({
        data: {
          tenantId,
          reference: `SH-${run}`,
          title: LISTING,
          listingType: 'SALE',
          status: 'ACTIVE',
          bedrooms: 2,
          price: 2400000,
          currency: 'AED',
        },
      });
    });

    await test.step('the administrator keeps an email template under Settings', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(at('/admin/email-templates'));
      const form = page.getByRole('form', { name: 'New email template' });
      await form.getByLabel('Name').fill('Brochure');
      await form.getByLabel('Subject').fill('Your brochure, {{1}}');
      await form.getByLabel('Body').fill('Dear {{1}}, the brochure is attached. {{2}}');
      await form.getByRole('button', { name: 'Add template' }).click();
      await expect(page.getByRole('form', { name: 'Template Brochure' })).toBeVisible();
    });

    await test.step('Send email on the lead’s Overview, then the email on its timeline', async () => {
      await page.goto(at(`/lead-eagle/leads/${await leadId(SARA)}`));
      const card = page.getByRole('region', { name: 'Message the lead' });
      await card.getByRole('button', { name: 'Send email' }).click();
      const dialog = page.getByRole('dialog', { name: `Send Email · ${SARA}` });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Template').selectOption({ label: 'Brochure' });
      await dialog.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(card.getByText('Sent. It is on the timeline.')).toBeVisible();

      const sent = await prisma.communication.findFirstOrThrow({
        where: { tenantId, leadId: await leadId(SARA) },
        select: { channel: true, status: true, subject: true },
      });
      expect(sent).toEqual({ channel: 'EMAIL', status: 'SENT', subject: 'Your brochure, Sara' });

      await page.getByRole('tab', { name: /Timeline/ }).click();
      await expect(page.getByText('Email sent').first()).toBeVisible();
      await expect(page.getByText(/Your brochure, Sara/).first()).toBeVisible();
    });

    let shared = '';
    await test.step('share the listing: its page opens with no session, and the opening is on the timeline', async () => {
      await page.getByRole('tab', { name: 'Overview' }).click();
      const card = page.getByRole('region', { name: 'Share a property' });
      await card.getByLabel('Project or listing to share').selectOption({ label: `SH-${run} · ${LISTING}` });
      await card.getByRole('button', { name: 'Create link' }).click();
      const row = card.getByRole('listitem', { name: `Shared ${LISTING}` });
      await expect(row).toBeVisible();
      await expect(row.getByText('not opened yet')).toBeVisible();
      // WhatsApp opens with the link written, to the lead's own number.
      await expect(row.getByRole('link', { name: 'Share via WhatsApp' })).toHaveAttribute(
        'href',
        /^https:\/\/wa\.me\/9715\d+\?text=Hi%20Sara%2C/,
      );
      shared = new URL((await row.getByRole('link', { name: 'Open' }).getAttribute('href'))!).pathname;
      expect(shared).toMatch(/^\/s\/[^/]+$/);

      // A browser with no session: the client's phone.
      const client = await browser.newContext();
      const visitor = await client.newPage();
      await visitor.goto(shared);
      await expect(visitor.getByRole('heading', { name: LISTING })).toBeVisible();
      await expect(visitor.getByText('AED 2,400,000')).toBeVisible();
      await expect(visitor.getByText(SARA)).toHaveCount(0);
      await client.close();

      await page.reload();
      await expect(row.getByText('opened 1 time')).toBeVisible();
      await page.getByRole('tab', { name: /Timeline/ }).click();
      await expect(page.getByText('Shared link opened').first()).toBeVisible();
      await expect(page.getByText(`Listing: ${LISTING}`).first()).toBeVisible();
    });

    await test.step('revoked, the link is a 404', async () => {
      await page.getByRole('tab', { name: 'Overview' }).click();
      const row = page.getByRole('listitem', { name: `Shared ${LISTING}` });
      await row.getByRole('button', { name: 'Revoke' }).click();
      await expect(row.getByText('no longer works')).toBeVisible();
      const client = await browser.newContext();
      const visitor = await client.newPage();
      await visitor.goto(shared);
      await expect(visitor.getByRole('heading', { name: LISTING })).toHaveCount(0);
      await expect(visitor.getByRole('heading', { name: /couldn.t find that/ })).toBeVisible();
      await client.close();
    });

    await test.step('390 px: the lead page and the grid’s Send template, with no sideways scroll', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(at(`/lead-eagle/leads/${await leadId(OMAR)}`));
      await expect(page.getByRole('region', { name: 'Message the lead' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Share a property' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

      await page.goto(at('/lead-eagle/leads'));
      for (const name of [OMAR, NOMAIL]) {
        await page.getByRole('checkbox', { name: `Select ${name}` }).check();
      }
      await page.getByRole('button', { name: 'Send template' }).click();
      const dialog = page.getByRole('dialog', { name: 'Send template · 2 leads' });
      await dialog.getByLabel('Channel').selectOption('EMAIL');
      await dialog.getByLabel('Template').selectOption({ label: 'Brochure' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await dialog.getByRole('button', { name: 'Queue' }).click();
      await expect(dialog.getByText('1 queued, sent one a second. 1 with no email address.')).toBeVisible();
      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect(dialog).toBeHidden();
    });
  });
});
