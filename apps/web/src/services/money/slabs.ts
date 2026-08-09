/**
 * Applying a commission slab.
 *
 * Pure arithmetic on Decimals, with no database and no rates of its own. Every
 * number it uses comes from rows finance entered — the spec requires the slab
 * rules to be signed off before code is written, and the way to honour that is
 * to write code that contains none of them.
 *
 * The two modes are genuinely different products and both exist in this market:
 *
 *   PROGRESSIVE — each band applies to the portion of the sale inside it, the
 *                 way income tax works. A 3.5M sale under 0–1M@2%, 1–3M@2.5%,
 *                 3M+@3% earns 20 000 + 50 000 + 15 000.
 *   FLAT        — the whole sale takes the rate of the band it lands in. The
 *                 same 3.5M sale earns 105 000.
 *
 * Which one a workspace uses is a column, not an assumption, because getting it
 * wrong is a 40% error in somebody's pay.
 */
import { Prisma } from '@prisma/client';

export type SlabMode = 'PROGRESSIVE' | 'FLAT';
export type SlabBasis = 'PERCENT_OF_SALE' | 'PERCENT_OF_AGENCY_FEE' | 'FIXED';

export interface Band {
  fromAmount: Prisma.Decimal;
  toAmount: Prisma.Decimal | null;
  ratePct: Prisma.Decimal | null;
  fixedAmount: Prisma.Decimal | null;
}

export interface BandContribution {
  from: string;
  to: string | null;
  /** How much of the base fell in this band. */
  portion: string;
  ratePct: string | null;
  amount: string;
}

export interface SlabResult {
  /** Gross, before any split between agents. */
  amount: Prisma.Decimal;
  /** `amount / base × 100`, for a statement a human can check at a glance. */
  effectiveRatePct: Prisma.Decimal;
  /** Which bands contributed what — the audit trail for the arithmetic. */
  breakdown: BandContribution[];
}

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/** Money rounds to two places. Half-up, because that is what a payslip does. */
const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export class SlabError extends Error {}

/**
 * Bands in order, with the gaps and overlaps that would silently mis-pay
 * somebody rejected rather than tolerated.
 *
 * A gap means a sale in that range earns nothing and nobody is told. An overlap
 * means two bands claim the same money and the answer depends on sort order.
 * Both are configuration mistakes, and both are cheaper to find here than on a
 * payslip.
 */
export function orderedBands(bands: Band[]): Band[] {
  if (bands.length === 0) throw new SlabError('This slab has no bands, so it cannot pay anything.');

  const sorted = [...bands].sort((a, b) => a.fromAmount.comparedTo(b.fromAmount));

  if (!sorted[0].fromAmount.isZero()) {
    throw new SlabError(`The first band starts at ${sorted[0].fromAmount}; it must start at 0.`);
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (current.toAmount === null) {
      throw new SlabError('An open-ended band must be the last one.');
    }
    if (!current.toAmount.equals(next.fromAmount)) {
      const gap = current.toAmount.lt(next.fromAmount);
      throw new SlabError(
        gap
          ? `Nothing covers ${current.toAmount}–${next.fromAmount}. A sale in that range would earn nothing.`
          : `Bands overlap between ${next.fromAmount} and ${current.toAmount}.`,
      );
    }
  }

  return sorted;
}

export interface ApplyInput {
  base: Prisma.Decimal;
  mode: SlabMode;
  basis: SlabBasis;
  bands: Band[];
}

export function applySlab(input: ApplyInput): SlabResult {
  const { base } = input;
  if (base.isNegative()) throw new SlabError('A commission cannot be computed on a negative amount.');

  const bands = orderedBands(input.bands);

  // FIXED ignores the size of the sale entirely: the band the sale lands in pays
  // its flat amount and that is the whole calculation.
  if (input.basis === 'FIXED') {
    const band = bandFor(bands, base);
    const amount = money(band.fixedAmount ?? ZERO);
    return {
      amount,
      effectiveRatePct: base.isZero() ? ZERO : money(amount.div(base).times(HUNDRED)),
      breakdown: [
        {
          from: band.fromAmount.toString(),
          to: band.toAmount?.toString() ?? null,
          portion: base.toString(),
          ratePct: null,
          amount: amount.toString(),
        },
      ],
    };
  }

  if (input.mode === 'FLAT') {
    const band = bandFor(bands, base);
    const rate = band.ratePct ?? ZERO;
    const amount = money(base.times(rate).div(HUNDRED));
    return {
      amount,
      effectiveRatePct: money(rate),
      breakdown: [
        {
          from: band.fromAmount.toString(),
          to: band.toAmount?.toString() ?? null,
          portion: base.toString(),
          ratePct: rate.toString(),
          amount: amount.toString(),
        },
      ],
    };
  }

  // PROGRESSIVE: walk the bands, taking the slice of the base that falls in each.
  let total = ZERO;
  const breakdown: BandContribution[] = [];

  for (const band of bands) {
    if (base.lte(band.fromAmount)) break;

    const ceiling = band.toAmount === null ? base : Prisma.Decimal.min(base, band.toAmount);
    const portion = ceiling.minus(band.fromAmount);
    if (portion.lte(ZERO)) continue;

    const rate = band.ratePct ?? ZERO;
    // Each band is rounded as it is added rather than at the end. A statement
    // that lists three lines has to sum to the total printed beneath it, and
    // rounding once at the end leaves it a fil out.
    const slice = money(portion.times(rate).div(HUNDRED));
    total = total.plus(slice);

    breakdown.push({
      from: band.fromAmount.toString(),
      to: band.toAmount?.toString() ?? null,
      portion: portion.toString(),
      ratePct: rate.toString(),
      amount: slice.toString(),
    });
  }

  const amount = money(total);
  return {
    amount,
    effectiveRatePct: base.isZero() ? ZERO : money(amount.div(base).times(HUNDRED)),
    breakdown,
  };
}

/**
 * The band a value lands in.
 *
 * Lower bound inclusive, upper exclusive — so a sale of exactly 1 000 000
 * against bands of 0–1M and 1M–3M belongs to the second. That boundary is the
 * single most argued-about line in a commission scheme and it is stated here
 * once rather than implied in three places.
 */
export function bandFor(bands: Band[], value: Prisma.Decimal): Band {
  for (const band of bands) {
    const aboveFloor = value.gte(band.fromAmount);
    const belowCeiling = band.toAmount === null || value.lt(band.toAmount);
    if (aboveFloor && belowCeiling) return band;
  }
  // Only reachable when the last band is closed and the value is above it,
  // which `orderedBands` permits: a scheme may deliberately cap.
  return bands[bands.length - 1];
}

/**
 * Splitting a commission between agents.
 *
 * Shares must total exactly 100. Not "about 100": a deal split 33/33/33 pays
 * out 99% of what the agency owes, and the missing percent is somebody's money
 * that nobody notices for a year.
 *
 * The rounding remainder goes to the largest share, which is the convention that
 * keeps the parts summing to the whole without anybody being systematically
 * short-changed.
 */
export function splitAmount(
  gross: Prisma.Decimal,
  shares: { userId: string; sharePct: Prisma.Decimal }[],
): { userId: string; sharePct: Prisma.Decimal; amount: Prisma.Decimal }[] {
  if (shares.length === 0) throw new SlabError('A commission needs at least one person to pay it to.');

  const total = shares.reduce((sum, s) => sum.plus(s.sharePct), ZERO);
  if (!total.equals(HUNDRED)) {
    throw new SlabError(`Shares total ${total}%, not 100%. A split that does not add up loses money.`);
  }

  const parts = shares.map((s) => ({
    userId: s.userId,
    sharePct: s.sharePct,
    amount: money(gross.times(s.sharePct).div(HUNDRED)),
  }));

  const allocated = parts.reduce((sum, p) => sum.plus(p.amount), ZERO);
  const remainder = gross.minus(allocated);

  if (!remainder.isZero()) {
    const largest = parts.reduce((a, b) => (a.sharePct.gte(b.sharePct) ? a : b));
    largest.amount = money(largest.amount.plus(remainder));
  }

  return parts;
}
