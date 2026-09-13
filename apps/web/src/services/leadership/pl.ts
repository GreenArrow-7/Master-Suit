/**
 * P&L by team and region.
 *
 * Three numbers, from three modules that already record them: what the agency
 * earned (M9 bookings), what it owes its agents (M9 commissions), and what it
 * pays its staff (HR payroll). Nothing here invents a figure.
 *
 * The grouping reads the placement **frozen onto the booking** at confirmation
 * rather than the agent's current team. A rollup that moves last quarter's
 * revenue when somebody transfers has restated a closed period, which is the
 * same failure the frozen commission slab exists to prevent.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { historicalPlacement, type Placement } from './placement';

const ZERO = new Prisma.Decimal(0);

export type Grouping = 'team' | 'region' | 'branch';

export interface PlRow {
  key: string | null;
  name: string;
  /** Gross merchandise value — what clients paid. Not revenue. */
  saleValue: Prisma.Decimal;
  /** What the agency earned. Falls back to nothing, never to a guess. */
  agencyFee: Prisma.Decimal;
  /** What the agency owes its agents, reversals already netted off. */
  commissionCost: Prisma.Decimal;
  /** Payroll for the same period, when HR is running. Null when it is not. */
  payrollCost: Prisma.Decimal | null;
  /** agencyFee − commission − payroll. Null whenever a component is unknown. */
  margin: Prisma.Decimal | null;
  bookings: number;
}

export interface PlReport {
  from: Date;
  to: Date;
  grouping: Grouping;
  currency: string;
  rows: PlRow[];
  totals: Omit<PlRow, 'key' | 'name'>;
  /**
   * What the report could not see. An unexplained margin is worse than a
   * missing one, so the gaps are named rather than rolled into a total.
   */
  caveats: string[];
  /** Payroll whose placement in its own period could not be established. Included in the totals. */
  historicalPlacementUnknown: { payslips: number; amount: Prisma.Decimal };
}

const FIELD: Record<Grouping, 'teamId' | 'regionId' | 'branchId'> = {
  team: 'teamId',
  region: 'regionId',
  branch: 'branchId',
};

/**
 * @param userIds restricts to a leader's subtree. Empty means the whole
 *                workspace, matching the rollups module.
 */
export async function profitAndLoss(
  tenantId: string,
  userIds: string[],
  from: Date,
  to: Date,
  grouping: Grouping = 'team',
): Promise<PlReport> {
  const field = FIELD[grouping];
  const owner = userIds.length === 0 ? {} : { ownerId: { in: userIds } };
  const caveats: string[] = [];

  const bookings = await prisma.booking.findMany({
    where: {
      tenantId,
      deletedAt: null,
      bookingDate: { gte: from, lte: to },
      // Revenue is confirmed sales. A draft is a sale somebody typed in; it
      // accrues nothing and belongs in no period's revenue until confirmed.
      status: 'CONFIRMED',
      ...owner,
    },
    select: {
      id: true,
      teamId: true,
      regionId: true,
      branchId: true,
      saleValue: true,
      agencyFee: true,
      currency: true,
      commissions: { select: { amount: true, currency: true } },
    },
  });

  // One currency per report. Adding dirhams to rupees produces a margin that
  // describes nothing, so the minority is excluded and said so out loud.
  const currencies = new Set(bookings.map((b) => b.currency));
  const currency = bookings[0]?.currency ?? 'AED';
  if (currencies.size > 1) {
    caveats.push(
      `Bookings in ${[...currencies].join(', ')} were found; only ${currency} is included. Run one report per currency.`,
    );
  }
  const inScope = bookings.filter((b) => b.currency === currency);

  const missingFee = inScope.filter((b) => b.agencyFee === null).length;
  if (missingFee > 0) {
    caveats.push(
      `${missingFee} booking${missingFee === 1 ? ' has' : 's have'} no agency fee recorded and contribute nothing to revenue.`,
    );
  }
  const unplaced = inScope.filter((b) => b[field] === null).length;
  if (unplaced > 0) {
    caveats.push(
      `${unplaced} booking${unplaced === 1 ? ' was' : 's were'} confirmed before placement was recorded and are grouped as unassigned.`,
    );
  }

  const buckets = new Map<string | null, PlRow>();
  const bucket = (key: string | null) => {
    let row = buckets.get(key);
    if (!row) {
      row = {
        key,
        name: key ?? 'Unassigned',
        saleValue: ZERO,
        agencyFee: ZERO,
        commissionCost: ZERO,
        payrollCost: null,
        margin: null,
        bookings: 0,
      };
      buckets.set(key, row);
    }
    return row;
  };

  for (const b of inScope) {
    const row = bucket(b[field]);
    row.saleValue = row.saleValue.plus(b.saleValue);
    row.agencyFee = row.agencyFee.plus(b.agencyFee ?? ZERO);
    row.bookings += 1;
    for (const c of b.commissions) {
      // Reversals are negative rows, so summing everything nets the clawbacks
      // off without a special case.
      if (c.currency === currency) row.commissionCost = row.commissionCost.plus(c.amount);
    }
  }

  const historicalPlacementUnknown = { payslips: 0, amount: ZERO };
  const payroll = await payrollByGroup(tenantId, userIds, from, to, grouping, caveats, historicalPlacementUnknown);
  for (const [key, cost] of payroll) bucket(key).payrollCost = cost;

  for (const row of buckets.values()) {
    // Null, not zero, when payroll is unknown: a margin that quietly omits the
    // largest cost line reads as profit that is not there.
    row.margin = row.payrollCost === null ? null : row.agencyFee.minus(row.commissionCost).minus(row.payrollCost);
  }

  // The buckets are keyed by id; a P&L listing cuids is not a P&L.
  const names = await groupNames(
    tenantId,
    grouping,
    [...buckets.keys()].filter((k): k is string => k !== null && k !== UNKNOWN_HISTORICAL),
  );
  for (const row of buckets.values()) {
    if (row.key === UNKNOWN_HISTORICAL) row.name = `Unknown historical ${grouping}`;
    else if (row.key) row.name = names.get(row.key) ?? 'Removed';
  }

  const rows = [...buckets.values()].sort((a, b) => Number(b.agencyFee.minus(a.agencyFee).toString()));

  const totals = rows.reduce<Omit<PlRow, 'key' | 'name'>>(
    (t, r) => ({
      saleValue: t.saleValue.plus(r.saleValue),
      agencyFee: t.agencyFee.plus(r.agencyFee),
      commissionCost: t.commissionCost.plus(r.commissionCost),
      payrollCost: r.payrollCost === null ? t.payrollCost : (t.payrollCost ?? ZERO).plus(r.payrollCost),
      margin: null,
      bookings: t.bookings + r.bookings,
    }),
    { saleValue: ZERO, agencyFee: ZERO, commissionCost: ZERO, payrollCost: null, margin: null, bookings: 0 },
  );
  totals.margin =
    totals.payrollCost === null ? null : totals.agencyFee.minus(totals.commissionCost).minus(totals.payrollCost);

  return { from, to, grouping, currency, rows, totals, caveats, historicalPlacementUnknown };
}

/** Ids to something a human can read. */
async function groupNames(tenantId: string, grouping: Grouping, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const where = { tenantId, id: { in: ids } };
  const select = { id: true, name: true };
  const rows =
    grouping === 'team'
      ? await prisma.team.findMany({ where, select })
      : grouping === 'region'
        ? await prisma.region.findMany({ where, select })
        : await prisma.branch.findMany({ where, select });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Payroll for the period, attributed to the group each person sits in now.
 *
 * Unlike revenue this is *not* frozen, because a payslip is already tied to the
 * period it paid for — the person was in that team when they were paid. Returns
 * an empty map when HR is not running here, which the caller reports as unknown
 * rather than as zero.
 */
/** The bucket for payroll whose team, branch or region in its period cannot be established. */
export const UNKNOWN_HISTORICAL = '__unknown_historical__';

async function payrollByGroup(
  tenantId: string,
  userIds: string[],
  from: Date,
  to: Date,
  grouping: Grouping,
  caveats: string[],
  unknown: { payslips: number; amount: Prisma.Decimal },
): Promise<Map<string | null, Prisma.Decimal>> {
  const entitled = await prisma.moduleEntitlement.findFirst({
    where: { tenantId, module: 'HRMS', state: { in: ['TRIAL', 'ACTIVE', 'GRACE'] } },
    select: { id: true },
  });
  if (!entitled) {
    caveats.push('Payroll is not available in this workspace, so margin is not calculated.');
    return new Map();
  }

  const payslips = await prisma.hrPayslip.findMany({
    where: {
      tenantId,
      // Cost is payroll that was approved to be paid. A draft or cancelled run
      // is a calculation, not money; counting it understated every margin.
      run: {
        is: { periodStart: { gte: from }, periodEnd: { lte: to }, status: { in: ['APPROVED', 'LOCKED', 'PAID'] } },
      },
    },
    select: {
      grossEarnings: true,
      teamIdSnapshot: true,
      branchIdSnapshot: true,
      regionIdSnapshot: true,
      run: { select: { periodStart: true } },
      employee: { select: { membership: { select: { salesUserId: true } } } },
    },
  });

  if (payslips.length === 0) {
    caveats.push('No payroll was run for this period, so margin is not calculated.');
    return new Map();
  }

  // Payslips without a snapshot — calculated before snapshots existed, or whose
  // placement could not be established when they were — are resolved from the
  // records that prove placement for their own period, and never from where
  // the person sits today. See placement.ts.
  const resolved = new Map<string, Map<string, Placement>>();
  for (const slip of payslips) {
    const uid = slip.employee.membership?.salesUserId;
    if (!uid) continue;
    const k = slip.run.periodStart.toISOString();
    if (!resolved.has(k)) resolved.set(k, new Map());
  }
  for (const k of resolved.keys()) {
    const ids = [
      ...new Set(
        payslips
          .filter((p) => p.run.periodStart.toISOString() === k)
          .map((p) => p.employee.membership?.salesUserId)
          .filter((x): x is string => !!x),
      ),
    ];
    resolved.set(k, await historicalPlacement(tenantId, ids, new Date(k)));
  }

  const field = grouping === 'team' ? 'teamId' : grouping === 'region' ? 'regionId' : 'branchId';
  const byGroup = new Map<string | null, Prisma.Decimal>();
  let unlinked = 0;

  for (const slip of payslips) {
    const uid = slip.employee.membership?.salesUserId;
    if (!uid) {
      // An employee with no Sales account has no team; in an organisation-wide
      // report their pay is still cost, so it lands in Unassigned rather than
      // falling out of the total.
      if (userIds.length > 0) continue;
      unlinked += 1;
      byGroup.set(null, (byGroup.get(null) ?? ZERO).plus(slip.grossEarnings));
      continue;
    }
    // A leader's report covers their own people, so somebody else's payroll is
    // not a cost they are being measured on.
    if (userIds.length > 0 && !userIds.includes(uid)) continue;

    const snapshot =
      grouping === 'team' ? slip.teamIdSnapshot : grouping === 'region' ? slip.regionIdSnapshot : slip.branchIdSnapshot;
    const key = snapshot ?? resolved.get(slip.run.periodStart.toISOString())?.get(uid)?.[field] ?? UNKNOWN_HISTORICAL;
    if (key === UNKNOWN_HISTORICAL) {
      unknown.payslips += 1;
      unknown.amount = unknown.amount.plus(slip.grossEarnings);
    }
    byGroup.set(key, (byGroup.get(key) ?? ZERO).plus(slip.grossEarnings));
  }

  if (unlinked > 0) {
    caveats.push(
      `${unlinked} payslip${unlinked === 1 ? '' : 's'} belong to employees with no Sales account and are grouped as unassigned.`,
    );
  }
  if (unknown.payslips > 0) {
    caveats.push(
      `${unknown.payslips} payslip${unknown.payslips === 1 ? '' : 's'} totalling ${unknown.amount.toFixed(2)} could not be placed in the ${grouping} the employee belonged to in that pay period, and ${unknown.payslips === 1 ? 'is' : 'are'} shown as "Unknown historical ${grouping}". The amount is still counted in the total.`,
    );
  }
  return byGroup;
}
