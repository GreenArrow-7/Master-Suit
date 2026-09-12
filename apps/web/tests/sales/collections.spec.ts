/**
 * Agency-fee receipts: who may record money, who may say it is real, and what
 * that permits.
 *
 * D-8.1–D-8.5 as tests. The two findings that stayed red through the release
 * checkpoint — C1 (the seller could certify their own collection) and C2 (no
 * amount was recorded anywhere) — are the first two blocks here, inside the
 * mandatory suite rather than a diagnostic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, type PermissionAction } from '@prisma/client';
import { prisma } from '@/lib/db';
import { POST as recordRoute, GET as listRoute } from '@/app/api/v1/collections/receipts/route';
import { PATCH as decideRoute } from '@/app/api/v1/collections/receipts/decide/route';
import { POST as reverseRoute } from '@/app/api/v1/collections/receipts/reverse/route';
import { accrueCommission, transitionCommission } from '@/services/money/commissions';
import { buildPayout, decidePayout } from '@/services/money/payouts';
import { coverage, decideReceipt, recordReceipt, reverseReceipt } from '@/services/money/collections';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { fixtureUnit } from '../helpers/inventory';
import { createSessionToken } from '../helpers/session';
import { buildActor, buildCtx } from '../helpers/ctx';
import { get, patch, post } from '../helpers/request';
import type { Ctx, Scope } from '@/lib/security/rbac';

const suffix = randomBytes(4).toString('hex');
const D = (n: string | number) => new Prisma.Decimal(n);

let fixture: Fixture;
let tenantId = '';
let otherTenantId = '';
let projectId = '';
let leadId = '';

/** Route-level identities: a selling agent, two finance people, a finance person in the other workspace. */
let seller = { id: '', cookie: '' };
let recorder = { id: '', cookie: '' };
let verifier = { id: '', cookie: '' };
let foreignFinance = { id: '', cookie: '' };

/** Service-level contexts for the money lifecycle. */
let recorderCtx: Ctx;
let verifierCtx: Ctx;
let clerk: Ctx;
let approver: Ctx;

const FINANCE: readonly (readonly [string, PermissionAction])[] = [
  ['collections', 'VIEW'],
  ['collections', 'CREATE'],
  ['collections', 'APPROVE'],
  ['bookings', 'VIEW'],
];
const SELLER: readonly (readonly [string, PermissionAction])[] = [
  ['bookings', 'VIEW'],
  ['bookings', 'CREATE'],
  ['bookings', 'EDIT'],
];

async function person(tenant: string, label: string, grants: typeof FINANCE) {
  const role = await prisma.role.create({
    data: { tenantId: tenant, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenant, role.id, grants);
  const user = await createWorkspaceUser({
    tenantId: tenant,
    roleId: role.id,
    email: `${label}-${suffix}@collections.test`,
    fullName: label,
  });
  return { id: user.id, cookie: await createSessionToken(tenant, user.id) };
}

const perms = (pairs: [string, Scope][]) => new Map<string, Scope>(pairs);

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  otherTenantId = fixture.b.tenantId;
  await prisma.moduleEntitlement.upsert({
    where: { tenantId_module: { tenantId, module: 'SALES' } },
    update: { state: 'ACTIVE' },
    create: { tenantId, module: 'SALES', state: 'ACTIVE' },
  });
  await prisma.moduleEntitlement.upsert({
    where: { tenantId_module: { tenantId: otherTenantId, module: 'SALES' } },
    update: { state: 'ACTIVE' },
    create: { tenantId: otherTenantId, module: 'SALES', state: 'ACTIVE' },
  });

  seller = await person(tenantId, 'seller', SELLER);
  recorder = await person(tenantId, 'recorder', FINANCE);
  verifier = await person(tenantId, 'verifier', FINANCE);
  foreignFinance = await person(otherTenantId, 'foreign', FINANCE);

  const money = (id: string) =>
    buildCtx(
      buildActor({
        id,
        tenantId,
        permissions: perms([
          ['collections:VIEW', 'ORGANIZATION'],
          ['collections:CREATE', 'ORGANIZATION'],
          ['collections:APPROVE', 'ORGANIZATION'],
          ['commissions:VIEW', 'ORGANIZATION'],
          ['commissions:CREATE', 'ORGANIZATION'],
          ['commissions:EDIT', 'ORGANIZATION'],
          ['commissions:APPROVE', 'ORGANIZATION'],
          ['payouts:VIEW', 'ORGANIZATION'],
          ['payouts:CREATE', 'ORGANIZATION'],
        ]),
      }),
    );
  recorderCtx = money(recorder.id);
  verifierCtx = money(verifier.id);
  clerk = recorderCtx;
  approver = buildCtx(
    buildActor({
      id: verifier.id,
      tenantId,
      permissions: perms([
        ['payouts:VIEW', 'ORGANIZATION'],
        ['payouts:APPROVE', 'ORGANIZATION'],
        ['collections:APPROVE', 'ORGANIZATION'],
      ]),
    }),
  );

  const project = await prisma.project.create({
    data: { tenantId, name: 'Collections project', code: `CL-${suffix}` },
  });
  projectId = project.id;
  const stage = await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', position: 0, isDefault: true },
  });
  const lead = await prisma.lead.create({
    data: { tenantId, reference: `CLL-${suffix}`, fullName: 'Buyer', stageId: stage.id, ownerId: seller.id },
  });
  leadId = lead.id;

  const slab = await prisma.commissionSlab.create({
    data: {
      tenantId,
      name: 'Collections slab',
      mode: 'FLAT',
      basis: 'PERCENT_OF_SALE',
      effectiveFrom: new Date(Date.now() - 86_400_000),
      approvedById: 'finance-head',
      approvedAt: new Date(),
    },
  });
  await prisma.commissionSlabBand.create({
    data: { tenantId, slabId: slab.id, fromAmount: D(0), toAmount: null, ratePct: D(2) },
  });
});

afterAll(async () => {
  await fixture.cleanup();
  await prisma.platformUser
    .deleteMany({ where: { normalizedEmail: { endsWith: `-${suffix}@collections.test` } } })
    .catch(() => {});
});

/** A confirmed sale with an agreed agency fee, owned by the seller. */
/**
 * `ownerId` defaults to the seller; the payout tests pass a fresh agent each,
 * because a run gathers every collected commission a person has and refuses a
 * second run while one is outstanding — one payee per test keeps them apart.
 */
async function sale(agencyFee: number | null = 100_000, saleValue = 2_000_000, ownerId: string = seller.id) {
  const unit = await fixtureUnit(tenantId, projectId, 'BOOKED');
  return prisma.booking.create({
    data: {
      tenantId,
      reference: `BK-${randomBytes(4).toString('hex')}`,
      leadId,
      projectId,
      unitInventoryId: unit.id,
      ownerId,
      status: 'CONFIRMED',
      saleValue: D(saleValue),
      agencyFee: agencyFee == null ? null : D(agencyFee),
      currency: 'AED',
      bookingDate: new Date(),
    },
  });
}

const receiptBody = (bookingId: string, amount: string, over: Record<string, unknown> = {}) => ({
  bookingId,
  amount,
  currency: 'AED',
  paidAt: new Date('2026-09-10T09:00:00Z').toISOString(),
  paymentReference: `BANK-${randomBytes(3).toString('hex')}`,
  providerTransactionRef: `txn_${randomBytes(6).toString('hex')}`,
  ...over,
});

/** Record as one person and verify as another, through the service. */
async function verifiedReceipt(bookingId: string, amount: string) {
  const { receipt } = await recordReceipt({
    ctx: recorderCtx,
    bookingId,
    amount,
    currency: 'AED',
    paidAt: new Date(),
    paymentReference: `ref-${randomBytes(3).toString('hex')}`,
    providerTransactionRef: `txn_${randomBytes(6).toString('hex')}`,
  });
  await decideReceipt({ ctx: verifierCtx, receiptId: receipt.id, to: 'VERIFIED' });
  return receipt.id;
}

async function cov(bookingId: string) {
  return prisma.$transaction((tx) => coverage(tx as never, tenantId, bookingId));
}

// ── C1 ───────────────────────────────────────────────────────────────────────
describe('C1: who may say money arrived', () => {
  it('a selling agent with every booking permission cannot record a receipt', async () => {
    const b = await sale();
    const res = await post(recordRoute, '/api/v1/collections/receipts', receiptBody(b.id, '100000.00'), seller.cookie);
    expect(res.status).toBe(403);
  });

  it('a finance role records one, pending until someone else looks', async () => {
    const b = await sale();
    const res = await post(
      recordRoute,
      '/api/v1/collections/receipts',
      receiptBody(b.id, '100000.00'),
      recorder.cookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.receipt.status).toBe('PENDING');
    expect(res.body.receipt.recordedById).toBe(recorder.id);
    expect(res.body.receipt.verifiedById).toBeNull();
  });

  it('the recorder cannot verify their own entry — not even with the approve permission', async () => {
    const b = await sale();
    const rec = await post(
      recordRoute,
      '/api/v1/collections/receipts',
      receiptBody(b.id, '100000.00'),
      recorder.cookie,
    );
    const own = await patch(
      decideRoute,
      '/api/v1/collections/receipts/decide',
      { receiptId: rec.body.receipt.id, to: 'VERIFIED' },
      recorder.cookie,
    );
    expect(own.status).toBe(403);

    const other = await patch(
      decideRoute,
      '/api/v1/collections/receipts/decide',
      { receiptId: rec.body.receipt.id, to: 'VERIFIED' },
      verifier.cookie,
    );
    expect(other.status, JSON.stringify(other.body)).toBe(200);
    expect(other.body.receipt.status).toBe('VERIFIED');
    expect(other.body.receipt.verifiedById).toBe(verifier.id);

    const again = await patch(
      decideRoute,
      '/api/v1/collections/receipts/decide',
      { receiptId: rec.body.receipt.id, to: 'VERIFIED' },
      verifier.cookie,
    );
    expect(again.status).toBe(409);
  });

  it('a seller cannot verify either', async () => {
    const b = await sale();
    const rec = await post(recordRoute, '/api/v1/collections/receipts', receiptBody(b.id, '1.00'), recorder.cookie);
    const res = await patch(
      decideRoute,
      '/api/v1/collections/receipts/decide',
      { receiptId: rec.body.receipt.id, to: 'VERIFIED' },
      seller.cookie,
    );
    expect(res.status).toBe(403);
  });
});

// ── C2 ───────────────────────────────────────────────────────────────────────
describe('C2: what a receipt records', () => {
  it('carries the amount, currency, payment date, reference and evidence — with the three times kept apart', async () => {
    const b = await sale();
    const body = receiptBody(b.id, '12345.67');
    const res = await post(recordRoute, '/api/v1/collections/receipts', body, recorder.cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body.receipt;
    expect(r.amount).toBe('12345.67');
    expect(r.currency).toBe('AED');
    expect(new Date(r.paidAt).toISOString()).toBe('2026-09-10T09:00:00.000Z');
    expect(r.paymentReference).toBe(body.paymentReference);
    expect(r.providerTransactionRef).toBe(body.providerTransactionRef);
    // Recorded now, paid on the 10th, verified not yet: three different facts.
    expect(new Date(r.recordedAt).getTime()).toBeGreaterThan(new Date(r.paidAt).getTime());
    expect(r.verifiedAt).toBeNull();

    // And the ledger's own view: coverage is read from receipts, never from a timestamp.
    const listed = await get(listRoute, `/api/v1/collections/receipts?bookingId=${b.id}`, recorder.cookie);
    expect(listed.status).toBe(200);
    expect(listed.body.coverage.due).toBe('100000');
    expect(listed.body.coverage.pending).toBe('12345.67');
    expect(listed.body.coverage.verified).toBe('0');
    expect(listed.body.coverage.covered).toBe(false);
  });

  it('refuses a reference without evidence, a non-positive amount, and a foreign currency', async () => {
    const b = await sale();
    const noEvidence = receiptBody(b.id, '10.00');
    delete (noEvidence as Record<string, unknown>).providerTransactionRef;
    expect((await post(recordRoute, '/api/v1/collections/receipts', noEvidence, recorder.cookie)).status).toBe(422);
    expect(
      (await post(recordRoute, '/api/v1/collections/receipts', receiptBody(b.id, '0.00'), recorder.cookie)).status,
    ).toBe(422);
    expect(
      (
        await post(
          recordRoute,
          '/api/v1/collections/receipts',
          receiptBody(b.id, '10.00', { currency: 'INR' }),
          recorder.cookie,
        )
      ).status,
    ).toBe(422);
  });

  it('the legacy timestamp on the booking counts for nothing', async () => {
    const b = await sale();
    await prisma.booking.update({ where: { id: b.id, tenantId }, data: { collectedAt: new Date() } });
    const c = await cov(b.id);
    expect(c.verified.toString()).toBe('0');
    expect(c.covered).toBe(false);
  });
});

// ── Duplicates and tenancy ───────────────────────────────────────────────────
describe('duplicate submission and workspace boundary', () => {
  it('the same request key returns the same receipt; the same key with a different body is refused', async () => {
    const b = await sale();
    const body = receiptBody(b.id, '500.00', { requestKey: `key-${suffix}-${randomBytes(4).toString('hex')}` });
    const first = await post(recordRoute, '/api/v1/collections/receipts', body, recorder.cookie);
    const second = await post(recordRoute, '/api/v1/collections/receipts', body, recorder.cookie);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.receipt.id).toBe(first.body.receipt.id);
    expect(second.body.replayed).toBe(true);
    expect(await prisma.agencyFeeReceipt.count({ where: { tenantId, bookingId: b.id } })).toBe(1);

    const tampered = await post(
      recordRoute,
      '/api/v1/collections/receipts',
      { ...body, amount: '600.00' },
      recorder.cookie,
    );
    expect(tampered.status).toBe(409);
  });

  it('finance in another workspace can neither record against nor verify this booking', async () => {
    const b = await sale();
    const rec = await post(recordRoute, '/api/v1/collections/receipts', receiptBody(b.id, '10.00'), recorder.cookie);
    expect(rec.status).toBe(200);

    const foreignRecord = await post(
      recordRoute,
      '/api/v1/collections/receipts',
      receiptBody(b.id, '10.00'),
      foreignFinance.cookie,
    );
    expect(foreignRecord.status).toBe(404);
    const foreignVerify = await patch(
      decideRoute,
      '/api/v1/collections/receipts/decide',
      { receiptId: rec.body.receipt.id, to: 'VERIFIED' },
      foreignFinance.cookie,
    );
    expect(foreignVerify.status).toBe(404);
  });
});

// ── The 100 % rule ───────────────────────────────────────────────────────────
describe('commission eligibility follows verified money, fully and only', () => {
  async function accruedConfirmed(bookingId: string) {
    const { commissions } = await accrueCommission({ ctx: clerk, bookingId });
    const id = commissions[0].id;
    await transitionCommission({ ctx: clerk, commissionId: id, to: 'CONFIRMED' });
    return id;
  }

  it('partial, pending and rejected receipts do not qualify; the last dirham does', async () => {
    const b = await sale(100_000);
    const commissionId = await accruedConfirmed(b.id);

    await verifiedReceipt(b.id, '40000.00');
    await expect(transitionCommission({ ctx: clerk, commissionId, to: 'COLLECTED' })).rejects.toMatchObject({
      status: 422,
      errors: [expect.objectContaining({ code: 'not_covered:short' })],
    });

    // Pending: recorded, nobody has verified it.
    const { receipt: pending } = await recordReceipt({
      ctx: recorderCtx,
      bookingId: b.id,
      amount: '60000.00',
      currency: 'AED',
      paidAt: new Date(),
      paymentReference: 'pending-one',
      providerTransactionRef: 'txn_pending',
    });
    expect((await cov(b.id)).covered).toBe(false);
    // Rejected: looked at and refused.
    await decideReceipt({ ctx: verifierCtx, receiptId: pending.id, to: 'REJECTED', reason: 'Wrong booking' });
    expect((await cov(b.id)).covered).toBe(false);
    await expect(transitionCommission({ ctx: clerk, commissionId, to: 'COLLECTED' })).rejects.toMatchObject({
      status: 422,
    });

    await verifiedReceipt(b.id, '60000.00');
    const c = await cov(b.id);
    expect(c.verified.toString()).toBe('100000');
    expect(c.covered).toBe(true);
    const collected = await transitionCommission({ ctx: clerk, commissionId, to: 'COLLECTED' });
    expect(collected.commission.status).toBe('COLLECTED');
  });

  it('overpayment qualifies and changes nothing about the commission', async () => {
    const b = await sale(100_000);
    const commissionId = await accruedConfirmed(b.id);
    const before = await prisma.commission.findFirstOrThrow({ where: { id: commissionId, tenantId } });
    await verifiedReceipt(b.id, '150000.00');
    const collected = await transitionCommission({ ctx: clerk, commissionId, to: 'COLLECTED' });
    expect(collected.commission.status).toBe('COLLECTED');
    expect(collected.commission.amount.toString()).toBe(before.amount.toString());
  });

  it('a booking with no agreed agency fee is not eligible, however much arrives', async () => {
    const b = await sale(null);
    const commissionId = await accruedConfirmed(b.id);
    await verifiedReceipt(b.id, '999999.00');
    await expect(transitionCommission({ ctx: clerk, commissionId, to: 'COLLECTED' })).rejects.toMatchObject({
      status: 422,
      errors: [expect.objectContaining({ code: 'not_covered:agency_fee_unset' })],
    });
  });
});

// ── Reversals ────────────────────────────────────────────────────────────────
describe('reversals: before and after money is paid out', () => {
  const PERIOD = { periodStart: new Date(Date.now() - 86_400_000), periodEnd: new Date(Date.now() + 86_400_000) };

  async function collectedCommission(bookingId: string) {
    const { commissions } = await accrueCommission({ ctx: clerk, bookingId });
    const id = commissions[0].id;
    await transitionCommission({ ctx: clerk, commissionId: id, to: 'CONFIRMED' });
    await transitionCommission({ ctx: clerk, commissionId: id, to: 'COLLECTED' });
    return id;
  }

  it('a reversal is recorded like a receipt and counts only once a second person verifies it', async () => {
    const b = await sale(100_000);
    const receiptId = await verifiedReceipt(b.id, '100000.00');
    const res = await post(
      reverseRoute,
      '/api/v1/collections/receipts/reverse',
      { receiptId, amount: '30000.00', reason: 'Bounced cheque' },
      recorder.cookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.receipt.kind).toBe('REVERSAL');
    expect(res.body.receipt.reversesId).toBe(receiptId);
    expect((await cov(b.id)).covered).toBe(true); // pending reversal changes nothing yet

    // The original is untouched.
    const original = await prisma.agencyFeeReceipt.findFirstOrThrow({ where: { id: receiptId, tenantId } });
    expect(original.status).toBe('VERIFIED');
    expect(original.amount.toString()).toBe('100000');

    // More than what is left cannot be reversed.
    const tooMuch = await post(
      reverseRoute,
      '/api/v1/collections/receipts/reverse',
      { receiptId, amount: '80000.00', reason: 'Second bounce' },
      recorder.cookie,
    );
    expect(tooMuch.status).toBe(422);
  });

  it('verified before payout: unpaid commission loses eligibility and leaves its run; the run cannot be paid', async () => {
    const agent = `agent-${randomBytes(3).toString('hex')}`;
    const b = await sale(100_000, 2_000_000, agent);
    const receiptId = await verifiedReceipt(b.id, '100000.00');
    const commissionId = await collectedCommission(b.id);
    const { payout } = await buildPayout({ ctx: clerk, userId: agent, ...PERIOD });
    await decidePayout({ ctx: approver, payoutId: payout.id, to: 'APPROVED' });

    const { receipt: reversal } = await reverseReceipt({
      ctx: recorderCtx,
      receiptId,
      amount: '1.00',
      reason: 'Short by one',
    });
    const decided = await decideReceipt({ ctx: verifierCtx, receiptId: reversal.id, to: 'VERIFIED' });
    expect(decided.regressed).toEqual([commissionId]);
    expect(decided.detachedFromPayouts).toEqual([payout.id]);
    expect(decided.recoveryCases).toEqual([]);

    const commission = await prisma.commission.findFirstOrThrow({ where: { id: commissionId, tenantId } });
    expect(commission.status).toBe('CONFIRMED');
    expect(commission.payoutId).toBeNull();
    const run = await prisma.payout.findFirstOrThrow({ where: { id: payout.id, tenantId } });
    expect(run.status).toBe('DRAFT'); // an approval of a different total is not an approval of this one
    expect(run.totalAmount.toString()).toBe('0');
    expect(run.note).toMatch(/reversed/);

    // Nobody can pay it out of the side door either.
    await expect(decidePayout({ ctx: approver, payoutId: payout.id, to: 'APPROVED' })).resolves.toBeTruthy(); // empty run, nothing uncovered
    await expect(transitionCommission({ ctx: clerk, commissionId, to: 'COLLECTED' })).rejects.toMatchObject({
      status: 422,
    });
  });

  it('verified after payment: nothing is rewritten, nobody is debited, finance gets a case', async () => {
    const agent = `agent-${randomBytes(3).toString('hex')}`;
    const b = await sale(100_000, 2_000_000, agent);
    const receiptId = await verifiedReceipt(b.id, '100000.00');
    const commissionId = await collectedCommission(b.id);
    const { payout } = await buildPayout({ ctx: clerk, userId: agent, ...PERIOD });
    await decidePayout({ ctx: approver, payoutId: payout.id, to: 'APPROVED' });
    await decidePayout({ ctx: approver, payoutId: payout.id, to: 'PAID', paymentRef: 'TRF-1' });

    const { receipt: reversal } = await reverseReceipt({
      ctx: recorderCtx,
      receiptId,
      amount: '25000.00',
      reason: 'Chargeback',
    });
    const decided = await decideReceipt({ ctx: verifierCtx, receiptId: reversal.id, to: 'VERIFIED' });
    expect(decided.regressed).toEqual([]);
    expect(decided.recoveryCases).toHaveLength(1);

    const commission = await prisma.commission.findFirstOrThrow({ where: { id: commissionId, tenantId } });
    expect(commission.status).toBe('PAID');
    const run = await prisma.payout.findFirstOrThrow({ where: { id: payout.id, tenantId } });
    expect(run.status).toBe('PAID');
    const kase = await prisma.collectionRecoveryCase.findFirstOrThrow({
      where: { id: decided.recoveryCases[0], tenantId },
    });
    expect(kase.status).toBe('OPEN');
    expect(kase.commissionId).toBe(commissionId);
    expect(kase.payoutId).toBe(payout.id);
    expect(kase.shortfall?.toString()).toBe('25000');
    expect(kase.kind).toBe('RECEIPT_REVERSAL');
    expect(kase.currency).toBe('AED');
  });
});

// ── Concurrency ──────────────────────────────────────────────────────────────
describe('two hands at once', () => {
  const PERIOD = { periodStart: new Date(Date.now() - 86_400_000), periodEnd: new Date(Date.now() + 86_400_000) };
  const settle = <T>(p: Promise<T>) =>
    p.then(
      (v) => ({ ok: true as const, v }),
      (e: { status?: number }) => ({ ok: false as const, status: e.status ?? 500, e }),
    );

  it('two verifiers on one receipt: exactly one verification, the other refused, no 500', async () => {
    const b = await sale(100_000);
    const { receipt } = await recordReceipt({
      ctx: recorderCtx,
      bookingId: b.id,
      amount: '100000.00',
      currency: 'AED',
      paidAt: new Date(),
      paymentReference: 'race',
      providerTransactionRef: 'txn_race',
    });
    const second = buildCtx(
      buildActor({ id: 'second-verifier', tenantId, permissions: perms([['collections:APPROVE', 'ORGANIZATION']]) }),
    );
    const [a, c] = await Promise.all([
      settle(decideReceipt({ ctx: verifierCtx, receiptId: receipt.id, to: 'VERIFIED' })),
      settle(decideReceipt({ ctx: second, receiptId: receipt.id, to: 'VERIFIED' })),
    ]);
    expect([a, c].filter((r) => r.ok)).toHaveLength(1);
    const loser = [a, c].find((r) => !r.ok)!;
    expect(loser.ok ? 0 : loser.status).toBe(409);
    const row = await prisma.agencyFeeReceipt.findFirstOrThrow({ where: { id: receipt.id, tenantId } });
    expect(row.status).toBe('VERIFIED');
  });

  it('a reversal being verified while a payout is being approved: one consistent outcome, never both', async () => {
    const agent = `agent-${randomBytes(3).toString('hex')}`;
    const b = await sale(100_000, 2_000_000, agent);
    const receiptId = await verifiedReceipt(b.id, '100000.00');
    const { commissions } = await accrueCommission({ ctx: clerk, bookingId: b.id });
    const commissionId = commissions[0].id;
    await transitionCommission({ ctx: clerk, commissionId, to: 'CONFIRMED' });
    await transitionCommission({ ctx: clerk, commissionId, to: 'COLLECTED' });
    const { payout } = await buildPayout({ ctx: clerk, userId: agent, ...PERIOD });
    const { receipt: reversal } = await reverseReceipt({
      ctx: recorderCtx,
      receiptId,
      amount: '5000.00',
      reason: 'Race',
    });

    const [approve, verify] = await Promise.all([
      settle(decidePayout({ ctx: approver, payoutId: payout.id, to: 'APPROVED' })),
      settle(decideReceipt({ ctx: verifierCtx, receiptId: reversal.id, to: 'VERIFIED' })),
    ]);
    for (const r of [approve, verify]) if (!r.ok) expect(r.status).toBeLessThan(500);
    expect(verify.ok).toBe(true); // a verification is never refused because of a payout

    const run = await prisma.payout.findFirstOrThrow({ where: { id: payout.id, tenantId } });
    const commission = await prisma.commission.findFirstOrThrow({ where: { id: commissionId, tenantId } });
    const c = await cov(b.id);
    expect(c.covered).toBe(false);
    // Whichever went first, the end state is the same: nothing approved rests
    // on money that is no longer there.
    expect(run.status).toBe('DRAFT');
    expect(commission.status).toBe('CONFIRMED');
    expect(commission.payoutId).toBeNull();
  });

  it('a reversal being verified while a payout is being paid: paid ⇒ a recovery case exists; refused ⇒ nothing paid', async () => {
    const agent = `agent-${randomBytes(3).toString('hex')}`;
    const b = await sale(100_000, 2_000_000, agent);
    const receiptId = await verifiedReceipt(b.id, '100000.00');
    const { commissions } = await accrueCommission({ ctx: clerk, bookingId: b.id });
    const commissionId = commissions[0].id;
    await transitionCommission({ ctx: clerk, commissionId, to: 'CONFIRMED' });
    await transitionCommission({ ctx: clerk, commissionId, to: 'COLLECTED' });
    const { payout } = await buildPayout({ ctx: clerk, userId: agent, ...PERIOD });
    await decidePayout({ ctx: approver, payoutId: payout.id, to: 'APPROVED' });
    const { receipt: reversal } = await reverseReceipt({
      ctx: recorderCtx,
      receiptId,
      amount: '5000.00',
      reason: 'Race',
    });

    const [pay, verify] = await Promise.all([
      settle(decidePayout({ ctx: approver, payoutId: payout.id, to: 'PAID', paymentRef: 'TRF-race' })),
      settle(decideReceipt({ ctx: verifierCtx, receiptId: reversal.id, to: 'VERIFIED' })),
    ]);
    for (const r of [pay, verify]) if (!r.ok) expect(r.status).toBeLessThan(500);
    expect(verify.ok).toBe(true);

    const run = await prisma.payout.findFirstOrThrow({ where: { id: payout.id, tenantId } });
    const commission = await prisma.commission.findFirstOrThrow({ where: { id: commissionId, tenantId } });
    const cases = await prisma.collectionRecoveryCase.count({ where: { tenantId, commissionId } });
    if (pay.ok) {
      expect(run.status).toBe('PAID');
      expect(commission.status).toBe('PAID');
      expect(cases).toBe(1);
    } else {
      expect(run.status).toBe('DRAFT');
      expect(commission.status).toBe('CONFIRMED');
      expect(cases).toBe(0);
    }
  });
});
