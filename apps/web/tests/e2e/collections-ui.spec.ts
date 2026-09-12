/**
 * The finance workflow, through the screens, on the release artifact.
 *
 * Two people, two browsers: the recorder records a receipt on the
 * Collections page and cannot verify it; the verifier verifies it and the
 * coverage on the page moves; the recorder reverses part of it and the
 * verifier verifies that too. Then the same recording journey at 390px on a
 * phone profile, because a form that renders is not a form that can be used.
 */
import { randomBytes } from 'node:crypto';
import { test, expect, devices, type Browser, type Page } from '@playwright/test';
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
  displayName: `Collections UI ${run}`,
  slug: `cui-${run}`.toLowerCase(),
  adminName: `Collections UI Admin ${run}`,
  adminEmail: `cui-admin-${run}@masterapp.local`,
  adminPassword: strongPassword(`cui${run}`),
  modules: ['SALES'] as ('SALES' | 'HRMS')[],
};
const password = strongPassword(`q${run}`);
const at = (path: string) => `/${workspace.slug}${path}`;

let tenantId = '';
let bookingId = '';
let bookingRef = '';
let recorder = { email: '', id: '' };
let verifier = { email: '', id: '' };

async function person(label: string, grants: readonly (readonly [string, string])[]) {
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

const FINANCE = [
  ['collections', 'VIEW'],
  ['collections', 'CREATE'],
  ['collections', 'APPROVE'],
  ['bookings', 'VIEW'],
  ['agencyfee', 'VIEW'],
] as const;

async function signedIn(
  browser: Browser,
  who: { email: string },
  mobile = false,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext(mobile ? { ...devices['Pixel 7'] } : {});
  const page = await context.newPage();
  await resetLoginThrottle();
  await login(page, who.email, password);
  return { page, close: () => context.close() };
}

async function recordThroughTheForm(page: Page, amount: string, reference: string) {
  await page.goto(at(`/sales/collections/${bookingId}`));
  await expect(page.getByTestId('coverage')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Record a receipt' }).click();
  await page.getByLabel('Amount received').fill(amount);
  await page.getByLabel('Payment date').fill('2026-09-10');
  await page.getByLabel('Payment reference').fill(reference);
  await page.getByLabel('Bank or provider transaction id').fill(`txn_${randomBytes(6).toString('hex')}`);
  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/v1/collections/receipts') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save receipt' }).click();
  const res = await saved;
  expect(res.status(), await res.text()).toBe(200);
  await expect(page.getByText(reference)).toBeVisible({ timeout: 30_000 });
}

test.describe('Collections through the screens', () => {
  test.describe.configure({ mode: 'serial' });

  test('a workspace, a confirmed sale with an agreed fee, and two finance people', async ({ page }) => {
    await resetLoginThrottle();
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: workspace.slug }, select: { id: true } })).id;
    recorder = await person('recorder', FINANCE);
    verifier = await person('verifier', FINANCE);

    await resetLoginThrottle();
    await login(page, workspace.adminEmail, workspace.adminPassword);
    const project = await page.request.post('/api/v1/projects', {
      data: { name: `Tower ${run}`, code: `T-${run}`.slice(0, 40) },
    });
    const projectId = (await project.json()).id as string;
    await page.request.post(`/api/v1/projects/${projectId}/units`, {
      data: { fromFloor: 1, toFloor: 1, unitsPerFloor: 1, price: 1_000_000 },
    });
    const unitId = (
      (await (await page.request.get(`/api/v1/projects/${projectId}/units?limit=5`)).json()).data as { id: string }[]
    )[0].id;
    const lead = await page.request.post('/api/v1/leads', {
      data: { fullName: `Buyer ${run}`, phone: `+9715${Date.now().toString().slice(-8)}` },
    });
    const booking = await page.request.post('/api/v1/bookings', {
      data: {
        leadId: (await lead.json()).id,
        projectId,
        unitInventoryId: unitId,
        saleValue: 1_000_000,
        agencyFee: 30_000,
        bookingDate: new Date().toISOString(),
      },
    });
    expect(booking.status(), await booking.text()).toBeLessThan(300);
    const created = await booking.json();
    bookingId = created.id;
    bookingRef = created.reference;
    const confirmed = await page.request.patch('/api/v1/bookings', { data: { action: 'CONFIRM', bookingId } });
    expect(confirmed.status(), await confirmed.text()).toBeLessThan(300);
  });

  test('the list shows the sale as blocked with the fee due and nothing verified', async ({ browser }) => {
    const r = await signedIn(browser, recorder);
    try {
      await r.page.goto(at('/sales/collections'));
      const row = r.page.getByRole('row', { name: new RegExp(bookingRef) });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row).toContainText('30,000.00');
      await expect(row).toContainText('Outstanding');
    } finally {
      await r.close();
    }
  });

  test('desktop: recorder records, cannot verify; verifier verifies; eligibility flips', async ({ browser }) => {
    const r = await signedIn(browser, recorder);
    const v = await signedIn(browser, verifier);
    try {
      await recordThroughTheForm(r.page, '30000.00', `REF-D-${run}`);
      await expect(r.page.getByTestId('kpi-pending')).toContainText('30,000.00');
      await expect(r.page.getByTestId('kpi-eligibility')).toContainText('Blocked');
      // The recorder's own row offers no Verify button — only the wait.
      const ownRow = r.page.getByRole('row', { name: new RegExp(`REF-D-${run}`) });
      await expect(ownRow).toContainText('Awaiting someone else');
      await expect(ownRow.getByRole('button', { name: 'Verify' })).toHaveCount(0);

      await v.page.goto(at(`/sales/collections/${bookingId}`));
      const row = v.page.getByRole('row', { name: new RegExp(`REF-D-${run}`) });
      const decided = v.page.waitForResponse(
        (res) => res.url().includes('/receipts/decide') && res.request().method() === 'PATCH',
      );
      await row.getByRole('button', { name: 'Verify' }).click();
      expect((await decided).status()).toBe(200);
      await expect(v.page.getByTestId('kpi-verified')).toContainText('30,000.00', { timeout: 30_000 });
      await expect(v.page.getByTestId('kpi-outstanding')).toContainText('0.00');
      await expect(v.page.getByTestId('kpi-eligibility')).toContainText('Eligible');
      await expect(v.page.getByTestId('history')).toContainText('collections');
    } finally {
      await r.close();
      await v.close();
    }
  });

  test('a reversal with a reason, verified by the other person, takes eligibility away again', async ({ browser }) => {
    const r = await signedIn(browser, recorder);
    const v = await signedIn(browser, verifier);
    try {
      await r.page.goto(at(`/sales/collections/${bookingId}`));
      const row = r.page.getByRole('row', { name: new RegExp(`REF-D-${run}`) });
      await row.getByRole('button', { name: 'Reverse' }).click();
      await r.page.getByLabel('Reversal amount').fill('5000.00');
      await r.page.getByLabel('Reversal reason').fill('Bounced cheque');
      const reversed = r.page.waitForResponse(
        (res) => res.url().includes('/receipts/reverse') && res.request().method() === 'POST',
      );
      await r.page.getByRole('button', { name: 'Record reversal' }).click();
      expect((await reversed).status()).toBe(200);
      await expect(r.page.getByText('Reversal · Bounced cheque')).toBeVisible({ timeout: 30_000 });
      await expect(r.page.getByTestId('kpi-eligibility')).toContainText('Eligible'); // pending reversal changes nothing yet

      await v.page.goto(at(`/sales/collections/${bookingId}`));
      const reversalRow = v.page.getByRole('row', { name: /Bounced cheque/ });
      const decided = v.page.waitForResponse(
        (res) => res.url().includes('/receipts/decide') && res.request().method() === 'PATCH',
      );
      await reversalRow.getByRole('button', { name: 'Verify' }).click();
      expect((await decided).status()).toBe(200);
      await expect(v.page.getByTestId('kpi-verified')).toContainText('25,000.00', { timeout: 30_000 });
      await expect(v.page.getByTestId('kpi-eligibility')).toContainText('Blocked');
    } finally {
      await r.close();
      await v.close();
    }
  });

  test('mobile at 390px: the recorder records through the same form, nothing scrolls sideways', async ({ browser }) => {
    const r = await signedIn(browser, recorder, true);
    try {
      await recordThroughTheForm(r.page, '5000.00', `REF-M-${run}`);
      const overflow = await r.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'no horizontal page scrolling at 390px').toBeLessThanOrEqual(0);
      await r.page.goto(at('/sales/collections'));
      await expect(r.page.getByRole('row', { name: new RegExp(bookingRef) })).toBeVisible({ timeout: 30_000 });
      const overflowList = await r.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflowList).toBeLessThanOrEqual(0);
    } finally {
      await r.close();
    }
  });

  test('mobile: the verifier verifies the phone-recorded receipt', async ({ browser }) => {
    const v = await signedIn(browser, verifier, true);
    try {
      await v.page.goto(at(`/sales/collections/${bookingId}`));
      const row = v.page.getByRole('row', { name: new RegExp(`REF-M-${run}`) });
      await expect(row).toBeVisible({ timeout: 30_000 });
      const decided = v.page.waitForResponse(
        (res) => res.url().includes('/receipts/decide') && res.request().method() === 'PATCH',
      );
      await row.getByRole('button', { name: 'Verify' }).click();
      expect((await decided).status()).toBe(200);
      await expect(v.page.getByTestId('kpi-verified')).toContainText('30,000.00', { timeout: 30_000 });
      await expect(v.page.getByTestId('kpi-eligibility')).toContainText('Eligible');
    } finally {
      await v.close();
    }
  });
});
