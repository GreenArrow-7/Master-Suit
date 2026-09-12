import { requirePageAccess } from '@/lib/workspace-page';
import { prisma, withTx } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import { coverage } from '@/services/money/collections';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Collections' };

const money = (amount: { toString(): string } | null | undefined, currency: string) =>
  amount == null
    ? '—'
    : `${currency} ${Number(amount.toString()).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const REASON: Record<string, string> = {
  covered: 'Eligible',
  short: 'Outstanding',
  agency_fee_unset: 'No agreed fee',
  currency_mismatch: 'Currency mismatch',
};
const TONE: Record<string, 'viridian' | 'brass' | 'vermillion' | 'slate'> = {
  covered: 'viridian',
  short: 'brass',
  agency_fee_unset: 'vermillion',
  currency_mismatch: 'vermillion',
};

/**
 * Money against sales.
 *
 * One row per confirmed booking: what the agency is owed, what has been
 * verified as received, what is still outstanding, and whether commission on
 * it may be paid. The legacy column names bookings that were once marked
 * "collected" by a button press and have no verified receipt to show for it.
 */
export default async function CollectionsPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['collections', 'VIEW'] });
  const scope = await visibilityWhere(ctx, 'bookings', 'VIEW');

  const bookings = await prisma.booking.findMany({
    where: { ...scope, deletedAt: null, status: 'CONFIRMED' },
    orderBy: { bookingDate: 'desc' },
    take: 100,
    select: {
      id: true,
      reference: true,
      currency: true,
      agencyFee: true,
      collectedAt: true,
      bookingDate: true,
      ownerId: true,
    },
  });
  const rows = await withTx(ctx.tenantId, async (tx) => {
    const out = [];
    for (const b of bookings) {
      const c = await coverage(tx, ctx.tenantId, b.id);
      const openCases = await tx.collectionRecoveryCase.count({
        where: { tenantId: ctx.tenantId, bookingId: b.id, status: { not: 'RESOLVED' } },
      });
      const pendingAmendment = await tx.agencyFeeAmendment.count({
        where: { tenantId: ctx.tenantId, bookingId: b.id, status: 'PENDING' },
      });
      out.push({ ...b, c, openCases, pendingAmendment, legacy: b.collectedAt !== null && c.verified.isZero() });
    }
    return out;
  });
  const openCasesTotal = await prisma.collectionRecoveryCase.count({
    where: { tenantId: ctx.tenantId, status: { not: 'RESOLVED' } },
  });

  return (
    <div className="lf-stack">
      <ListHeader
        title="Collections"
        count={rows.length}
        noun="confirmed sale"
        capped={rows.length === 100}
        description="Agency-fee money against each confirmed sale. Commission is payable only when verified receipts cover the agreed fee in full."
        actions={
          can(ctx, 'collections', 'VIEW') ? (
            <SalesLink href="/collections/recovery" className="lf-btn lf-btn--secondary">
              Recovery cases{openCasesTotal > 0 ? ` (${openCasesTotal})` : ''}
            </SalesLink>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="No confirmed sales yet" />
      ) : (
        <div className="lf-table-wrap">
          <table className="lf-table" data-testid="collections-table">
            <thead>
              <tr>
                <th>Sale</th>
                <th>Agreed fee</th>
                <th>Verified</th>
                <th>Pending</th>
                <th>Outstanding</th>
                <th>Eligibility</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const outstanding = r.c.due === null ? null : r.c.due.minus(r.c.verified);
                return (
                  <tr key={r.id}>
                    <td>
                      <SalesLink href={`/collections/${r.id}`}>
                        <strong>{r.reference}</strong>
                      </SalesLink>
                      <span>{r.bookingDate.toISOString().slice(0, 10)}</span>
                    </td>
                    <td>{money(r.agencyFee, r.currency)}</td>
                    <td>{money(r.c.verified, r.currency)}</td>
                    <td>{money(r.c.pending, r.currency)}</td>
                    <td>{outstanding === null ? '—' : money(outstanding.lt(0) ? 0 : outstanding, r.currency)}</td>
                    <td>
                      <Badge tone={TONE[r.c.reason]}>{REASON[r.c.reason]}</Badge>
                    </td>
                    <td>
                      {r.legacy ? <Badge tone="vermillion">Legacy “collected”, no receipt</Badge> : null}{' '}
                      {r.pendingAmendment > 0 ? <Badge tone="brass">Fee amendment pending</Badge> : null}{' '}
                      {r.openCases > 0 ? (
                        <Badge tone="wine">
                          {r.openCases} open case{r.openCases === 1 ? '' : 's'}
                        </Badge>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
