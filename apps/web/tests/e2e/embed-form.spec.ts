import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from '@playwright/test';
import { prisma } from '@/lib/db';
import { uniq } from './helpers';

/**
 * The embeddable snippet (audit row M6-07): a brokerage's own site carries one
 * script tag, which frames the workspace's public form, and a visitor who
 * fills it in becomes a lead. The host page is served from another origin, so
 * the frame is cross-origin to the page around it.
 */
test.describe('the embeddable form snippet', () => {
  const run = uniq();
  const slug = `embed-${run}`;
  const formKey = 'talk-to-us';
  const phone = `05${String(Date.now()).slice(-8)}`;
  let tenantId = '';

  test.beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { slug, legalName: `Embed ${run} LLC`, displayName: `Embed Realty ${run}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
    await prisma.leadStage.create({
      data: { tenantId, key: 'new', name: 'New', category: 'OPEN', isDefault: true, position: 0 },
    });
    await prisma.form.create({
      data: {
        tenantId,
        key: formKey,
        name: 'Talk to us',
        purpose: 'LEAD_CAPTURE',
        targetObject: 'LEAD',
        state: 'PUBLISHED',
        isPublic: true,
        successMessage: 'Thanks, we will call you.',
        fields: {
          create: [
            {
              tenantId,
              key: 'full_name',
              label: 'Your name',
              type: 'TEXT',
              position: 0,
              isRequired: true,
              mapsToField: 'fullName',
            },
            {
              tenantId,
              key: 'phone',
              label: 'Phone (WhatsApp)',
              type: 'PHONE',
              position: 1,
              isRequired: true,
              mapsToField: 'phone',
            },
          ],
        },
      },
    });
  });

  /**
   * The brokerage's own site: a real server on another port. Not Playwright's
   * router: Chrome counts a routed page as public and refuses its request for a
   * script on a loopback address (Local Network Access), so /embed.js never loads.
   */
  let site: Server;
  let host = '';
  test.beforeAll(async () => {
    const app = process.env.APP_URL ?? 'http://localhost:3000';
    site = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(
        `<!doctype html><html><body><h1>Brokerage site</h1><script src="${app}/embed.js" data-workspace="${slug}" data-form="${formKey}"></script></body></html>`,
      );
    });
    await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
    host = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
  });

  test.afterAll(async () => {
    site?.close();
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  });

  test('a third-party page with the script shows the form, and a submission becomes a lead', async ({ page }) => {
    // What the browser said, for a failure that would otherwise read "no iframe".
    const log: string[] = [];
    page.on('console', (message) => log.push(`console ${message.type()}: ${message.text()}`));
    page.on('requestfailed', (request) => log.push(`failed ${request.url()}: ${request.failure()?.errorText}`));
    page.on('response', (response) => {
      if (/embed\.js|\/f\//.test(response.url())) log.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(host);
    await expect(page.getByRole('heading', { name: 'Brokerage site' })).toBeVisible();
    try {
      await expect(page.locator('iframe')).toHaveCount(1);
    } catch (error) {
      throw new Error(`${(error as Error).message}\n${log.join('\n')}`);
    }

    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('heading', { name: 'Talk to us' })).toBeVisible();
    await frame.getByLabel('Your name').fill('Embedded Visitor');
    await frame.getByLabel('Phone').fill(phone);
    await frame.getByRole('button', { name: 'Send' }).click();
    await expect(frame.getByRole('status')).toHaveText('Thanks, we will call you.');

    const lead = await prisma.lead.findFirst({ where: { tenantId, phoneNormalized: `+971${phone.slice(1)}` } });
    expect(lead).toMatchObject({ fullName: 'Embedded Visitor', source: 'PUBLIC_FORM', sourceDetail: formKey });
  });

  test('the public form may be framed by any site; the application may not', async ({ request }) => {
    const form = await request.get(`/f/${slug}/${formKey}?embed=1`);
    expect(form.status()).toBe(200);
    expect(form.headers()['content-security-policy']).toContain('frame-ancestors *');
    expect(form.headers()['x-frame-options']).toBeUndefined();
    const login = await request.get('/login');
    expect(login.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});
