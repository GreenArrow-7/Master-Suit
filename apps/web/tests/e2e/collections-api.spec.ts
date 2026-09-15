/**
 * Agency-fee receipts against the release artifact, through its HTTP API.
 *
 * There is no collections screen — this is API-only — so this is not a
 * browser journey and does not pretend to be one. What it says that the
 * service tests cannot: the *built* application, `NODE_ENV=production`,
 * behind TLS, with four real signed-in people, refuses the selling agent,
 * refuses the recorder as verifier, accepts a second person, and moves
 * coverage the way the rules say. Runs against whatever `APP_URL` points at.
 */
import { randomBytes } from 'node:crypto';
import { test, expect, type APIRequestContext, type Browser } from '@playwright/test';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import {
  createWorkspaceViaWizard,
  login,
  loginPlatformOwner,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

const run = uniq();
const workspace = {
  displayName: `Collections API ${run}`,
  slug: `col-${run}`.toLowerCase(),
  adminName: `Collections Admin ${run}`,
  adminEmail: `col-admin-${run}@masterapp.local`,
  adminPassword: strongPassword(`col${run}`),
  modules: ['SALES'] as ('SALES' | 'HRMS')[],
};
const password = strongPassword(`p${run}`);

let tenantId = '';
let projectId = '';
let unitId = '';
let leadId = '';
let bookingId = '';
let receiptId = '';

type Person = { email: string; id: string };
let seller: Person;
let financeA: Person;
let financeB: Person;

/** A signed-in person's API context, from a fresh browser context so cookies never mix. */
async function as(browser: Browser, who: Person): Promise<{ request: APIRequestContext; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await resetLoginThrottle();
  await login(page, who.email, password);
  return { request: page.request, close: () => context.close() };
}

/**
 * A workspace user who can sign in, written directly — the invitation journey
 * is proven elsewhere and would cost four emails here. Everything the login
 * path checks is set: an active platform identity with a password that has
 * already been changed, an active workspace user on the role, and the
 * membership that joins them.
 */
async function person(label: string, grants: readonly (readonly [string, string])[]): Promise<Person> {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${run}`, name: label, rank: 40, defaultScope: 'ORGANIZATION' },
  });
  for (const [module, action] of grants) {
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { module_action: { module, action: action as never } },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
    });
  }
  const email = `${label}-${run}@masterapp.local`;
  const platformUser = await prisma.platformUser.create({
    data: {
      email,
      normalizedEmail: email,
      fullName: label,
      status: 'ACTIVE',
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      emailVerifiedAt: new Date(),
    },
  });
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: label, roleId: role.id, status: 'ACTIVE' },
  });
  await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  return { email, id: user.id };
}

const receipt = (amount: string) => ({
  bookingId,
  amount,
  currency: 'AED',
  paidAt: new Date('2026-09-10T09:00:00Z').toISOString(),
  paymentReference: `BANK-${randomBytes(3).toString('hex')}`,
  providerTransactionRef: `txn_${randomBytes(6).toString('hex')}`,
});

test.describe('Agency-fee receipts on the release artifact (API-only — there is no screen)', () => {
  test.describe.configure({ mode: 'serial' });

  test('a workspace, a confirmed sale with an agreed fee, and four people exist', async ({ page }) => {
    await resetLoginThrottle();
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: workspace.slug }, select: { id: true } });
    tenantId = tenant.id;

    seller = await person('seller', [
      ['bookings', 'VIEW'],
      ['bookings', 'CREATE'],
      ['bookings', 'EDIT'],
      ['leads', 'VIEW'],
    ]);
    financeA = await person('finance-a', [
      ['collections', 'VIEW'],
      ['collections', 'CREATE'],
      ['collections', 'APPROVE'],
      ['bookings', 'VIEW'],
    ]);
    financeB = await person('finance-b', [
      ['collections', 'VIEW'],
      ['collections', 'CREATE'],
      ['collections', 'APPROVE'],
      ['bookings', 'VIEW'],
    ]);

    // The sale itself goes through the administrator and the real routes.
    await resetLoginThrottle();
    await login(page, workspace.adminEmail, workspace.adminPassword);
    const project = await page.request.post('/api/v1/projects', {
      data: { name: `Tower ${run}`, code: `T-${run}`.slice(0, 40) },
    });
    expect(project.status(), await project.text()).toBeLessThan(300);
    projectId = (await project.json()).id;
    const units = await page.request.post(`/api/v1/projects/${projectId}/units`, {
      data: { fromFloor: 1, toFloor: 1, unitsPerFloor: 1, price: 1_000_000 },
    });
    expect(units.status(), await units.text()).toBeLessThan(300);
    const listed = await page.request.get(`/api/v1/projects/${projectId}/units?limit=5`);
    unitId = ((await listed.json()).data as { id: string }[])[0].id;
    const lead = await page.request.post('/api/v1/leads', {
      data: { fullName: `Buyer ${run}`, phone: `+9715${Date.now().toString().slice(-8)}` },
    });
    expect(lead.status(), await lead.text()).toBeLessThan(300);
    leadId = (await lead.json()).id;
    const booking = await page.request.post('/api/v1/bookings', {
      data: {
        leadId,
        projectId,
        unitInventoryId: unitId,
        saleValue: 1_000_000,
        agencyFee: 30_000,
        bookingDate: new Date().toISOString(),
      },
    });
    expect(booking.status(), await booking.text()).toBeLessThan(300);
    bookingId = (await booking.json()).id;
    const confirmed = await page.request.patch('/api/v1/bookings', { data: { action: 'CONFIRM', bookingId } });
    expect(confirmed.status(), await confirmed.text()).toBeLessThan(300);
  });

  test('the selling agent cannot record a receipt', async ({ browser }) => {
    const s = await as(browser, seller);
    try {
      const res = await s.request.post('/api/v1/collections/receipts', { data: receipt('30000.00') });
      expect(res.status(), await res.text()).toBe(403);
    } finally {
      await s.close();
    }
  });

  test('finance A records; A cannot verify it; B can; coverage becomes complete', async ({ browser }) => {
    const a = await as(browser, financeA);
    const b = await as(browser, financeB);
    try {
      const rec = await a.request.post('/api/v1/collections/receipts', { data: receipt('30000.00') });
      expect(rec.status(), await rec.text()).toBe(200);
      receiptId = (await rec.json()).receipt.id;

      const self = await a.request.patch('/api/v1/collections/receipts/decide', {
        data: { receiptId, to: 'VERIFIED' },
      });
      expect(self.status(), await self.text()).toBe(403);

      const other = await b.request.patch('/api/v1/collections/receipts/decide', {
        data: { receiptId, to: 'VERIFIED' },
      });
      expect(other.status(), await other.text()).toBe(200);
      expect((await other.json()).receipt.status).toBe('VERIFIED');

      const cov = await b.request.get(`/api/v1/collections/receipts?bookingId=${bookingId}`);
      expect(cov.status()).toBe(200);
      const body = await cov.json();
      expect(body.coverage.covered).toBe(true);
      expect(body.coverage.verified).toBe('30000');
      expect(body.coverage.due).toBe('30000');
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('a reversal, verified by the other person, takes coverage back below the fee', async ({ browser }) => {
    const a = await as(browser, financeA);
    const b = await as(browser, financeB);
    try {
      const rev = await a.request.post('/api/v1/collections/receipts/reverse', {
        data: { receiptId, amount: '5000.00', reason: 'Bounced cheque' },
      });
      expect(rev.status(), await rev.text()).toBe(200);
      const reversalId = (await rev.json()).receipt.id;

      const still = await a.request.get(`/api/v1/collections/receipts?bookingId=${bookingId}`);
      expect((await still.json()).coverage.covered).toBe(true); // pending reversal counts for nothing yet

      const verified = await b.request.patch('/api/v1/collections/receipts/decide', {
        data: { receiptId: reversalId, to: 'VERIFIED' },
      });
      expect(verified.status(), await verified.text()).toBe(200);

      const after = await b.request.get(`/api/v1/collections/receipts?bookingId=${bookingId}`);
      const body = await after.json();
      expect(body.coverage.covered).toBe(false);
      expect(body.coverage.verified).toBe('25000');
      // The original row is untouched.
      const original = (body.receipts as { id: string; status: string; amount: string }[]).find(
        (r) => r.id === receiptId,
      )!;
      expect(original.status).toBe('VERIFIED');
      expect(original.amount).toBe('30000');
    } finally {
      await a.close();
      await b.close();
    }
  });
});
