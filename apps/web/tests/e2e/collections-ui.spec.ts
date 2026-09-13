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
let projectId = '';
let leadId = '';
let director = { email: '', id: '' };
let seller = { email: '', id: '' };
let evidenceHref = '';
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
  ['agencyfee', 'APPROVE'],
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
    seller = await person('seller', [
      ['bookings', 'VIEW'],
      ['bookings', 'CREATE'],
      ['bookings', 'EDIT'],
    ]);
    director = await person('director', [
      ['collections', 'VIEW'],
      ['bookings', 'VIEW'],
      ['agencyfee', 'VIEW'],
      ['agencyfee', 'CREATE'],
    ]);

    await resetLoginThrottle();
    await login(page, workspace.adminEmail, workspace.adminPassword);
    const project = await page.request.post('/api/v1/projects', {
      data: { name: `Tower ${run}`, code: `T-${run}`.slice(0, 40) },
    });
    projectId = (await project.json()).id as string;
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
        leadId: (leadId = (await lead.json()).id),
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
  test('fee amendment: the director previews and proposes; cannot approve; finance approves and the fee due moves', async ({
    browser,
  }) => {
    const d = await signedIn(browser, director);
    const v = await signedIn(browser, verifier);
    try {
      await d.page.goto(at(`/sales/collections/${bookingId}`));
      await d.page.getByRole('button', { name: 'Propose an amendment' }).click();
      await d.page.getByLabel('Proposed fee').fill('40000.00');
      await d.page.getByLabel('Amendment reason').fill(`Addendum ${run}`);
      await d.page.getByLabel('Agreement reference').fill(`ADD-${run}`);
      await d.page.getByRole('button', { name: 'Preview effect' }).click();
      // 30,000 verified against a 40,000 fee: approving would block eligibility, and the preview says so first.
      await expect(d.page.getByTestId('fee-preview')).toContainText('eligible → blocked', { timeout: 30_000 });
      const proposed = d.page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/collections/fee-amendments') && r.request().method() === 'POST',
      );
      await d.page.getByRole('button', { name: 'Propose for finance approval' }).click();
      expect((await proposed).status()).toBe(200);
      const ownRow = d.page.getByTestId('amendments-table').getByRole('row', { name: new RegExp(`Addendum ${run}`) });
      await expect(ownRow).toContainText('Awaiting finance', { timeout: 30_000 });
      await expect(ownRow.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
      await expect(d.page.getByTestId('kpi-due')).toContainText('30,000.00'); // not applied yet

      await v.page.goto(at(`/sales/collections/${bookingId}`));
      const row = v.page.getByTestId('amendments-table').getByRole('row', { name: new RegExp(`Addendum ${run}`) });
      const decided = v.page.waitForResponse((r) => r.url().includes('/fee-amendments/decide'));
      await row.getByRole('button', { name: 'Approve', exact: true }).click();
      expect((await decided).status()).toBe(200);
      await expect(v.page.getByTestId('kpi-due')).toContainText('40,000.00', { timeout: 30_000 });
      await expect(v.page.getByTestId('kpi-eligibility')).toContainText('Blocked');

      const amendment = await prisma.agencyFeeAmendment.findFirstOrThrow({
        where: { tenantId, bookingId, reason: `Addendum ${run}` },
      });
      expect(amendment.status).toBe('APPROVED');
      expect(amendment.previousFee?.toString()).toBe('30000');
      expect(amendment.proposedById).toBe(director.id);
      expect(amendment.decidedById).toBe(verifier.id);
    } finally {
      await d.close();
      await v.close();
    }
  });

  /** A paid commission whose money later moved: the state a verified reversal after payment leaves. */
  async function openCase() {
    const tag = randomBytes(4).toString('hex');
    const booking = await prisma.booking.create({
      data: {
        tenantId,
        reference: `BK-RC-${tag}`,
        leadId,
        projectId,
        ownerId: recorder.id,
        status: 'DRAFT',
        saleValue: 1_000_000,
        agencyFee: 30_000,
        currency: 'AED',
        bookingDate: new Date(),
      },
    });
    const receipt = await prisma.agencyFeeReceipt.create({
      data: {
        tenantId,
        bookingId: booking.id,
        reference: `RCT-RC-${tag}`,
        kind: 'RECEIPT',
        status: 'VERIFIED',
        amount: 30_000,
        currency: 'AED',
        paidAt: new Date(),
        paymentReference: `rc-${tag}`,
        providerTransactionRef: `txn_${tag}`,
        recordedById: recorder.id,
        verifiedById: verifier.id,
        verifiedAt: new Date(),
      },
    });
    const commission = await prisma.commission.create({
      data: {
        tenantId,
        bookingId: booking.id,
        userId: recorder.id,
        status: 'PAID',
        baseAmount: 1_000_000,
        amount: 20_000,
        currency: 'AED',
        paidAt: new Date(),
      },
    });
    return prisma.collectionRecoveryCase.create({
      data: {
        tenantId,
        bookingId: booking.id,
        commissionId: commission.id,
        kind: 'RECEIPT_REVERSAL',
        receiptId: receipt.id,
        shortfall: 5_000,
        currency: 'AED',
        reason: `Chargeback ${tag}`,
      },
    });
  }

  const patchedRecovery = (page: Page) =>
    page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/collections/recovery') && res.request().method() === 'PATCH',
    );

  test('recovery case, desktop: acknowledging moves no money; recording a recovery needs evidence', async ({
    browser,
  }) => {
    const kase = await openCase();
    const r = await signedIn(browser, recorder);
    try {
      await r.page.goto(at('/sales/collections/recovery'));
      const card = r.page.getByTestId(`case-${kase.id}`);
      await expect(card).toBeVisible({ timeout: 30_000 });

      await card.getByRole('button', { name: 'Acknowledge' }).click();
      await card.getByLabel('Acknowledgement note').fill('Spoke to the developer');
      const acked = patchedRecovery(r.page);
      await card.getByRole('button', { name: 'Save acknowledgement' }).click();
      expect((await acked).status()).toBe(200);
      await expect(card).toContainText('ACKNOWLEDGED', { timeout: 30_000 });
      const afterAck = await prisma.collectionRecoveryCase.findFirstOrThrow({ where: { id: kase.id, tenantId } });
      expect(afterAck.outcome).toBeNull();
      expect(afterAck.recoveredAmount).toBeNull();

      await card.getByRole('button', { name: 'Record recovery' }).click();
      const form = card.getByTestId('recover-form');
      await form.getByLabel('Amount recovered').fill('5000.00');
      await form.getByLabel('Recovery reference').fill(`RCV-${run}`);
      // The submit stays disabled until there is evidence.
      await expect(form.getByRole('button', { name: 'Record recovery' })).toBeDisabled();
      await form.getByLabel('Recovery transaction id').fill(`txn_recovered_${run}`);
      const recovered = patchedRecovery(r.page);
      await form.getByRole('button', { name: 'Record recovery' }).click();
      expect((await recovered).status()).toBe(200);
      await expect(card).toContainText('RECOVERED', { timeout: 30_000 });

      const done = await prisma.collectionRecoveryCase.findFirstOrThrow({
        where: { id: kase.id, tenantId },
        include: { commission: true },
      });
      expect(done.status).toBe('RESOLVED');
      expect(done.providerTransactionRef).toBe(`txn_recovered_${run}`);
      expect(done.commission.status).toBe('PAID'); // nothing rewritten
    } finally {
      await r.close();
    }
  });

  test('recovery case, mobile: a write-off proposed by one person is approved only by another', async ({ browser }) => {
    const kase = await openCase();
    const r = await signedIn(browser, recorder, true);
    const v = await signedIn(browser, verifier, true);
    try {
      await r.page.goto(at('/sales/collections/recovery'));
      const mine = r.page.getByTestId(`case-${kase.id}`);
      await expect(mine).toBeVisible({ timeout: 30_000 });
      await mine.getByRole('button', { name: 'Propose write-off / adjustment' }).click();
      await mine.getByLabel('Proposal reason').fill('Uneconomic to pursue');
      const proposed = patchedRecovery(r.page);
      await mine.getByRole('button', { name: 'Propose', exact: true }).click();
      expect((await proposed).status()).toBe(200);
      await expect(mine).toContainText(/Awaiting a second person/, { timeout: 30_000 });
      await expect(mine.getByRole('button', { name: /Approve/ })).toHaveCount(0);
      const overflow = await r.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      await v.page.goto(at('/sales/collections/recovery'));
      const theirs = v.page.getByTestId(`case-${kase.id}`);
      const approved = v.page.waitForResponse((res) => res.url().includes('/api/v1/collections/recovery/approve'));
      await theirs.getByRole('button', { name: /Approve written off/ }).click();
      expect((await approved).status()).toBe(200);
      await expect(theirs).toContainText('WRITTEN OFF', { timeout: 30_000 });

      const done = await prisma.collectionRecoveryCase.findFirstOrThrow({ where: { id: kase.id, tenantId } });
      expect(done.outcome).toBe('WRITTEN_OFF');
      expect(done.proposedById).toBe(recorder.id);
      expect(done.approvedById).toBe(verifier.id);
    } finally {
      await r.close();
      await v.close();
    }
  });
  test('evidence upload: a failed upload keeps the form, a PDF attaches, the receipt stays pending and the file persists', async ({
    browser,
  }) => {
    const r = await signedIn(browser, recorder);
    try {
      await r.page.goto(at(`/sales/collections/${bookingId}`));
      await r.page.getByRole('button', { name: 'Record a receipt' }).click();
      await r.page.getByLabel('Amount received').fill('1000.00');
      await r.page.getByLabel('Payment date').fill('2026-09-11');
      await r.page.getByLabel('Payment reference').fill(`REF-E-${run}`);

      // A file that is not a PDF, PNG or JPEG, whatever its name says.
      await r.page.getByLabel('Evidence document').setInputFiles({
        name: 'receipt.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('not really a pdf'),
      });
      await expect(r.page.getByTestId('evidence-status')).toContainText('must be a PDF, PNG or JPEG', {
        timeout: 30_000,
      });
      await expect(r.page.getByLabel('Amount received')).toHaveValue('1000.00'); // nothing typed was lost

      await r.page.getByLabel('Evidence document').setInputFiles({
        name: `bank-advice-${run}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.4\n% evidence ${run}\n%%EOF\n`),
      });
      await expect(r.page.getByTestId('evidence-status')).toContainText(`Attached: bank-advice-${run}.pdf`, {
        timeout: 30_000,
      });
      const saved = r.page.waitForResponse(
        (res) => res.url().endsWith('/api/v1/collections/receipts') && res.request().method() === 'POST',
      );
      await r.page.getByRole('button', { name: 'Save receipt' }).click();
      expect((await saved).status()).toBe(200);

      // Persistence: a fresh load shows the receipt, pending, with its document.
      await r.page.reload();
      const row = r.page.getByTestId('receipts-table').getByRole('row', { name: new RegExp(`REF-E-${run}`) });
      await expect(row).toContainText('PENDING', { timeout: 30_000 });
      await expect(row.getByTestId('evidence-link')).toBeVisible();
      evidenceHref = (await row.getByTestId('evidence-link').getAttribute('href')) ?? '';
      expect(evidenceHref).toMatch(/\/api\/v1\/collections\/receipts\/evidence\//);

      const receipt = await prisma.agencyFeeReceipt.findFirstOrThrow({
        where: { tenantId, bookingId, paymentReference: `REF-E-${run}` },
      });
      expect(receipt.status).toBe('PENDING');
      expect(receipt.verifiedById).toBeNull();
      expect(receipt.providerTransactionRef).toBeNull();
      expect(receipt.evidenceDocumentId).not.toBeNull();
    } finally {
      await r.close();
    }
  });

  test('evidence download: the verifier gets the file; a seller is refused; another workspace cannot see it', async ({
    browser,
  }) => {
    const v = await signedIn(browser, verifier);
    const s = await signedIn(browser, seller);
    try {
      const ok = await v.page.request.get(evidenceHref);
      expect(ok.status()).toBe(200);
      expect((await ok.body()).toString()).toContain(`% evidence ${run}`);
      expect((await s.page.request.get(evidenceHref)).status()).toBe(403);
    } finally {
      await v.close();
      await s.close();
    }

    // A second workspace, created the way a real one is; its administrator holds the whole catalogue.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const foreign = {
        displayName: `Collections UI Foreign ${run}`,
        slug: `cuif-${run}`.toLowerCase(),
        adminName: `Foreign Admin ${run}`,
        adminEmail: `cuif-admin-${run}@masterapp.local`,
        adminPassword: strongPassword(`cuif${run}`),
        modules: ['SALES'] as ('SALES' | 'HRMS')[],
      };
      await resetLoginThrottle();
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, foreign);
      await resetLoginThrottle();
      await login(page, foreign.adminEmail, foreign.adminPassword);
      expect((await page.request.get(evidenceHref)).status()).toBe(404);
    } finally {
      await context.close();
    }
  });
});
