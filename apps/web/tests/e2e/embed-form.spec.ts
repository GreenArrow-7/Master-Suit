import { test, expect } from '@playwright/test';
import { prisma } from '@/lib/db';
import { uniq } from './helpers';

/**
 * The embeddable snippet (audit row M6-07): a brokerage's own site carries one
 * script tag, which frames the workspace's public form, and a visitor who
 * fills it in becomes a lead. The host page is served from another origin by
 * Playwright's router, so the frame is genuinely cross-site.
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

  test.afterAll(async () => {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  });

  test('a third-party page with the script shows the form, and a submission becomes a lead', async ({
    page,
    baseURL,
  }) => {
    // Plain http, so the page may load the dev server's script without a mixed-content block.
    await page.route(
      (url) => url.hostname === 'brokerage.example',
      (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><body><h1>Brokerage site</h1><script src="${baseURL}/embed.js" data-workspace="${slug}" data-form="${formKey}"></script></body></html>`,
        }),
    );
    await page.goto('http://brokerage.example/');
    await expect(page.getByRole('heading', { name: 'Brokerage site' })).toBeVisible();

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
