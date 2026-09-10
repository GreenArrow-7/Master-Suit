/**
 * Finding A — leadership P&L (`src/services/leadership/pl.ts`).
 *
 * Three questions from the review, each asserted as the behaviour a finance
 * reviewer would expect. A failure here is the evidence.
 *
 *   A1  Does a DRAFT booking count as agency revenue?
 *   A2  Does payroll aggregation include runs that should not be costed?
 *   A3  Does moving an employee between teams restate historical payroll?
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { profitAndLoss } from '@/services/leadership/pl';

const suffix = randomBytes(4).toString('hex');
const D = (n: number) => new Prisma.Decimal(n);
const RANGE = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') };

let tenantId = '';
let userId = '';
let employeeId = '';
let teamA = '';
let teamB = '';
let projectId = '';
let leadId = '';

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `diag-pl-${suffix}`, legalName: 'Diag PL LLC', displayName: 'Diag PL', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.createMany({
    data: [
      { tenantId, module: 'SALES', state: 'ACTIVE' },
      { tenantId, module: 'HRMS', state: 'ACTIVE' },
    ],
  });

  const role = await prisma.role.create({
    data: { tenantId, key: `diag-${suffix}`, name: 'Diag', rank: 50, defaultScope: 'ORGANIZATION' },
  });
  const user = await prisma.user.create({
    data: { tenantId, email: `agent-${suffix}@diag.test`, fullName: 'Agent', roleId: role.id, status: 'ACTIVE' },
  });
  userId = user.id;

  const platformUser = await prisma.platformUser.create({
    data: {
      email: `agent-${suffix}@diag.test`,
      normalizedEmail: `agent-${suffix}@diag.test`,
      fullName: 'Agent',
      status: 'ACTIVE',
    },
  });
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });

  const employee = await prisma.employeeProfile.create({
    data: {
      tenantId,
      membershipId: membership.id,
      employeeNumber: `E-${suffix}`,
      joinedOn: new Date('2026-01-01T00:00:00Z'),
    },
  });
  employeeId = employee.id;

  const [a, b] = await Promise.all([
    prisma.team.create({ data: { tenantId, name: 'Alpha', code: `A-${suffix}` } }),
    prisma.team.create({ data: { tenantId, name: 'Beta', code: `B-${suffix}` } }),
  ]);
  teamA = a.id;
  teamB = b.id;
  await prisma.userTeam.create({ data: { tenantId, userId, teamId: teamA } });

  const project = await prisma.project.create({ data: { tenantId, name: 'Diag project', code: `P-${suffix}` } });
  projectId = project.id;

  const stage = await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', position: 0, isDefault: true },
  });
  const lead = await prisma.lead.create({
    data: { tenantId, reference: `L-${suffix}`, fullName: 'Buyer', stageId: stage.id, ownerId: userId },
  });
  leadId = lead.id;
});

beforeEach(async () => {
  await prisma.booking.deleteMany({ where: { tenantId } });
  await prisma.hrPayslip.deleteMany({ where: { tenantId } });
  await prisma.hrPayrollRun.deleteMany({ where: { tenantId } });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: `agent-${suffix}@diag.test` } }).catch(() => {});
});

async function booking(status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED', agencyFee: number) {
  return prisma.booking.create({
    data: {
      tenantId,
      reference: `BK-${randomBytes(4).toString('hex')}`,
      leadId,
      projectId,
      ownerId: userId,
      // A confirmed booking carries the frozen placement; a draft never has one.
      teamId: status === 'DRAFT' ? null : teamA,
      status,
      saleValue: D(1_000_000),
      agencyFee: D(agencyFee),
      currency: 'AED',
      bookingDate: new Date('2026-08-10T00:00:00Z'),
    },
  });
}

async function payrollRun(status: 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED', gross: number) {
  const run = await prisma.hrPayrollRun.create({
    data: {
      tenantId,
      periodStart: new Date('2026-08-01T00:00:00Z'),
      periodEnd: new Date('2026-08-31T00:00:00Z'),
      status,
      currency: 'AED',
    },
  });
  await prisma.hrPayslip.create({
    data: {
      tenantId,
      runId: run.id,
      employeeId,
      basic: D(gross),
      grossEarnings: D(gross),
      totalDeductions: D(0),
      netPay: D(gross),
      currency: 'AED',
      inputs: {},
    },
  });
  return run;
}

describe('Finding A — what the P&L counts', () => {
  it('A1: a DRAFT booking is not agency revenue', async () => {
    await booking('DRAFT', 100_000);

    const report = await profitAndLoss(tenantId, [], RANGE.from, RANGE.to, 'team');

    // A draft is an unconfirmed intention. Counting its fee as revenue reports
    // business the agency has not won.
    expect(report.totals.agencyFee.toString()).toBe('0');
    expect(report.totals.bookings).toBe(0);
  });

  it('A1b: a CONFIRMED booking is agency revenue (control)', async () => {
    await booking('CONFIRMED', 100_000);

    const report = await profitAndLoss(tenantId, [], RANGE.from, RANGE.to, 'team');
    expect(report.totals.agencyFee.toString()).toBe('100000');
    expect(report.totals.bookings).toBe(1);
  });

  it('A2: a CANCELLED payroll run is not a cost', async () => {
    await booking('CONFIRMED', 100_000);
    await payrollRun('CANCELLED', 40_000);

    const report = await profitAndLoss(tenantId, [], RANGE.from, RANGE.to, 'team');

    // A cancelled run paid nobody. Costing it understates margin by its gross.
    expect(report.totals.payrollCost?.toString() ?? '0').toBe('0');
  });

  it('A2b: a DRAFT payroll run is not a cost', async () => {
    await booking('CONFIRMED', 100_000);
    await payrollRun('DRAFT', 40_000);

    const report = await profitAndLoss(tenantId, [], RANGE.from, RANGE.to, 'team');
    expect(report.totals.payrollCost?.toString() ?? '0').toBe('0');
  });

  it('A3: moving the employee to another team does not restate last month’s payroll', async () => {
    await booking('CONFIRMED', 100_000);
    await payrollRun('PAID', 40_000);

    const before = await profitAndLoss(tenantId, [], RANGE.from, RANGE.to, 'team');
    expect(before.rows.find((r) => r.key === teamA)?.payrollCost?.toString()).toBe('40000');

    // The person transfers. August's payroll was earned in Alpha and must stay
    // there — the same rule the frozen booking placement already follows.
    await prisma.userTeam.deleteMany({ where: { tenantId, userId } });
    await prisma.userTeam.create({ data: { tenantId, userId, teamId: teamB } });

    const after = await profitAndLoss(tenantId, [], RANGE.from, RANGE.to, 'team');
    expect(after.rows.find((r) => r.key === teamA)?.payrollCost?.toString()).toBe('40000');
    expect(after.rows.find((r) => r.key === teamB)?.payrollCost ?? null).toBeNull();
  });

  it('A4: the report separates contracted agency fee from money actually collected', async () => {
    const uncollected = await booking('CONFIRMED', 100_000);
    expect(uncollected.collectedAt).toBeNull();

    const report = await profitAndLoss(tenantId, [], RANGE.from, RANGE.to, 'team');

    // `agencyFee` is documented as "what the agency earned". With nothing
    // collected there should be a collected figure of its own, or a caveat
    // saying the revenue line is billed rather than banked.
    expect('agencyFeeCollected' in report.totals || report.caveats.some((c) => /collect/i.test(c))).toBe(true);
  });
});
