import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { SALES_OR_REALTY } from '@/lib/security/entitlements';
import { prisma, withTx } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import { assertRecordVisible } from '@/lib/security/visibility';
import { coverage } from '@/services/money/collections';
import Badge from '@/components/ui/Badge';
import ListHeader from '@/components/workspace/ListHeader';
import SalesLink from '@/components/workspace/SalesLink';
import ReceiptPanel from './ReceiptPanel';
import FeeAmendmentPanel from './FeeAmendmentPanel';

export const metadata = { title: 'Collections' };

const money = (amount: { toString(): string } | null | undefined, currency: string) =>
  amount == null
    ? '—'
    : `${currency} ${Number(amount.toString()).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const REASON: Record<string, string> = {
  covered: 'Commission may be collected and paid out',
  short: 'Not yet covered — commission cannot be paid',
  agency_fee_unset: 'No agreed agency fee recorded — nothing can be measured',
  currency_mismatch: 'A receipt is in another currency — no conversion policy exists',
};

/**
 * One sale's money, in full: the fee due, every receipt with who recorded and
 * who verified it, the amendments to the fee, the cases open on it, and the
 * audit trail behind all of it. Every action here goes through the same API
 * routes and the same server-side permission checks as any other client.
 */
export default async function CollectionsBookingPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const ctx = await requirePageAccess({ module: SALES_OR_REALTY, permission: ['collections', 'VIEW'] });

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, tenantId: ctx.tenantId, deletedAt: null },
    select: {
      id: true,
      tenantId: true,
      reference: true,
      status: true,
      currency: true,
      saleValue: true,
      agencyFee: true,
      collectedAt: true,
      bookingDate: true,
      ownerId: true,
    },
  });
  if (!booking) notFound();
  await assertRecordVisible(ctx, 'bookings', booking, prisma, 'VIEW');
  await assertRecordVisible(ctx, 'collections', booking, prisma, 'VIEW');

  const [c, receipts, amendments, cases, commissions] = await withTx(ctx.tenantId, async (tx) => [
    await coverage(tx, ctx.tenantId, booking.id),
    await tx.agencyFeeReceipt.findMany({
      where: { tenantId: ctx.tenantId, bookingId: booking.id },
      orderBy: { createdAt: 'asc' },
    }),
    await tx.agencyFeeAmendment.findMany({
      where: { tenantId: ctx.tenantId, bookingId: booking.id },
      orderBy: { createdAt: 'desc' },
    }),
    await tx.collectionRecoveryCase.findMany({
      where: { tenantId: ctx.tenantId, bookingId: booking.id },
      orderBy: { createdAt: 'desc' },
    }),
    await tx.commission.findMany({
      where: { tenantId: ctx.tenantId, bookingId: booking.id },
      select: { id: true, userId: true, status: true, amount: true, currency: true, slabBasis: true, payoutId: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const ids = [
    ...receipts.map((r) => r.id),
    ...amendments.map((a) => a.id),
    ...cases.map((k) => k.id),
    ...commissions.map((m) => m.id),
    booking.id,
  ];
  const history = await prisma.auditLog.findMany({
    where: {
      tenantId: ctx.tenantId,
      recordId: { in: ids },
      objectType: { in: ['collections', 'agencyfee', 'collection_recovery', 'commissions', 'bookings'] },
    },
    orderBy: { occurredAt: 'desc' },
    take: 60,
    select: {
      id: true,
      event: true,
      objectType: true,
      recordId: true,
      actorUserId: true,
      occurredAt: true,
      newValue: true,
    },
  });
  const people = await prisma.user.findMany({
    where: {
      tenantId: ctx.tenantId,
      id: {
        in: [
          ...new Set(
            [
              ...history.map((h) => h.actorUserId),
              ...receipts.flatMap((r) => [r.recordedById, r.verifiedById, r.rejectedById]),
              ...amendments.flatMap((a) => [a.proposedById, a.decidedById]),
            ].filter((x): x is string => !!x),
          ),
        ],
      },
    },
    select: { id: true, fullName: true },
  });
  const name = (id: string | null) => (id ? (people.find((p) => p.id === id)?.fullName ?? id) : '—');

  const outstanding = c.due === null ? null : c.due.minus(c.verified);
  const perms = {
    canRecord: can(ctx, 'collections', 'CREATE'),
    canApprove: can(ctx, 'collections', 'APPROVE'),
    canProposeFee: can(ctx, 'agencyfee', 'CREATE'),
    canApproveFee: can(ctx, 'agencyfee', 'APPROVE'),
    userId: ctx.actor.id,
  };

  return (
    <div className="lf-stack">
      <ListHeader
        title={`Collections · ${booking.reference}`}
        eyebrow="Agency fee"
        description={REASON[c.reason]}
        actions={
          <SalesLink href="/collections" className="lf-btn lf-btn--secondary">
            All sales
          </SalesLink>
        }
      />

      <div className="lf-kpi-grid" data-testid="coverage">
        <div className="lf-kpi">
          <span>Agreed fee</span>
          <strong data-testid="kpi-due">{money(c.due, c.currency)}</strong>
        </div>
        <div className="lf-kpi">
          <span>Net verified receipts</span>
          <strong data-testid="kpi-verified">{money(c.verified, c.currency)}</strong>
        </div>
        <div className="lf-kpi">
          <span>Pending verification</span>
          <strong data-testid="kpi-pending">{money(c.pending, c.currency)}</strong>
        </div>
        <div className="lf-kpi">
          <span>Outstanding</span>
          <strong data-testid="kpi-outstanding">
            {outstanding === null ? '—' : money(outstanding.lt(0) ? 0 : outstanding, c.currency)}
          </strong>
        </div>
        <div className="lf-kpi">
          <span>Payout eligibility</span>
          <strong data-testid="kpi-eligibility">
            <Badge tone={c.covered ? 'viridian' : 'brass'}>{c.covered ? 'Eligible' : 'Blocked'}</Badge>
          </strong>
        </div>
      </div>

      {booking.collectedAt && c.verified.isZero() ? (
        <div className="lf-card" role="note" data-testid="legacy-notice">
          <strong>Legacy “collected” mark.</strong> This sale was marked collected on{' '}
          {booking.collectedAt.toISOString().slice(0, 10)} by a button press under the previous rules. That is not
          verified money and no longer unlocks anything. Record the actual receipt below and have it verified.
        </div>
      ) : null}

      <ReceiptPanel
        bookingId={booking.id}
        currency={booking.currency}
        receipts={receipts.map((r) => ({
          id: r.id,
          reference: r.reference,
          kind: r.kind,
          status: r.status,
          amount: r.amount.toString(),
          currency: r.currency,
          paidAt: r.paidAt.toISOString(),
          paymentReference: r.paymentReference,
          providerTransactionRef: r.providerTransactionRef,
          evidenceDocumentId: r.evidenceDocumentId,
          reason: r.reason,
          reversesId: r.reversesId,
          recordedBy: name(r.recordedById),
          recordedById: r.recordedById,
          recordedAt: r.recordedAt.toISOString(),
          verifiedBy: name(r.verifiedById),
          verifiedAt: r.verifiedAt?.toISOString() ?? null,
          rejectedBy: name(r.rejectedById),
          rejectedAt: r.rejectedAt?.toISOString() ?? null,
        }))}
        perms={perms}
      />

      <FeeAmendmentPanel
        bookingId={booking.id}
        currency={booking.currency}
        currentFee={booking.agencyFee?.toString() ?? null}
        bookingStatus={booking.status}
        amendments={amendments.map((a) => ({
          id: a.id,
          reference: a.reference,
          status: a.status,
          previousFee: a.previousFee?.toString() ?? null,
          proposedFee: a.proposedFee.toString(),
          reason: a.reason,
          agreementReference: a.agreementReference,
          proposedBy: name(a.proposedById),
          proposedById: a.proposedById,
          proposedAt: a.proposedAt.toISOString(),
          decidedBy: name(a.decidedById),
          decidedAt: a.decidedAt?.toISOString() ?? null,
          decisionNote: a.decisionNote,
          preview: a.preview as Record<string, unknown>,
        }))}
        perms={perms}
      />

      <section className="lf-card">
        <h2>Commission on this sale</h2>
        {commissions.length === 0 ? (
          <p>Nothing has accrued.</p>
        ) : (
          <div className="lf-table-wrap">
            <table className="lf-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Basis</th>
                  <th>Payout</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((m) => (
                  <tr key={m.id}>
                    <td>{name(m.userId)}</td>
                    <td>
                      <Badge
                        tone={m.status === 'PAID' ? 'viridian' : m.status === 'CLAWED_BACK' ? 'vermillion' : 'brass'}
                      >
                        {m.status}
                      </Badge>
                    </td>
                    <td>{money(m.amount, m.currency)}</td>
                    <td>{m.slabBasis ?? '—'}</td>
                    <td>{m.payoutId ? 'In a run' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {cases.length > 0 ? (
        <section className="lf-card" data-testid="cases">
          <h2>Recovery and adjustment cases</h2>
          <ul>
            {cases.map((k) => (
              <li key={k.id}>
                <Badge tone={k.status === 'RESOLVED' ? 'viridian' : 'vermillion'}>{k.status.replace('_', ' ')}</Badge>{' '}
                {k.kind.replace('_', ' ').toLowerCase()} ·{' '}
                {k.shortfall
                  ? `shortfall ${money(k.shortfall, k.currency)}`
                  : k.adjustment
                    ? `adjustment ${money(k.adjustment, k.currency)}`
                    : ''}{' '}
                · {k.reason} <SalesLink href="/collections/recovery">open</SalesLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="lf-card" data-testid="history">
        <h2>History</h2>
        {history.length === 0 ? (
          <p>Nothing yet.</p>
        ) : (
          <div className="lf-table-wrap">
            <table className="lf-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.occurredAt.toISOString().replace('T', ' ').slice(0, 16)}</td>
                    <td>{name(h.actorUserId)}</td>
                    <td>
                      {h.objectType} · {h.event.toLowerCase().replace('_', ' ')}
                    </td>
                    <td>
                      <code style={{ fontSize: '0.8em' }}>{JSON.stringify(h.newValue ?? {}).slice(0, 160)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
