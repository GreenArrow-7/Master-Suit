import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { SlabError, applySlab, bandFor, orderedBands, splitAmount } from '@/services/money/slabs';
import {
  accrueCommission,
  canTransition,
  clawback,
  reconciliation,
  transitionCommission,
} from '@/services/money/commissions';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { Ctx } from '@/lib/security/rbac';

/**
 * The acceptance criterion names three things: slab boundaries, proration and
 * clawback. All three are here, plus the state machine.
 *
 * Every rate in this file is invented *for the test*. None of it is a default,
 * a seed or a suggestion — the module ships with no rates at all, because the
 * spec requires finance to sign them off first. What is under test is whether
 * the engine applies whatever it is given correctly.
 */
let fixture: Fixture;
let finance: Ctx;
let agent: Ctx;
/** A sale has to be of something; `Booking_subject_check` refuses one that is not. */
let projectId: string;

const D = (n: string | number) => new Prisma.Decimal(n);

/** 0–1M at 2%, 1M–3M at 2.5%, 3M and above at 3%. Invented for the test. */
const TIERS = [
  { fromAmount: D(0), toAmount: D(1_000_000), ratePct: D(2), fixedAmount: null },
  { fromAmount: D(1_000_000), toAmount: D(3_000_000), ratePct: D(2.5), fixedAmount: null },
  { fromAmount: D(3_000_000), toAmount: null, ratePct: D(3), fixedAmount: null },
];

beforeAll(async () => {
  fixture = await seedTwoTenants();

  finance = buildCtx(
    buildActor({
      id: fixture.a.userId,
      tenantId: fixture.a.tenantId,
      permissions: new Map([
        ['commissions:VIEW', 'ORGANIZATION'],
        ['commissions:EDIT', 'ORGANIZATION'],
        ['commissions:APPROVE', 'ORGANIZATION'],
        ['bookings:CREATE', 'ORGANIZATION'],
      ]),
    }),
  );
  agent = buildCtx(
    buildActor({
      id: 'commission-agent',
      tenantId: fixture.a.tenantId,
      permissions: new Map([['commissions:VIEW', 'OWN']]),
    }),
  );

  const project = await prisma.project.create({
    data: {
      tenantId: fixture.a.tenantId,
      name: 'Commission test project',
      code: `CT-${Math.random().toString(36).slice(2, 8)}`,
    },
    select: { id: true },
  });
  projectId = project.id;
});

beforeEach(async () => {
  await prisma.commission.deleteMany({ where: { tenantId: fixture.a.tenantId } });
  await prisma.booking.deleteMany({ where: { tenantId: fixture.a.tenantId } });
  await prisma.commissionSlabBand.deleteMany({ where: { tenantId: fixture.a.tenantId } });
  await prisma.commissionSlab.deleteMany({ where: { tenantId: fixture.a.tenantId } });
});

afterAll(async () => {
  const t = { in: [fixture.a.tenantId, fixture.b.tenantId] };
  await prisma.commission.deleteMany({ where: { tenantId: t } });
  await prisma.booking.deleteMany({ where: { tenantId: t } });
  await prisma.project.deleteMany({ where: { tenantId: t } });
  await prisma.commissionSlabBand.deleteMany({ where: { tenantId: t } });
  await prisma.commissionSlab.deleteMany({ where: { tenantId: t } });
  await fixture.cleanup();
});

// ── Slab boundaries ──────────────────────────────────────────────────────────
describe('slab boundaries', () => {
  it('puts a value exactly on a boundary in the upper band', () => {
    // The single most argued-about line in any commission scheme. Lower bound
    // inclusive, upper exclusive: 1 000 000 belongs to the 1M–3M band.
    expect(bandFor(TIERS, D(999_999.99)).ratePct?.toString()).toBe('2');
    expect(bandFor(TIERS, D(1_000_000)).ratePct?.toString()).toBe('2.5');
    expect(bandFor(TIERS, D(3_000_000)).ratePct?.toString()).toBe('3');
  });

  it('charges each band on its own slice when progressive', () => {
    // 1M@2% = 20 000, next 2M@2.5% = 50 000, last 500k@3% = 15 000.
    const result = applySlab({ base: D(3_500_000), mode: 'PROGRESSIVE', basis: 'PERCENT_OF_SALE', bands: TIERS });
    expect(result.amount.toString()).toBe('85000');
    expect(result.breakdown).toHaveLength(3);
    expect(result.breakdown.map((b) => b.amount)).toEqual(['20000', '50000', '15000']);
    // 85 000 / 3 500 000 — the number a statement shows.
    expect(result.effectiveRatePct.toString()).toBe('2.43');
  });

  it('charges the whole sale at one rate when flat, which is a different product', () => {
    const result = applySlab({ base: D(3_500_000), mode: 'FLAT', basis: 'PERCENT_OF_SALE', bands: TIERS });
    // 3.5M at 3%. Getting the mode wrong is a 24% error in somebody's pay,
    // which is why it is a column rather than an assumption.
    expect(result.amount.toString()).toBe('105000');
    expect(result.effectiveRatePct.toString()).toBe('3');
  });

  it('stops at the first band for a sale inside it', () => {
    const result = applySlab({ base: D(400_000), mode: 'PROGRESSIVE', basis: 'PERCENT_OF_SALE', bands: TIERS });
    expect(result.amount.toString()).toBe('8000');
    expect(result.breakdown).toHaveLength(1);
  });

  it('pays nothing on a sale of nothing, without dividing by zero', () => {
    const result = applySlab({ base: D(0), mode: 'PROGRESSIVE', basis: 'PERCENT_OF_SALE', bands: TIERS });
    expect(result.amount.toString()).toBe('0');
    expect(result.effectiveRatePct.toString()).toBe('0');
  });

  it('rounds each band as it goes, so the lines sum to the total printed', () => {
    const odd = [
      { fromAmount: D(0), toAmount: D(333_333), ratePct: D(1.115), fixedAmount: null },
      { fromAmount: D(333_333), toAmount: null, ratePct: D(2.225), fixedAmount: null },
    ];
    const result = applySlab({ base: D(1_000_000), mode: 'PROGRESSIVE', basis: 'PERCENT_OF_SALE', bands: odd });
    const summed = result.breakdown.reduce((s, b) => s.plus(new Prisma.Decimal(b.amount)), D(0));
    // A statement that lists its working has to add up to the figure beneath it.
    expect(summed.toString()).toBe(result.amount.toString());
  });

  it('refuses a slab with a hole in it rather than paying zero into the gap', () => {
    const holed = [
      { fromAmount: D(0), toAmount: D(1_000_000), ratePct: D(2), fixedAmount: null },
      { fromAmount: D(2_000_000), toAmount: null, ratePct: D(3), fixedAmount: null },
    ];
    // A sale of 1.5M would otherwise earn nothing and nobody would be told.
    expect(() => orderedBands(holed)).toThrow(SlabError);
    expect(() => orderedBands(holed)).toThrow(/would earn nothing/);
  });

  it('refuses overlapping bands, where the answer depends on sort order', () => {
    const overlap = [
      { fromAmount: D(0), toAmount: D(2_000_000), ratePct: D(2), fixedAmount: null },
      { fromAmount: D(1_000_000), toAmount: null, ratePct: D(3), fixedAmount: null },
    ];
    expect(() => orderedBands(overlap)).toThrow(/overlap/);
  });

  it('refuses a slab that does not start at zero', () => {
    const gappy = [{ fromAmount: D(500_000), toAmount: null, ratePct: D(2), fixedAmount: null }];
    expect(() => orderedBands(gappy)).toThrow(/must start at 0/);
  });

  it('pays a flat fee per booking when the basis says so', () => {
    const flat = [
      { fromAmount: D(0), toAmount: D(1_000_000), ratePct: null, fixedAmount: D(5_000) },
      { fromAmount: D(1_000_000), toAmount: null, ratePct: null, fixedAmount: D(12_000) },
    ];
    expect(applySlab({ base: D(2_400_000), mode: 'FLAT', basis: 'FIXED', bands: flat }).amount.toString()).toBe(
      '12000',
    );
    expect(applySlab({ base: D(900_000), mode: 'FLAT', basis: 'FIXED', bands: flat }).amount.toString()).toBe('5000');
  });
});

// ── Proration ────────────────────────────────────────────────────────────────
describe('proration between agents', () => {
  it('splits evenly and still sums to the whole', () => {
    const parts = splitAmount(D(85_000), [
      { userId: 'a', sharePct: D(50) },
      { userId: 'b', sharePct: D(50) },
    ]);
    expect(parts.map((p) => p.amount.toString())).toEqual(['42500', '42500']);
  });

  it('gives the rounding remainder to the largest share rather than losing it', () => {
    // Three ways on 100.00 is 33.333…; two parts round down and one takes the
    // extra cent, so the parts still add to the whole.
    const parts = splitAmount(D(100), [
      { userId: 'a', sharePct: D('33.34') },
      { userId: 'b', sharePct: D('33.33') },
      { userId: 'c', sharePct: D('33.33') },
    ]);
    const summed = parts.reduce((s, p) => s.plus(p.amount), D(0));
    expect(summed.toString()).toBe('100');
  });

  it('refuses a split that does not add up to 100', () => {
    // 33/33/33 quietly pays out 99% of what the agency owes, and the missing
    // percent is somebody's money nobody notices for a year.
    expect(() =>
      splitAmount(D(100), [
        { userId: 'a', sharePct: D(33) },
        { userId: 'b', sharePct: D(33) },
        { userId: 'c', sharePct: D(33) },
      ]),
    ).toThrow(/not 100%/);
  });

  it('refuses a split with nobody in it', () => {
    expect(() => splitAmount(D(100), [])).toThrow(SlabError);
  });
});

// ── The ledger ───────────────────────────────────────────────────────────────
describe('the commission lifecycle', () => {
  async function slab(over: Record<string, unknown> = {}) {
    const created = await prisma.commissionSlab.create({
      data: {
        tenantId: fixture.a.tenantId,
        name: 'Test slab',
        mode: 'PROGRESSIVE',
        basis: 'PERCENT_OF_SALE',
        effectiveFrom: new Date(Date.now() - 86_400_000),
        approvedById: finance.actor.id,
        approvedAt: new Date(),
        ...over,
      },
    });
    for (const [i, b] of TIERS.entries()) {
      await prisma.commissionSlabBand.create({
        data: {
          tenantId: fixture.a.tenantId,
          slabId: created.id,
          fromAmount: b.fromAmount,
          toAmount: b.toAmount,
          ratePct: b.ratePct,
          position: i,
        },
      });
    }
    return created;
  }

  async function booking(over: Record<string, unknown> = {}) {
    return prisma.booking.create({
      data: {
        tenantId: fixture.a.tenantId,
        reference: `BK-${Math.random().toString(36).slice(2, 10)}`,
        leadId: fixture.a.leadIds[0],
        projectId,
        ownerId: agent.actor.id,
        status: 'CONFIRMED',
        saleValue: D(3_500_000),
        bookingDate: new Date(),
        ...over,
      },
    });
  }

  it('permits only one forward step at a time', () => {
    expect(canTransition('ACCRUED', 'CONFIRMED')).toBe(true);
    expect(canTransition('CONFIRMED', 'COLLECTED')).toBe(true);
    expect(canTransition('COLLECTED', 'PAID')).toBe(true);

    // Money does not skip stages: each one is a decision or a bank transfer.
    expect(canTransition('ACCRUED', 'PAID')).toBe(false);
    expect(canTransition('ACCRUED', 'COLLECTED')).toBe(false);
    expect(canTransition('PAID', 'COLLECTED')).toBe(false);
    expect(canTransition('CLAWED_BACK', 'ACCRUED')).toBe(false);
  });

  it('refuses to accrue when no signed-off slab covers the booking', async () => {
    // The module's contract with the spec: until finance has approved the
    // rules, nothing accrues, and the message says so rather than paying zero.
    const b = await booking();
    await expect(accrueCommission({ ctx: finance, bookingId: b.id })).rejects.toMatchObject({
      status: 422,
      errors: [expect.objectContaining({ code: 'no_signed_slab' })],
    });
  });

  it('ignores a slab nobody has signed', async () => {
    await slab({ approvedById: null, approvedAt: null });
    const b = await booking();
    await expect(accrueCommission({ ctx: finance, bookingId: b.id })).rejects.toMatchObject({ status: 422 });
  });

  it('accrues, and freezes the rule that produced the number', async () => {
    const s = await slab();
    const b = await booking();

    const { commissions, gross } = await accrueCommission({ ctx: finance, bookingId: b.id });
    expect(gross.toString()).toBe('85000');
    expect(commissions).toHaveLength(1);

    const row = commissions[0];
    expect(row.slabVersion).toBe(s.version);
    expect(row.slabMode).toBe('PROGRESSIVE');
    expect(row.effectiveRatePct?.toString()).toBe('2.43');
    expect((row.calculation as { bands: unknown[] }).bands).toHaveLength(3);

    // Now finance changes the rates. February must not be restated.
    await prisma.commissionSlabBand.updateMany({
      where: { tenantId: fixture.a.tenantId, slabId: s.id },
      data: { ratePct: D(10) },
    });
    const after = await prisma.commission.findFirstOrThrow({
      where: { id: row.id, tenantId: fixture.a.tenantId },
    });
    expect(after.amount.toString()).toBe('85000');
    expect(after.effectiveRatePct?.toString()).toBe('2.43');
  });

  it('splits an accrual between agents', async () => {
    await slab();
    const b = await booking();
    const { commissions } = await accrueCommission({
      ctx: finance,
      bookingId: b.id,
      splits: [
        { userId: 'agent-one', sharePct: 60 },
        { userId: 'agent-two', sharePct: 40 },
      ],
    });

    expect(commissions.map((c) => c.amount.toString()).sort()).toEqual(['34000', '51000']);
    const summed = commissions.reduce((s, c) => s.plus(c.amount), D(0));
    expect(summed.toString()).toBe('85000');
  });

  it('will not accrue twice on one booking', async () => {
    await slab();
    const b = await booking();
    await accrueCommission({ ctx: finance, bookingId: b.id });
    await expect(accrueCommission({ ctx: finance, bookingId: b.id })).rejects.toMatchObject({ status: 409 });
  });

  it('will not accrue against a booking that is not confirmed', async () => {
    await slab();
    const b = await booking({ status: 'DRAFT' });
    await expect(accrueCommission({ ctx: finance, bookingId: b.id })).rejects.toMatchObject({ status: 409 });
  });

  it('refuses to collect before the client has actually paid', async () => {
    await slab();
    const b = await booking();
    const { commissions } = await accrueCommission({ ctx: finance, bookingId: b.id });
    const id = commissions[0].id;

    await transitionCommission({ ctx: finance, commissionId: id, to: 'CONFIRMED' });
    // Without this gate the ledger shows cash the business does not have.
    await expect(transitionCommission({ ctx: finance, commissionId: id, to: 'COLLECTED' })).rejects.toMatchObject({
      status: 422,
      errors: [expect.objectContaining({ code: 'not_collected' })],
    });

    await prisma.booking.update({
      where: { id: b.id, tenantId: fixture.a.tenantId },
      data: { collectedAt: new Date() },
    });
    const collected = await transitionCommission({ ctx: finance, commissionId: id, to: 'COLLECTED' });
    expect(collected.commission.status).toBe('COLLECTED');
  });

  it('refuses an illegal jump through the service', async () => {
    await slab();
    const b = await booking();
    const { commissions } = await accrueCommission({ ctx: finance, bookingId: b.id });
    await expect(
      transitionCommission({ ctx: finance, commissionId: commissions[0].id, to: 'PAID' }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('will not let somebody without approval confirm a commission', async () => {
    await slab();
    const b = await booking();
    const { commissions } = await accrueCommission({ ctx: finance, bookingId: b.id });
    await expect(
      transitionCommission({ ctx: agent, commissionId: commissions[0].id, to: 'CONFIRMED' }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

// ── Clawback ─────────────────────────────────────────────────────────────────
describe('clawback', () => {
  async function accrued() {
    const s = await prisma.commissionSlab.create({
      data: {
        tenantId: fixture.a.tenantId,
        name: 'Clawback slab',
        mode: 'FLAT',
        basis: 'PERCENT_OF_SALE',
        effectiveFrom: new Date(Date.now() - 86_400_000),
        approvedById: finance.actor.id,
        approvedAt: new Date(),
      },
    });
    await prisma.commissionSlabBand.create({
      data: { tenantId: fixture.a.tenantId, slabId: s.id, fromAmount: D(0), toAmount: null, ratePct: D(2) },
    });
    const b = await prisma.booking.create({
      data: {
        tenantId: fixture.a.tenantId,
        reference: `BK-${Math.random().toString(36).slice(2, 10)}`,
        leadId: fixture.a.leadIds[0],
        projectId,
        ownerId: agent.actor.id,
        status: 'CONFIRMED',
        saleValue: D(1_000_000),
        bookingDate: new Date(),
      },
    });
    const { commissions } = await accrueCommission({ ctx: finance, bookingId: b.id });
    return { booking: b, commission: commissions[0] };
  }

  it('reverses with a negative row and leaves the original untouched', async () => {
    const { booking: b, commission } = await accrued();
    expect(commission.amount.toString()).toBe('20000');

    const { reversals } = await clawback({ ctx: finance, bookingId: b.id, reason: 'Client withdrew before transfer' });
    expect(reversals).toHaveLength(1);
    expect(reversals[0].amount.toString()).toBe('-20000');
    expect(reversals[0].reversesId).toBe(commission.id);

    // The original is evidence: somebody was told they had earned it.
    const original = await prisma.commission.findFirstOrThrow({
      where: { id: commission.id, tenantId: fixture.a.tenantId },
    });
    expect(original.amount.toString()).toBe('20000');
    expect(original.status).toBe('ACCRUED');

    // And the ledger nets to nothing.
    const net = (await prisma.commission.findMany({ where: { tenantId: fixture.a.tenantId, bookingId: b.id } })).reduce(
      (s, c) => s.plus(c.amount),
      D(0),
    );
    expect(net.toString()).toBe('0');
  });

  it('reverses a commission that has already been paid', async () => {
    const { booking: b, commission } = await accrued();
    await prisma.commission.update({
      where: { id: commission.id, tenantId: fixture.a.tenantId },
      data: { status: 'PAID', paidAt: new Date() },
    });

    // The money left the business. Pretending otherwise leaves it short with no
    // record of why.
    const { reversals } = await clawback({ ctx: finance, bookingId: b.id, reason: 'Sale rescinded after payout' });
    expect(reversals[0].amount.toString()).toBe('-20000');
  });

  it('will not reverse the same commission twice', async () => {
    const { booking: b } = await accrued();
    await clawback({ ctx: finance, bookingId: b.id, reason: 'First reversal' });
    await expect(clawback({ ctx: finance, bookingId: b.id, reason: 'Second reversal' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('demands a reason, and refuses without the approval permission', async () => {
    const { booking: b } = await accrued();
    await expect(clawback({ ctx: finance, bookingId: b.id, reason: 'no' })).rejects.toMatchObject({ status: 422 });
    await expect(clawback({ ctx: agent, bookingId: b.id, reason: 'Sale fell through' })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('ties every amount back to its booking in the reconciliation', async () => {
    const { booking: b } = await accrued();
    await clawback({ ctx: finance, bookingId: b.id, reason: 'Client withdrew' });

    const report = await reconciliation(
      fixture.a.tenantId,
      new Date(Date.now() - 86_400_000),
      new Date(Date.now() + 86_400_000),
    );
    expect(report.lines).toHaveLength(2);
    expect(report.lines.every((l) => l.bookingReference === b.reference)).toBe(true);
    // Built from the rows, so it cannot agree with a total that has drifted.
    expect(report.totals.net.toString()).toBe('0');
  });

  it('never reaches another workspace ledger', async () => {
    await accrued();
    const report = await reconciliation(
      fixture.b.tenantId,
      new Date(Date.now() - 86_400_000),
      new Date(Date.now() + 86_400_000),
    );
    expect(report.lines).toHaveLength(0);
  });
});
