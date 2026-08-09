import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { accrueCommission, clawback, transitionCommission } from '@/services/money/commissions';
import { buildPayout, canTransition, decidePayout, statement } from '@/services/money/payouts';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { Ctx, Scope } from '@/lib/security/rbac';

/**
 * A payout run is the only thing that marks a commission PAID, so this is where
 * the ledger's last stage is proved. The controls under test are the ones an
 * auditor asks about: who may release money, and whether the same person can do
 * every step alone.
 */
let fixture: Fixture;
let clerk: Ctx;
let approver: Ctx;
let projectId: string;
let slabId: string;

const D = (n: string | number) => new Prisma.Decimal(n);
const AGENT = 'payout-agent';

const perms = (extra: [string, Scope][] = []) =>
  new Map<string, Scope>([
    ['commissions:VIEW', 'ORGANIZATION'],
    ['commissions:APPROVE', 'ORGANIZATION'],
    ['payouts:VIEW', 'ORGANIZATION'],
    ['payouts:CREATE', 'ORGANIZATION'],
    ...extra,
  ]);

beforeAll(async () => {
  fixture = await seedTwoTenants();

  clerk = buildCtx(buildActor({ id: fixture.a.userId, tenantId: fixture.a.tenantId, permissions: perms() }));
  approver = buildCtx(
    buildActor({
      id: 'payout-approver',
      tenantId: fixture.a.tenantId,
      permissions: perms([['payouts:APPROVE', 'ORGANIZATION']]),
    }),
  );

  const project = await prisma.project.create({
    data: {
      tenantId: fixture.a.tenantId,
      name: 'Payout project',
      code: `PO-${Math.random().toString(36).slice(2, 8)}`,
    },
    select: { id: true },
  });
  projectId = project.id;

  const slab = await prisma.commissionSlab.create({
    data: {
      tenantId: fixture.a.tenantId,
      name: 'Payout slab',
      mode: 'FLAT',
      basis: 'PERCENT_OF_SALE',
      effectiveFrom: new Date(Date.now() - 86_400_000),
      approvedById: approver.actor.id,
      approvedAt: new Date(),
    },
  });
  slabId = slab.id;
  await prisma.commissionSlabBand.create({
    data: { tenantId: fixture.a.tenantId, slabId, fromAmount: D(0), toAmount: null, ratePct: D(2) },
  });
});

beforeEach(async () => {
  await prisma.commission.deleteMany({ where: { tenantId: fixture.a.tenantId } });
  await prisma.payout.deleteMany({ where: { tenantId: fixture.a.tenantId } });
  await prisma.booking.deleteMany({ where: { tenantId: fixture.a.tenantId } });
});

afterAll(async () => {
  const t = { in: [fixture.a.tenantId, fixture.b.tenantId] };
  await prisma.commission.deleteMany({ where: { tenantId: t } });
  await prisma.payout.deleteMany({ where: { tenantId: t } });
  await prisma.booking.deleteMany({ where: { tenantId: t } });
  await prisma.commissionSlabBand.deleteMany({ where: { tenantId: t } });
  await prisma.commissionSlab.deleteMany({ where: { tenantId: t } });
  await prisma.project.deleteMany({ where: { tenantId: t } });
  await fixture.cleanup();
});

/** A booking whose money has arrived, accrued, confirmed and collected. */
async function collected(saleValue: number) {
  const booking = await prisma.booking.create({
    data: {
      tenantId: fixture.a.tenantId,
      reference: `BK-${Math.random().toString(36).slice(2, 10)}`,
      leadId: fixture.a.leadIds[0],
      projectId,
      ownerId: AGENT,
      status: 'CONFIRMED',
      saleValue: D(saleValue),
      bookingDate: new Date(),
      collectedAt: new Date(),
    },
  });
  const { commissions } = await accrueCommission({ ctx: clerk, bookingId: booking.id });
  const id = commissions[0].id;
  await transitionCommission({ ctx: clerk, commissionId: id, to: 'CONFIRMED' });
  await transitionCommission({ ctx: clerk, commissionId: id, to: 'COLLECTED' });
  return { booking, commissionId: id };
}

const PERIOD = { periodStart: new Date(Date.now() - 86_400_000), periodEnd: new Date(Date.now() + 86_400_000) };

describe('the payout run', () => {
  it('permits only the moves that describe money changing hands', () => {
    expect(canTransition('DRAFT', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'PAID')).toBe(true);
    expect(canTransition('DRAFT', 'PAID')).toBe(false);
    expect(canTransition('PAID', 'CANCELLED')).toBe(false);
  });

  it('gathers collected commissions into one statement', async () => {
    await collected(1_000_000);
    await collected(2_000_000);

    const { payout, lines } = await buildPayout({ ctx: clerk, userId: AGENT, ...PERIOD });
    expect(lines).toBe(2);
    // 2% of 1M plus 2% of 2M.
    expect(payout.totalAmount.toString()).toBe('60000');
    expect(payout.status).toBe('DRAFT');
  });

  it('refuses to gather anything that has not been collected', async () => {
    const booking = await prisma.booking.create({
      data: {
        tenantId: fixture.a.tenantId,
        reference: `BK-${Math.random().toString(36).slice(2, 10)}`,
        leadId: fixture.a.leadIds[0],
        projectId,
        ownerId: AGENT,
        status: 'CONFIRMED',
        saleValue: D(1_000_000),
        bookingDate: new Date(),
      },
    });
    await accrueCommission({ ctx: clerk, bookingId: booking.id });
    // Accrued but the client has not paid. Nothing to release.
    await expect(buildPayout({ ctx: clerk, userId: AGENT, ...PERIOD })).rejects.toMatchObject({ status: 409 });
  });

  it('nets a clawback taken before payment down to nothing', async () => {
    const first = await collected(5_000_000);
    await collected(1_000_000);
    // 100 000 accrued and collected, then reversed before anyone was paid.
    await clawback({ ctx: clerk, bookingId: first.booking.id, reason: 'Client rescinded after collection' });

    const { payout } = await buildPayout({ ctx: clerk, userId: AGENT, ...PERIOD });
    // You do not owe back what you were never handed, so the pair cancels and
    // only the untouched 20 000 is left to release.
    expect(payout.totalAmount.toString()).toBe('20000');
  });

  it('lets a run come out negative when the money was already paid', async () => {
    const first = await collected(5_000_000);
    const firstRun = await buildPayout({ ctx: clerk, userId: AGENT, ...PERIOD });
    await decidePayout({ ctx: approver, payoutId: firstRun.payout.id, to: 'APPROVED' });
    await decidePayout({ ctx: approver, payoutId: firstRun.payout.id, to: 'PAID', paymentRef: 'TT-1' });

    // The 100 000 is out of the door. Reversing it now is a real debt: the
    // original sits on last month's run, so only the -100 000 is loose.
    await clawback({ ctx: clerk, bookingId: first.booking.id, reason: 'Client rescinded after payout' });
    await collected(1_000_000);

    const { payout } = await buildPayout({ ctx: clerk, userId: AGENT, ...PERIOD });
    // Filtering the negative out would quietly write the debt off.
    expect(payout.totalAmount.toString()).toBe('-80000');
  });

  it('will not let one person build and approve the same run', async () => {
    await collected(1_000_000);
    const { payout } = await buildPayout({ ctx: clerk, userId: AGENT, ...PERIOD });

    const selfApprover = buildCtx(
      buildActor({
        id: clerk.actor.id,
        tenantId: fixture.a.tenantId,
        permissions: perms([['payouts:APPROVE', 'ORGANIZATION']]),
      }),
    );
    // The one control that stops a single person moving money to themselves.
    await expect(decidePayout({ ctx: selfApprover, payoutId: payout.id, to: 'APPROVED' })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('will not release money without the approval permission', async () => {
    await collected(1_000_000);
    const { payout } = await buildPayout({ ctx: clerk, userId: AGENT, ...PERIOD });
    await expect(decidePayout({ ctx: clerk, payoutId: payout.id, to: 'APPROVED' })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('marks the commissions paid only when the transfer happens', async () => {
    const { commissionId } = await collected(1_000_000);
    const { payout } = await buildPayout({ ctx: clerk, userId: AGENT, ...PERIOD });

    await decidePayout({ ctx: approver, payoutId: payout.id, to: 'APPROVED' });
    let commission = await prisma.commission.findFirstOrThrow({
      where: { id: commissionId, tenantId: fixture.a.tenantId },
    });
    // Approved is not paid. The money has not moved.
    expect(commission.status).toBe('COLLECTED');

    await decidePayout({ ctx: approver, payoutId: payout.id, to: 'PAID', paymentRef: 'TT-90210' });
    commission = await prisma.commission.findFirstOrThrow({
      where: { id: commissionId, tenantId: fixture.a.tenantId },
    });
    expect(commission.status).toBe('PAID');
    expect(commission.paidAt).not.toBeNull();
  });

  it('refuses to pay a run nobody approved', async () => {
    await collected(1_000_000);
    const { payout } = await buildPayout({ ctx: clerk, userId: AGENT, ...PERIOD });
    await expect(decidePayout({ ctx: approver, payoutId: payout.id, to: 'PAID' })).rejects.toMatchObject({
      status: 422,
    });
  });

  it('releases the lines back to the pool when a run is cancelled', async () => {
    const { commissionId } = await collected(1_000_000);
    const { payout } = await buildPayout({ ctx: clerk, userId: AGENT, ...PERIOD });

    await decidePayout({ ctx: approver, payoutId: payout.id, to: 'CANCELLED', note: 'Wrong period' });

    const commission = await prisma.commission.findFirstOrThrow({
      where: { id: commissionId, tenantId: fixture.a.tenantId },
    });
    // A cancelled run must not strand somebody's earnings.
    expect(commission.payoutId).toBeNull();
    expect(commission.status).toBe('COLLECTED');

    // And a new run picks them straight back up.
    const again = await buildPayout({ ctx: clerk, userId: AGENT, ...PERIOD });
    expect(again.payout.totalAmount.toString()).toBe('20000');
  });

  it('will not open a second run while one is outstanding', async () => {
    await collected(1_000_000);
    await buildPayout({ ctx: clerk, userId: AGENT, ...PERIOD });
    await collected(2_000_000);
    await expect(buildPayout({ ctx: clerk, userId: AGENT, ...PERIOD })).rejects.toMatchObject({ status: 409 });
  });

  it('produces a statement whose every line traces to a booking', async () => {
    const { booking } = await collected(1_000_000);
    const { payout } = await buildPayout({ ctx: clerk, userId: AGENT, ...PERIOD });

    const s = await statement(fixture.a.tenantId, payout.id);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].bookingReference).toBe(booking.reference);
    expect(s.lines[0].amount.toString()).toBe('20000');
    // The frozen working travels with the line, so a dispute is re-read rather
    // than re-run against whatever the rates say today.
    expect(s.lines[0].calculation).toHaveProperty('bands');
  });
});
