import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import SalesLink from '@/components/workspace/SalesLink';
import RecoveryCaseList from './RecoveryCaseList';

export const metadata = { title: 'Recovery cases' };

/**
 * Money that was paid out and then turned out to rest on less than it did.
 * Each case is a decision for a person: recover it (with evidence), or write
 * it off / accept the adjustment (with a second person's approval). Nothing
 * on this page moves money.
 */
export default async function RecoveryCasesPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['collections', 'VIEW'] });
  const booking = await visibilityWhere(ctx, 'collections', 'VIEW');
  const cases = await prisma.collectionRecoveryCase.findMany({
    where: { tenantId: ctx.tenantId, booking },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 200,
    include: {
      booking: { select: { id: true, reference: true } },
      commission: { select: { id: true, userId: true, amount: true, status: true, currency: true } },
      receipt: { select: { reference: true } },
      amendment: { select: { reference: true } },
    },
  });
  const ids = [
    ...new Set(
      cases
        .flatMap((k) => [k.assigneeId, k.commission.userId, k.proposedById, k.approvedById, k.resolvedById])
        .filter((x): x is string => !!x),
    ),
  ];
  const people = await prisma.user.findMany({
    where: { tenantId: ctx.tenantId, id: { in: ids } },
    select: { id: true, fullName: true },
  });
  const name = (id: string | null) => (id ? (people.find((p) => p.id === id)?.fullName ?? id) : '—');

  return (
    <div className="lf-stack">
      <ListHeader
        title="Recovery and adjustment cases"
        count={cases.length}
        noun="case"
        description="Paid commission whose money later moved. Acknowledging is not recovering; recovering needs evidence; writing off needs a second person."
        actions={
          <SalesLink href="/collections" className="lf-btn lf-btn--secondary">
            Collections
          </SalesLink>
        }
      />
      {cases.length === 0 ? (
        <section className="lf-card">
          <EmptyState title="No cases" />
        </section>
      ) : (
        <RecoveryCaseList
          cases={cases.map((k) => ({
            id: k.id,
            kind: k.kind,
            status: k.status,
            outcome: k.outcome,
            booking: k.booking.reference,
            bookingId: k.booking.id,
            person: name(k.commission.userId),
            commissionAmount: k.commission.amount.toString(),
            commissionStatus: k.commission.status,
            currency: k.currency,
            shortfall: k.shortfall?.toString() ?? null,
            adjustment: k.adjustment?.toString() ?? null,
            origin: k.receipt?.reference ?? k.amendment?.reference ?? '',
            reason: k.reason,
            assignee: name(k.assigneeId),
            assigneeId: k.assigneeId,
            proposedOutcome: k.proposedOutcome,
            proposedBy: name(k.proposedById),
            proposedById: k.proposedById,
            proposalReason: k.proposalReason,
            resolutionNote: k.resolutionNote,
            recoveredAmount: k.recoveredAmount?.toString() ?? null,
            resolutionReference: k.resolutionReference,
            createdAt: k.createdAt.toISOString(),
          }))}
          perms={{
            canWork: can(ctx, 'collections', 'CREATE'),
            canApprove: can(ctx, 'collections', 'APPROVE'),
            userId: ctx.actor.id,
          }}
        />
      )}
    </div>
  );
}
