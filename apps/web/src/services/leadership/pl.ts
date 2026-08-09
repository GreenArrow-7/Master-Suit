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
      status: { not: 'CANCELLED' },
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

  const payroll = await payrollByGroup(tenantId, userIds, from, to, grouping, currency, caveats);
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
    [...buckets.keys()].filter((k): k is string => k !== null),
  );
  for (const row of buckets.values()) {
    if (row.key) row.name = names.get(row.key) ?? 'Removed';
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

  return { from, to, grouping, currency, rows, totals, caveats };
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
async function payrollByGroup(
  tenantId: string,
  userIds: string[],
  from: Date,
  to: Date,
  grouping: Grouping,
  currency: string,
  caveats: string[],
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
      run: { is: { periodStart: { gte: from }, periodEnd: { lte: to } } },
    },
    select: {
      grossEarnings: true,
      employee: {
        select: {
          membership: {
            select: {
              salesUser: {
                select: { id: true, branchId: true, regionId: true, teams: { select: { teamId: true }, take: 1 } },
              },
            },
          },
        },
      },
    },
  });

  if (payslips.length === 0) {
    caveats.push('No payroll was run for this period, so margin is not calculated.');
    return new Map();
  }

  const byGroup = new Map<string | null, Prisma.Decimal>();
  let unlinked = 0;

  for (const slip of payslips) {
    const user = slip.employee.membership?.salesUser;
    if (!user) {
      unlinked += 1;
      continue;
    }
    // A leader's report covers their own people, so somebody else's payroll is
    // not a cost they are being measured on.
    if (userIds.length > 0 && !userIds.includes(user.id)) continue;

    const key =
      grouping === 'team' ? (user.teams[0]?.teamId ?? null) : grouping === 'region' ? user.regionId : user.branchId;
    byGroup.set(key, (byGroup.get(key) ?? ZERO).plus(slip.grossEarnings));
  }

  if (unlinked > 0) {
    caveats.push(
      `${unlinked} payslip${unlinked === 1 ? '' : 's'} belong to staff with no sales record and are excluded.`,
    );
  }
  // Payroll carries no currency column of its own; saying so is cheaper than a
  // silently wrong subtraction.
  caveats.push(`Payroll is assumed to be in ${currency}.`);

  return byGroup;
}
