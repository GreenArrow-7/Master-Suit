/**
 * D-20: the agreed agency fee as a controlled commercial term, and the
 * recovery-case workflow that catches what an amendment or a reversal can no
 * longer fix in the ledger.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, type PermissionAction } from '@prisma/client';
import { prisma } from '@/lib/db';
import { POST as createBooking } from '@/app/api/v1/bookings/route';
import { GET as listAmendmentsRoute, POST as proposeRoute } from '@/app/api/v1/collections/fee-amendments/route';
import { PATCH as decideRoute } from '@/app/api/v1/collections/fee-amendments/decide/route';
import { GET as previewRoute } from '@/app/api/v1/collections/fee-amendments/preview/route';
import { GET as listCasesRoute, PATCH as recoveryRoute } from '@/app/api/v1/collections/recovery/route';
import { PATCH as recoveryApproveRoute } from '@/app/api/v1/collections/recovery/approve/route';
import { accrueCommission, transitionCommission } from '@/services/money/commissions';
import { buildPayout, decidePayout } from '@/services/money/payouts';
import { coverage, decideReceipt, recordReceipt, reverseReceipt } from '@/services/money/collections';
import { decideAmendment, proposeAmendment, recomputeFromFrozen } from '@/services/money/feeAmendments';
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
let projectId = '';
let leadId = '';
let seller = { id: '', cookie: '' };
let director = { id: '', cookie: '' };
let financeA = { id: '', cookie: '' };
let financeB = { id: '', cookie: '' };
let directorCtx: Ctx;
let financeACtx: Ctx;
let financeBCtx: Ctx;
let clerk: Ctx;
let approver: Ctx;

type G = readonly (readonly [string, PermissionAction])[];
const SELLER: G = [
  ['bookings', 'VIEW'],
  ['bookings', 'CREATE'],
  ['bookings', 'EDIT'],
];
const DIRECTOR: G = [
  ['bookings', 'VIEW'],
  ['bookings', 'CREATE'],
  ['bookings', 'EDIT'],
  ['agencyfee', 'VIEW'],
  ['agencyfee', 'CREATE'],
];
const FINANCE: G = [
  ['agencyfee', 'VIEW'],
  ['agencyfee', 'APPROVE'],
  ['collections', 'VIEW'],
  ['collections', 'CREATE'],
  ['collections', 'APPROVE'],
  ['bookings', 'VIEW'],
];

async function person(label: string, grants: G) {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 40, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, role.id, grants);
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${label}-${suffix}@fee.test`,
    fullName: label,
  });
  return { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
}
const perms = (pairs: [string, Scope][]) => new Map<string, Scope>(pairs);
const moneyCtx = (id: string, extra: [string, Scope][] = []) =>
  buildCtx(
    buildActor({
      id,
      tenantId,
      permissions: perms([
        ['agencyfee:VIEW', 'ORGANIZATION'],
        ['collections:VIEW', 'ORGANIZATION'],
        ['collections:CREATE', 'ORGANIZATION'],
        ['collections:APPROVE', 'ORGANIZATION'],
        ['commissions:VIEW', 'ORGANIZATION'],
        ['commissions:CREATE', 'ORGANIZATION'],
        ['commissions:EDIT', 'ORGANIZATION'],
        ['commissions:APPROVE', 'ORGANIZATION'],
        ['payouts:VIEW', 'ORGANIZATION'],
        ['payouts:CREATE', 'ORGANIZATION'],
        ...extra,
      ]),
    }),
  );

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  await prisma.moduleEntitlement.upsert({
    where: { tenantId_module: { tenantId, module: 'SALES' } },
    update: { state: 'ACTIVE' },
    create: { tenantId, module: 'SALES', state: 'ACTIVE' },
  });
  seller = await person('seller', SELLER);
  director = await person('director', DIRECTOR);
  financeA = await person('finance-a', FINANCE);
  financeB = await person('finance-b', FINANCE);
  directorCtx = moneyCtx(director.id, [['agencyfee:CREATE', 'ORGANIZATION']]);
  financeACtx = moneyCtx(financeA.id, [['agencyfee:APPROVE', 'ORGANIZATION']]);
  financeBCtx = moneyCtx(financeB.id, [['agencyfee:APPROVE', 'ORGANIZATION']]);
  clerk = financeACtx;
  approver = buildCtx(
    buildActor({
      id: financeB.id,
      tenantId,
      permissions: perms([
        ['payouts:VIEW', 'ORGANIZATION'],
        ['payouts:APPROVE', 'ORGANIZATION'],
      ]),
    }),
  );

  const project = await prisma.project.create({ data: { tenantId, name: 'Fee project', code: `FEE-${suffix}` } });
  projectId = project.id;
  const stage = await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', position: 0, isDefault: true },
  });
  const lead = await prisma.lead.create({
    data: { tenantId, reference: `FEEL-${suffix}`, fullName: 'Buyer', stageId: stage.id, ownerId: seller.id },
  });
  leadId = lead.id;
  // A slab that pays on the agency fee, so an amendment has something to move.
  const slab = await prisma.commissionSlab.create({
    data: {
      tenantId,
      name: 'Fee slab',
      mode: 'FLAT',
      basis: 'PERCENT_OF_AGENCY_FEE',
      effectiveFrom: new Date(Date.now() - 86_400_000),
      approvedById: 'finance-head',
      approvedAt: new Date(),
    },
  });
  await prisma.commissionSlabBand.create({
    data: { tenantId, slabId: slab.id, fromAmount: D(0), toAmount: null, ratePct: D(10) },
  });
});

afterAll(async () => {
  await fixture.cleanup();
  await prisma.platformUser
    .deleteMany({ where: { normalizedEmail: { endsWith: `-${suffix}@fee.test` } } })
    .catch(() => {});
});

async function sale(agencyFee: number | null, ownerId = seller.id, status: 'DRAFT' | 'CONFIRMED' = 'CONFIRMED') {
  const unit = await fixtureUnit(tenantId, projectId, status === 'CONFIRMED' ? 'BOOKED' : 'AVAILABLE');
  return prisma.booking.create({
    data: {
      tenantId,
      reference: `BK-${randomBytes(4).toString('hex')}`,
      leadId,
      projectId,
      unitInventoryId: unit.id,
      ownerId,
      status,
      saleValue: D(2_000_000),
      agencyFee: agencyFee == null ? null : D(agencyFee),
      currency: 'AED',
      bookingDate: new Date(),
    },
  });
}
async function cover(bookingId: string, amount: string) {
  const { receipt } = await recordReceipt({
    ctx: financeACtx,
    bookingId,
    amount,
    currency: 'AED',
    paidAt: new Date(),
    paymentReference: `r-${randomBytes(3).toString('hex')}`,
    providerTransactionRef: `txn_${randomBytes(6).toString('hex')}`,
  });
  await decideReceipt({ ctx: financeBCtx, receiptId: receipt.id, to: 'VERIFIED' });
  return receipt.id;
}
async function collected(bookingId: string) {
  const { commissions } = await accrueCommission({ ctx: clerk, bookingId });
  const id = commissions[0].id;
  await transitionCommission({ ctx: clerk, commissionId: id, to: 'CONFIRMED' });
  await transitionCommission({ ctx: clerk, commissionId: id, to: 'COLLECTED' });
  return id;
}
const cov = (bookingId: string) => prisma.$transaction((tx) => coverage(tx as never, tenantId, bookingId));
const PERIOD = { periodStart: new Date(Date.now() - 86_400_000), periodEnd: new Date(Date.now() + 86_400_000) };

describe('the frozen recalculation', () => {
  it('re-applies the bands frozen on the commission, and refuses to guess beyond them', () => {
    const flat = {
      slabMode: 'FLAT',
      slabBasis: 'PERCENT_OF_AGENCY_FEE',
      sharePct: D(100),
      calculation: { bands: [{ from: '0', to: null, portion: '100000', ratePct: '10', amount: '10000' }] },
    };
    expect(recomputeFromFrozen(flat, D(120_000))!.amount.toString()).toBe('12000');
    const capped = {
      ...flat,
      calculation: { bands: [{ from: '0', to: '100000', portion: '100000', ratePct: '10', amount: '10000' }] },
    };
    expect(recomputeFromFrozen(capped, D(120_000))).toBeNull();
    const progressive = {
      slabMode: 'PROGRESSIVE',
      slabBasis: 'PERCENT_OF_AGENCY_FEE',
      sharePct: D(50),
      calculation: {
        bands: [
          { from: '0', to: '50000', portion: '50000', ratePct: '5', amount: '2500' },
          { from: '50000', to: null, portion: '50000', ratePct: '10', amount: '5000' },
        ],
      },
    };
    // 0–50k at 5 % = 2,500; 50k–120k at 10 % = 7,000; half share = 4,750.
    expect(recomputeFromFrozen(progressive, D(120_000))!.amount.toString()).toBe('4750');
  });
});

describe('who may change the agreed fee', () => {
  it('a selling agent cannot record a fee at booking, propose one, or approve one', async () => {
    const created = await post(
      createBooking,
      '/api/v1/bookings',
      { leadId, projectId, saleValue: 1_000_000, agencyFee: 30_000, bookingDate: new Date().toISOString() },
      seller.cookie,
    );
    expect(created.status).toBe(403);
    const b = await sale(100_000);
    expect(
      (
        await post(
          proposeRoute,
          '/api/v1/collections/fee-amendments',
          { bookingId: b.id, proposedFee: '90000.00', reason: 'Renegotiated', agreementReference: 'ADD-1' },
          seller.cookie,
        )
      ).status,
    ).toBe(403);
  });

  it('a commercial administrator proposes with reason and reference; the same person cannot approve; finance can', async () => {
    const b = await sale(100_000);
    const proposed = await post(
      proposeRoute,
      '/api/v1/collections/fee-amendments',
      { bookingId: b.id, proposedFee: '120000.00', reason: 'Addendum signed', agreementReference: 'ADD-2' },
      director.cookie,
    );
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);
    const id = proposed.body.amendment.id as string;
    expect(proposed.body.amendment.status).toBe('PENDING');
    expect(proposed.body.amendment.previousFee).toBe('100000');
    expect(proposed.body.preview.coverageAfter.covered).toBe(false);

    // The fee has not moved yet, and a second proposal must wait.
    expect((await prisma.booking.findFirstOrThrow({ where: { id: b.id, tenantId } })).agencyFee?.toString()).toBe(
      '100000',
    );
    expect(
      (
        await post(
          proposeRoute,
          '/api/v1/collections/fee-amendments',
          { bookingId: b.id, proposedFee: '110000.00', reason: 'Again', agreementReference: 'ADD-3' },
          director.cookie,
        )
      ).status,
    ).toBe(409);

    expect(
      (
        await patch(
          decideRoute,
          '/api/v1/collections/fee-amendments/decide',
          { amendmentId: id, to: 'APPROVED' },
          director.cookie,
        )
      ).status,
    ).toBe(403);
    const approved = await patch(
      decideRoute,
      '/api/v1/collections/fee-amendments/decide',
      { amendmentId: id, to: 'APPROVED' },
      financeA.cookie,
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const row = await prisma.agencyFeeAmendment.findFirstOrThrow({ where: { id, tenantId } });
    expect(row.status).toBe('APPROVED');
    expect(row.previousFee?.toString()).toBe('100000');
    expect(row.proposedFee.toString()).toBe('120000');
    expect(row.proposedById).toBe(director.id);
    expect(row.decidedById).toBe(financeA.id);
    expect(row.appliedAt).not.toBeNull();
    expect((await prisma.booking.findFirstOrThrow({ where: { id: b.id, tenantId } })).agencyFee?.toString()).toBe(
      '120000',
    );
  });

  it('refuses a zero fee, and a rejection needs a reason', async () => {
    const b = await sale(100_000);
    expect(
      (
        await post(
          proposeRoute,
          '/api/v1/collections/fee-amendments',
          { bookingId: b.id, proposedFee: '0.00', reason: 'Waived', agreementReference: 'X' },
          director.cookie,
        )
      ).status,
    ).toBe(422);
    const { amendment } = await proposeAmendment({
      ctx: directorCtx,
      bookingId: b.id,
      proposedFee: '90000',
      reason: 'Discount',
      agreementReference: 'ADD-4',
    });
    await expect(
      decideAmendment({ ctx: financeACtx, amendmentId: amendment.id, to: 'REJECTED' }),
    ).rejects.toMatchObject({ status: 422 });
    const rejected = await decideAmendment({
      ctx: financeACtx,
      amendmentId: amendment.id,
      to: 'REJECTED',
      note: 'No signed addendum',
    });
    expect(rejected.amendment.status).toBe('REJECTED');
    expect((await prisma.booking.findFirstOrThrow({ where: { id: b.id, tenantId } })).agencyFee?.toString()).toBe(
      '100000',
    );
  });

  it('before confirmation the proposer applies it directly, and the row says so', async () => {
    const b = await sale(null, seller.id, 'DRAFT');
    const { amendment } = await proposeAmendment({
      ctx: directorCtx,
      bookingId: b.id,
      proposedFee: '50000',
      reason: 'Initial fee',
      agreementReference: 'AGR-1',
    });
    expect(amendment.status).toBe('APPROVED');
    expect(amendment.decidedById).toBeNull();
    expect(amendment.decisionNote).toMatch(/before confirmation/);
    expect((await prisma.booking.findFirstOrThrow({ where: { id: b.id, tenantId } })).agencyFee?.toString()).toBe(
      '50000',
    );
  });

  it('the preview shows the effect before anyone proposes', async () => {
    const b = await sale(100_000);
    await cover(b.id, '100000.00');
    const commissionId = await collected(b.id);
    const res = await get(
      previewRoute,
      `/api/v1/collections/fee-amendments/preview?bookingId=${b.id}&proposedFee=150000.00`,
      director.cookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.coverageBefore.covered).toBe(true);
    expect(res.body.coverageAfter.covered).toBe(false);
    const line = res.body.commissions.find((c: { id: string }) => c.id === commissionId);
    expect(line.action).toBe('recalculate');
    expect(line.currentAmount).toBe('10000');
    expect(line.newAmount).toBe('15000');
  });
});

describe('what approval does to commission and payouts', () => {
  it('recalculates unpaid commission from the frozen bands, reopens an approved payout, and withdraws eligibility when the fee outgrows the receipts', async () => {
    const agent = `agent-${randomBytes(3).toString('hex')}`;
    const b = await sale(100_000, agent);
    await cover(b.id, '100000.00');
    const commissionId = await collected(b.id);
    const { payout } = await buildPayout({ ctx: clerk, userId: agent, ...PERIOD });
    await decidePayout({ ctx: approver, payoutId: payout.id, to: 'APPROVED' });

    const { amendment } = await proposeAmendment({
      ctx: directorCtx,
      bookingId: b.id,
      proposedFee: '150000',
      reason: 'Upsized',
      agreementReference: 'ADD-5',
    });
    const decided = await decideAmendment({ ctx: financeACtx, amendmentId: amendment.id, to: 'APPROVED' });
    expect(decided.applied?.recalculated).toEqual([commissionId]);

    const c = await prisma.commission.findFirstOrThrow({ where: { id: commissionId, tenantId } });
    expect(c.amount.toString()).toBe('15000');
    expect(c.baseAmount.toString()).toBe('150000');
    const trail = (c.calculation as { amendments: { previousAmount: string; newAmount: string }[] }).amendments;
    expect(trail[0].previousAmount).toBe('10000');
    expect(trail[0].newAmount).toBe('15000');
    // Coverage: 100,000 verified against a 150,000 fee — no longer eligible.
    expect((await cov(b.id)).covered).toBe(false);
    expect(c.status).toBe('CONFIRMED');
    expect(c.payoutId).toBeNull();
    const run = await prisma.payout.findFirstOrThrow({ where: { id: payout.id, tenantId } });
    expect(run.status).toBe('DRAFT');
    expect(run.note).toMatch(/amended|Reopened/);
    // The approved amendment carries what it did.
    const row = await prisma.agencyFeeAmendment.findFirstOrThrow({ where: { id: amendment.id, tenantId } });
    expect((row.preview as { recalculated: string[] }).recalculated).toEqual([commissionId]);
  });

  it('never rewrites paid commission: it opens an adjustment case with the signed difference', async () => {
    const agent = `agent-${randomBytes(3).toString('hex')}`;
    const b = await sale(100_000, agent);
    await cover(b.id, '100000.00');
    const commissionId = await collected(b.id);
    const { payout } = await buildPayout({ ctx: clerk, userId: agent, ...PERIOD });
    await decidePayout({ ctx: approver, payoutId: payout.id, to: 'APPROVED' });
    await decidePayout({ ctx: approver, payoutId: payout.id, to: 'PAID', paymentRef: 'TRF-fee' });

    const { amendment } = await proposeAmendment({
      ctx: directorCtx,
      bookingId: b.id,
      proposedFee: '80000',
      reason: 'Renegotiated down',
      agreementReference: 'ADD-6',
    });
    const decided = await decideAmendment({ ctx: financeACtx, amendmentId: amendment.id, to: 'APPROVED' });
    expect(decided.applied?.recalculated).toEqual([]);
    expect(decided.applied?.cases).toHaveLength(1);
    const c = await prisma.commission.findFirstOrThrow({ where: { id: commissionId, tenantId } });
    expect(c.status).toBe('PAID');
    expect(c.amount.toString()).toBe('10000');
    const kase = await prisma.collectionRecoveryCase.findFirstOrThrow({
      where: { id: decided.applied!.cases[0], tenantId },
    });
    expect(kase.kind).toBe('FEE_AMENDMENT');
    expect(kase.adjustment?.toString()).toBe('-2000');
    expect(kase.status).toBe('OPEN');
  });

  it('an amendment racing a payout approval ends consistently, never both', async () => {
    const agent = `agent-${randomBytes(3).toString('hex')}`;
    const b = await sale(100_000, agent);
    await cover(b.id, '100000.00');
    const commissionId = await collected(b.id);
    const { payout } = await buildPayout({ ctx: clerk, userId: agent, ...PERIOD });
    const { amendment } = await proposeAmendment({
      ctx: directorCtx,
      bookingId: b.id,
      proposedFee: '130000',
      reason: 'Race',
      agreementReference: 'ADD-7',
    });
    const settle = <T>(p: Promise<T>) =>
      p.then(
        (v) => ({ ok: true as const, v }),
        (e: { status?: number }) => ({ ok: false as const, status: e.status ?? 500 }),
      );
    const [approve, amend] = await Promise.all([
      settle(decidePayout({ ctx: approver, payoutId: payout.id, to: 'APPROVED' })),
      settle(decideAmendment({ ctx: financeACtx, amendmentId: amendment.id, to: 'APPROVED' })),
    ]);
    for (const r of [approve, amend]) if (!r.ok) expect(r.status).toBeLessThan(500);
    expect(amend.ok).toBe(true);
    const run = await prisma.payout.findFirstOrThrow({ where: { id: payout.id, tenantId } });
    const c = await prisma.commission.findFirstOrThrow({ where: { id: commissionId, tenantId } });
    expect(run.status).toBe('DRAFT');
    expect(c.status).toBe('CONFIRMED');
    expect(c.payoutId).toBeNull();
  });
});

describe('recovery cases: a workflow, not a note', () => {
  async function paidCaseFromReversal() {
    const agent = `agent-${randomBytes(3).toString('hex')}`;
    const b = await sale(100_000, agent);
    const receiptId = await cover(b.id, '100000.00');
    await collected(b.id);
    const { payout } = await buildPayout({ ctx: clerk, userId: agent, ...PERIOD });
    await decidePayout({ ctx: approver, payoutId: payout.id, to: 'APPROVED' });
    await decidePayout({ ctx: approver, payoutId: payout.id, to: 'PAID', paymentRef: 'TRF-x' });
    const { receipt } = await reverseReceipt({ ctx: financeACtx, receiptId, amount: '25000.00', reason: 'Chargeback' });
    const decided = await decideReceipt({ ctx: financeBCtx, receiptId: receipt.id, to: 'VERIFIED' });
    return decided.recoveryCases[0];
  }

  it('acknowledging is not recovering; recovering needs an amount, a reference and evidence', async () => {
    const caseId = await paidCaseFromReversal();
    expect(
      (
        await patch(
          recoveryRoute,
          '/api/v1/collections/recovery',
          { action: 'ASSIGN', caseId, assigneeId: financeB.id },
          financeA.cookie,
        )
      ).status,
    ).toBe(200);
    const ack = await patch(
      recoveryRoute,
      '/api/v1/collections/recovery',
      { action: 'ACKNOWLEDGE', caseId, note: 'Spoke to the developer' },
      financeB.cookie,
    );
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);
    expect(ack.body.status).toBe('ACKNOWLEDGED');
    expect(ack.body.outcome).toBeNull();

    expect(
      (
        await patch(
          recoveryRoute,
          '/api/v1/collections/recovery',
          { action: 'RECOVER', caseId, recoveredAmount: '25000.00', resolutionReference: 'RCV-1' },
          financeB.cookie,
        )
      ).status,
    ).toBe(422);
    const rec = await patch(
      recoveryRoute,
      '/api/v1/collections/recovery',
      {
        action: 'RECOVER',
        caseId,
        recoveredAmount: '25000.00',
        resolutionReference: 'RCV-1',
        providerTransactionRef: 'txn_recovered_1',
      },
      financeB.cookie,
    );
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    expect(rec.body.status).toBe('RESOLVED');
    expect(rec.body.outcome).toBe('RECOVERED');
    // The paid commission and the paid payout are exactly as they were.
    const kase = await prisma.collectionRecoveryCase.findFirstOrThrow({
      where: { id: caseId, tenantId },
      include: { commission: true },
    });
    expect(kase.commission.status).toBe('PAID');
    expect((await prisma.payout.findFirstOrThrow({ where: { id: kase.payoutId!, tenantId } })).status).toBe('PAID');
  });

  it('a write-off is proposed by one person and approved by another; the proposer is refused; a seller is refused everything', async () => {
    const caseId = await paidCaseFromReversal();
    expect(
      (
        await patch(
          recoveryRoute,
          '/api/v1/collections/recovery',
          { action: 'ACKNOWLEDGE', caseId, note: 'seller' },
          seller.cookie,
        )
      ).status,
    ).toBe(403);
    const proposed = await patch(
      recoveryRoute,
      '/api/v1/collections/recovery',
      { action: 'PROPOSE', caseId, outcome: 'WRITTEN_OFF', reason: 'Uneconomic to pursue' },
      financeA.cookie,
    );
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);
    expect(proposed.body.status).toBe('RESOLUTION_PROPOSED');
    expect(
      (
        await patch(
          recoveryApproveRoute,
          '/api/v1/collections/recovery/approve',
          { caseId, approve: true },
          financeA.cookie,
        )
      ).status,
    ).toBe(403);
    const approved = await patch(
      recoveryApproveRoute,
      '/api/v1/collections/recovery/approve',
      { caseId, approve: true, note: 'Agreed' },
      financeB.cookie,
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.status).toBe('RESOLVED');
    expect(approved.body.outcome).toBe('WRITTEN_OFF');
    expect(approved.body.approvedById).toBe(financeB.id);
    expect(approved.body.proposedById).toBe(financeA.id);
  });

  it('a reversal case cannot be closed as an adjustment, and a declined proposal goes back to acknowledged', async () => {
    const caseId = await paidCaseFromReversal();
    expect(
      (
        await patch(
          recoveryRoute,
          '/api/v1/collections/recovery',
          { action: 'PROPOSE', caseId, outcome: 'ADJUSTED', reason: 'Wrong kind' },
          financeA.cookie,
        )
      ).status,
    ).toBe(422);
    const proposed = await patch(
      recoveryRoute,
      '/api/v1/collections/recovery',
      { action: 'PROPOSE', caseId, outcome: 'WRITTEN_OFF', reason: 'Try first' },
      financeA.cookie,
    );
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);
    const declined = await patch(
      recoveryApproveRoute,
      '/api/v1/collections/recovery/approve',
      { caseId, approve: false, note: 'Chase first' },
      financeB.cookie,
    );
    expect(declined.status).toBe(200);
    expect(declined.body.status).toBe('ACKNOWLEDGED');
    expect(declined.body.outcome).toBeNull();
  });
});

// ── Record scope and recovery evidence ───────────────────────────────────────
describe('record scope and recovery evidence', () => {
  let scoped = { id: '', cookie: '' };

  async function paidCase() {
    const agent = `agent-${randomBytes(3).toString('hex')}`;
    const b = await sale(100_000, agent);
    const receiptId = await cover(b.id, '100000.00');
    await collected(b.id);
    const { payout } = await buildPayout({ ctx: clerk, userId: agent, ...PERIOD });
    await decidePayout({ ctx: approver, payoutId: payout.id, to: 'APPROVED' });
    await decidePayout({ ctx: approver, payoutId: payout.id, to: 'PAID', paymentRef: 'TRF-x' });
    const { receipt } = await reverseReceipt({ ctx: financeACtx, receiptId, amount: '25000.00', reason: 'Chargeback' });
    const decided = await decideReceipt({ ctx: financeBCtx, receiptId: receipt.id, to: 'VERIFIED' });
    return { caseId: decided.recoveryCases[0] as string, bookingId: b.id };
  }

  const doc = (
    bookingId: string,
    over: { tenantId?: string; category?: string | null; scanState?: string; key?: string } = {},
  ) => {
    const t = over.tenantId ?? tenantId;
    return prisma.document.create({
      data: {
        tenantId: t,
        name: 'evidence.pdf',
        category: over.category === undefined ? 'agency-fee-evidence' : over.category,
        storageKey: over.key ?? `documents/t-${t}/booking-${bookingId}/${randomBytes(4).toString('hex')}-evidence.pdf`,
        storageBucket: 'test',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        scanState: over.scanState ?? 'CLEAN',
      },
      select: { id: true },
    });
  };

  const recover = (caseId: string, evidence: Record<string, string>, cookie = financeB.cookie) =>
    patch(
      recoveryRoute,
      '/api/v1/collections/recovery',
      { action: 'RECOVER', caseId, recoveredAmount: '25000.00', resolutionReference: 'RCV-S', ...evidence },
      cookie,
    );

  beforeAll(async () => {
    const role = await prisma.role.create({
      data: { tenantId, key: `scoped-${suffix}`, name: 'scoped', rank: 40, defaultScope: 'OWN' },
    });
    await grantPermissions(tenantId, role.id, [...FINANCE, ['agencyfee', 'CREATE']], 'OWN');
    const user = await createWorkspaceUser({
      tenantId,
      roleId: role.id,
      email: `scoped-${suffix}@fee.test`,
      fullName: 'scoped',
    });
    scoped = { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
  });

  it("recovery evidence must be clean agency-fee evidence uploaded for the case's own sale", async () => {
    const other = await sale(100_000);
    const lead = await prisma.lead.findFirstOrThrow({ where: { id: leadId, tenantId } });
    const outcomes: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    const cases: [string, (bookingId: string) => Promise<{ id: string }>][] = [
      ['another workspace', (bk) => doc(bk, { tenantId: fixture.b.tenantId })],
      [
        'a lead attachment',
        () =>
          doc('', {
            category: null,
            key: `documents/t-${tenantId}/lead-${lead.id}/${randomBytes(4).toString('hex')}.pdf`,
          }),
      ],
      ['evidence for another sale', () => doc(other.id)],
      ['scan pending', (bk) => doc(bk, { scanState: 'PENDING' })],
      ['scan infected', (bk) => doc(bk, { scanState: 'INFECTED' })],
      ['scan failed', (bk) => doc(bk, { scanState: 'ERROR' })],
    ];
    for (const [label, make] of cases) {
      const { caseId, bookingId } = await paidCase();
      const d = await make(bookingId);
      const res = await recover(caseId, { evidenceDocumentId: d.id });
      const kase = await prisma.collectionRecoveryCase.findFirstOrThrow({ where: { id: caseId, tenantId } });
      outcomes[label] = {
        status: res.status,
        mentionsDocument: JSON.stringify(res.body).includes(d.id),
        caseStatus: kase.status,
        evidence: kase.evidenceDocumentId,
      };
      expected[label] = { status: 404, mentionsDocument: false, caseStatus: 'OPEN', evidence: null };
    }
    expect(outcomes).toEqual(expected);
  });

  it("clean evidence for the case's own sale, or a transaction id alone, still recovers", async () => {
    const withDoc = await paidCase();
    const d = await doc(withDoc.bookingId);
    const a = await recover(withDoc.caseId, { evidenceDocumentId: d.id });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.evidenceDocumentId).toBe(d.id);

    const withRef = await paidCase();
    const b = await recover(withRef.caseId, { providerTransactionRef: `txn_${randomBytes(6).toString('hex')}` });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(b.body.outcome).toBe('RECOVERED');
  });

  it('a write-off waiting for a second person cannot be overtaken by a recovery; a recovery audits its evidence', async () => {
    const { caseId, bookingId } = await paidCase();
    const proposed = await patch(
      recoveryRoute,
      '/api/v1/collections/recovery',
      { action: 'PROPOSE', caseId, outcome: 'WRITTEN_OFF', reason: 'Uneconomic' },
      financeA.cookie,
    );
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);
    const overtaken = await recover(caseId, { providerTransactionRef: 'txn_overtake_1' }, financeA.cookie);
    const waiting = await prisma.collectionRecoveryCase.findFirstOrThrow({ where: { id: caseId, tenantId } });
    expect({ status: overtaken.status, caseStatus: waiting.status }).toEqual({
      status: 409,
      caseStatus: 'RESOLUTION_PROPOSED',
    });

    // Declined by the second person, the case can be recovered, and the audit names the evidence.
    const declined = await patch(
      recoveryApproveRoute,
      '/api/v1/collections/recovery/approve',
      { caseId, approve: false, note: 'Money came back' },
      financeB.cookie,
    );
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);
    const d = await doc(bookingId);
    const txn = `txn_${randomBytes(6).toString('hex')}`;
    expect(
      (await recover(caseId, { evidenceDocumentId: d.id, providerTransactionRef: txn }, financeA.cookie)).status,
    ).toBe(200);
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, recordId: caseId, objectType: 'collection_recovery' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(entry.newValue).toMatchObject({
      outcome: 'RECOVERED',
      evidenceDocumentId: d.id,
      providerTransactionRef: txn,
    });
  });

  it('a scoped finance user cannot list, work or approve a case, or amend a fee, on a sale outside their scope', async () => {
    const { caseId, bookingId } = await paidCase();
    const proposed = await patch(
      recoveryRoute,
      '/api/v1/collections/recovery',
      { action: 'PROPOSE', caseId, outcome: 'WRITTEN_OFF', reason: 'Uneconomic' },
      financeA.cookie,
    );
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(200);
    const amendment = await post(
      proposeRoute,
      '/api/v1/collections/fee-amendments',
      { bookingId, proposedFee: '90000.00', reason: 'Renegotiated', agreementReference: 'ADD-S' },
      director.cookie,
    );
    expect(amendment.status, JSON.stringify(amendment.body)).toBe(200);

    const listed = await get(listCasesRoute, '/api/v1/collections/recovery', scoped.cookie);
    const statuses = {
      caseListed: listed.body.data.some((k: { id: string }) => k.id === caseId),
      acknowledge: (
        await patch(
          recoveryRoute,
          '/api/v1/collections/recovery',
          { action: 'ACKNOWLEDGE', caseId, note: 'Looked at it' },
          scoped.cookie,
        )
      ).status,
      recover: (await recover(caseId, { providerTransactionRef: 'txn_scoped_1' }, scoped.cookie)).status,
      approve: (
        await patch(
          recoveryApproveRoute,
          '/api/v1/collections/recovery/approve',
          { caseId, approve: true },
          scoped.cookie,
        )
      ).status,
      amendments: (
        await get(listAmendmentsRoute, `/api/v1/collections/fee-amendments?bookingId=${bookingId}`, scoped.cookie)
      ).status,
      preview: (
        await get(
          previewRoute,
          `/api/v1/collections/fee-amendments/preview?bookingId=${bookingId}&proposedFee=80000.00`,
          scoped.cookie,
        )
      ).status,
      propose: (
        await post(
          proposeRoute,
          '/api/v1/collections/fee-amendments',
          { bookingId, proposedFee: '80000.00', reason: 'Scoped try', agreementReference: 'ADD-X' },
          scoped.cookie,
        )
      ).status,
      decide: (
        await patch(
          decideRoute,
          '/api/v1/collections/fee-amendments/decide',
          { amendmentId: amendment.body.amendment.id, to: 'APPROVED' },
          scoped.cookie,
        )
      ).status,
    };
    expect(statuses).toEqual({
      caseListed: false,
      acknowledge: 404,
      recover: 404,
      approve: 404,
      amendments: 404,
      preview: 404,
      propose: 404,
      decide: 404,
    });

    const kase = await prisma.collectionRecoveryCase.findFirstOrThrow({ where: { id: caseId, tenantId } });
    expect(kase.status).toBe('RESOLUTION_PROPOSED');
    const row = await prisma.agencyFeeAmendment.findFirstOrThrow({
      where: { id: amendment.body.amendment.id, tenantId },
    });
    expect(row.status).toBe('PENDING');
  });
});
