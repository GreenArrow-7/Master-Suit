import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Commissions' };

const TONE: Record<string, 'viridian' | 'brass' | 'vermillion' | 'slate'> = {
  ACCRUED: 'slate',
  CONFIRMED: 'brass',
  COLLECTED: 'brass',
  PAID: 'viridian',
  CLAWED_BACK: 'vermillion',
  DRAFT: 'slate',
  APPROVED: 'brass',
  CANCELLED: 'slate',
};

/** Money is never abbreviated on this page. A rounded commission is a dispute. */
const money = (amount: { toString(): string }, currency: string) =>
  `${currency} ${Number(amount.toString()).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The earnings ledger.
 *
 * Two views of the same money: what has been earned, and what has been paid out.
 * The stage a commission sits at is the whole story — accrued is a claim,
 * collected is the client's money in the bank, paid is out of the door — so it
 * is the column nearest the amount rather than a filter you have to apply.
 */
export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['commissions', 'VIEW'] });
  const view = params.view === 'payouts' ? 'payouts' : 'earnings';

  // Commissions and payouts are somebody's earnings, so they scope on userId
  // rather than the ownerId the rest of the CRM uses.
  const scope = await visibilityWhere(ctx, 'commissions', 'VIEW', { ownerField: 'userId' });

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [rows, payouts, recon] = await Promise.all([
    prisma.commission.findMany({
      where: scope,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        userId: true,
        status: true,
        baseAmount: true,
        effectiveRatePct: true,
        sharePct: true,
        amount: true,
        currency: true,
        slabVersion: true,
        slabMode: true,
        reversesId: true,
        paidAt: true,
        createdAt: true,
        booking: { select: { id: true, reference: true, saleValue: true, bookingDate: true } },
      },
    }),
    can(ctx, 'payouts', 'VIEW')
      ? prisma.payout.findMany({
          where: await visibilityWhere(ctx, 'payouts', 'VIEW', { ownerField: 'userId' }),
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            reference: true,
            userId: true,
            status: true,
            periodStart: true,
            periodEnd: true,
            totalAmount: true,
            currency: true,
            paidAt: true,
            paymentRef: true,
            _count: { select: { commissions: true } },
          },
        })
      : [],
    // Three numbers for the header, so grouping beats pulling every line.
    // The full reconciliation lives at /api/v1/commissions/reconciliation.
    prisma.commission.groupBy({
      by: ['status', 'currency'],
      where: { ...scope, createdAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
  ]);

  const currency = recon[0]?.currency ?? 'AED';
  const sum = (pick: (status: string) => boolean) =>
    recon.filter((r) => pick(r.status)).reduce((t, r) => t + Number(r._sum.amount?.toString() ?? 0), 0);
  const earned = sum((s) => s !== 'CLAWED_BACK');
  const reversed = sum((s) => s === 'CLAWED_BACK');
  const fmt = (n: number) =>
    currency + ' ' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <>
      <ListHeader
        title="Commissions"
        description={
          recon.length > 0 ? (
            <>
              This month: {fmt(earned)} earned
              {reversed !== 0 && <> · {fmt(reversed)} reversed</>} · {fmt(earned + reversed)} net
            </>
          ) : (
            <>
              {rows.length} line{rows.length === 1 ? '' : 's'}
            </>
          )
        }
        actions={
          can(ctx, 'commissionslabs', 'VIEW') && (
            <SalesLink className="lf-btn lf-btn--secondary lf-btn--sm" href="/commissions/slabs">
              Slab rules
            </SalesLink>
          )
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="View">
        <SalesLink className="lf-tab" href="/commissions" aria-selected={view === 'earnings'} role="tab">
          Earnings
        </SalesLink>
        <SalesLink className="lf-tab" href="/commissions?view=payouts" aria-selected={view === 'payouts'} role="tab">
          Payout runs
        </SalesLink>
      </nav>

      {view === 'payouts' ? (
        payouts.length === 0 ? (
          <div className="lf-card">
            <EmptyState
              title="No payout runs"
              description="A run gathers everything collected for a period into one payment. Nothing has been gathered yet."
            />
          </div>
        ) : (
          <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
            <table className="lf-grid">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Who</th>
                  <th>Period</th>
                  <th style={{ textAlign: 'right' }}>Lines</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th>Status</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.reference}</td>
                    <td>{p.userId}</td>
                    <td>
                      {p.periodStart.toLocaleDateString('en-GB', { dateStyle: 'medium' })} –{' '}
                      {p.periodEnd.toLocaleDateString('en-GB', { dateStyle: 'medium' })}
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {p._count.commissions}
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {/* A run that nets negative is somebody who owes money back. */}
                      <span
                        style={{
                          color: Number(p.totalAmount.toString()) < 0 ? 'var(--lf-vermillion)' : undefined,
                        }}
                      >
                        {money(p.totalAmount, p.currency)}
                      </span>
                    </td>
                    <td>
                      <Badge value={p.status} tone={TONE[p.status] ?? 'slate'} />
                    </td>
                    <td>
                      {p.paidAt ? (
                        <>
                          {p.paidAt.toLocaleDateString('en-GB', { dateStyle: 'medium' })}
                          {p.paymentRef && <span className="lf-hint"> · {p.paymentRef}</span>}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="Nothing earned yet"
            description="Commission accrues when a booking is confirmed against a signed slab. If no slab has been signed off, nothing accrues at all."
          />
        </div>
      ) : (
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th>Booking</th>
                <th>Who</th>
                <th style={{ textAlign: 'right' }}>Base</th>
                <th style={{ textAlign: 'right' }}>Rate</th>
                <th style={{ textAlign: 'right' }}>Share</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 500 }}>
                    {/* No bookings page yet, so the reference stays text rather
                        than a link into a 404. */}
                    {c.booking.reference}
                    {c.reversesId && (
                      <span className="lf-hint" style={{ marginLeft: 6 }}>
                        reversal
                      </span>
                    )}
                  </td>
                  <td>{c.userId}</td>
                  <td style={{ textAlign: 'right' }} className="lf-num">
                    {money(c.baseAmount, c.currency)}
                  </td>
                  <td style={{ textAlign: 'right' }} className="lf-num">
                    {/* The frozen rate, not today's. v2 of a slab does not restate
                        v1. A fixed-amount band has no rate at all. */}
                    {c.effectiveRatePct === null ? 'fixed' : `${Number(c.effectiveRatePct.toString()).toFixed(2)}%`}
                    <span className="lf-hint"> v{c.slabVersion}</span>
                  </td>
                  <td style={{ textAlign: 'right' }} className="lf-num">
                    {Number(c.sharePct.toString()).toFixed(2)}%
                  </td>
                  <td style={{ textAlign: 'right' }} className="lf-num">
                    <span style={{ color: Number(c.amount.toString()) < 0 ? 'var(--lf-vermillion)' : undefined }}>
                      {money(c.amount, c.currency)}
                    </span>
                  </td>
                  <td>
                    <Badge value={c.status} tone={TONE[c.status] ?? 'slate'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
