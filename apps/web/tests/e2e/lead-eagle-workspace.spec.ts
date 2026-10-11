import { test, expect } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
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

    await test.step('a requirement with live stock offers no shortlist: proposals are not part of it', async () => {
      const tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: eagle.slug }, select: { id: true } }))
        .id;
      const listing = await prisma.listing.create({
        data: {
          tenantId,
          reference: `LS-${run}`,
          title: 'Marina two bed',
          listingType: 'SALE',
          status: 'ACTIVE',
          price: new Prisma.Decimal(1_800_000),
        },
        select: { id: true },
      });
      const res = await page.request.post('/api/v1/requirements', { data: { leadId, purpose: 'BUY' } });
      expect(res.status(), await res.text()).toBeLessThan(300);
      const requirementId = (await res.json()).id as string;

      await page.goto(at(`/lead-eagle/requirements/${requirementId}`));
      // The match renders, so the role and matches gates are open; only the entitlement withholds the button.
      await expect(page.getByRole('link', { name: 'Marina two bed' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Send a shortlist' })).toHaveCount(0);
      await expect(page.getByTestId('shortlist-unavailable')).toContainText('not enabled');

      // The API is the authority; the note only mirrors it.
      const refused = await page.request.post('/api/v1/proposals', {
        data: { requirementId, leadId, title: 'A few places', listingIds: [listing.id] },
      });
      expect(refused.status()).toBe(403);
    });

    await test.step('a /sales/ link lands on the same screen under Lead Eagle', async () => {
      await page.goto(at(`/sales/leads/${leadId}`));
      await expect(page).toHaveURL(new RegExp(`/${eagle.slug}/lead-eagle/leads/${leadId}`));
    });

    await test.step('the money and marketing registers are not part of it, and the screen says so (M2-05)', async () => {
      // Each screen stays where it was asked for and names the products that
      // carry it; it used to go to the dashboard without a word.
      for (const [path, says] of [
        ['/realty/collections', 'Collections is part of Real Estate.'],
        ['/sales/events', 'Events is part of Sales or Real Estate.'],
        ['/realty/events', 'Events is part of Real Estate.'],
      ]) {
        await page.goto(at(path!));
        await expect(page.getByRole('heading', { name: says })).toBeVisible();
        await expect(page.getByText('This workspace’s plan does not include it.')).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/${eagle.slug}${path}$`));
      }
      await expect(page.getByRole('link', { name: 'Back to the dashboard' })).toHaveAttribute(
        'href',
        `/${eagle.slug}/dashboard`,
      );
      expect((await page.request.get('/api/v1/collections/receipts')).status()).toBe(403);
      expect((await page.request.get('/api/v1/opportunities')).status()).toBe(403);
      const events = await page.request.get('/api/v1/events');
      expect(events.status()).toBe(403);
      expect((await events.json()).detail).toBe('Sales or Real Estate is not enabled for this company.');
    });

    await test.step('Admin > Roles lists Lead Eagle’s starter roles beside the administrator, each with its scope (M2-03)', async () => {
      await page.goto(at('/admin/roles'));
      await expect(page.locator('.lf-roles__row strong')).toHaveText([
        'Agent',
        'Company Administrator',
        'Manager',
        'Team Lead',
        'Telecaller',
        'Viewer',
      ]);
      await expect(page.locator('.lf-roles__scope')).toHaveText([
        '· Own',
        '· Organization',
        '· Organization',
        '· Team',
        '· Own',
        '· Organization',
      ]);
    });

    await test.step('an Agent cannot open a colleague’s site visit, on the page or the API', async () => {
      const tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: eagle.slug }, select: { id: true } }))
        .id;
      const admin = await prisma.user.findFirstOrThrow({ where: { tenantId, role: { key: 'company_admin' } } });
      const visit = await prisma.siteVisit.create({
        data: {
          tenantId,
          ownerId: admin.id,
          leadId,
          kind: 'CLIENT_MEETING',
          address: 'Marina café',
          scheduledAt: new Date(Date.now() + 3_600_000),
        },
        select: { id: true },
      });
      const role = await prisma.role.findFirstOrThrow({ where: { tenantId, key: 'agent' } });
      const email = `agent.eagle.${run}@masterapp.local`;
      const platformUser = await prisma.platformUser.create({
        data: {
          email,
          normalizedEmail: email,
          fullName: 'Eagle Agent',
          status: 'ACTIVE',
          passwordHash: await hashPassword(eagle.adminPassword),
          passwordChangedAt: new Date(),
          emailVerifiedAt: new Date(),
        },
      });
      const user = await prisma.user.create({
        data: { tenantId, email, fullName: 'Eagle Agent', roleId: role.id, status: 'ACTIVE' },
      });
      await prisma.workspaceMembership.create({
        data: {
          tenantId,
          platformUserId: platformUser.id,
          salesUserId: user.id,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });

      await logout(page);
      await login(page, email, eagle.adminPassword);
      await page.goto(at(`/lead-eagle/site-visits/${visit.id}`));
      await expect(page.getByText(/couldn.t find that/)).toBeVisible();
      await expect(page.getByText('Marina café')).toHaveCount(0);
      expect((await page.request.get(`/api/v1/site-visits/${visit.id}`)).status()).toBe(404);
    });
  });
});
