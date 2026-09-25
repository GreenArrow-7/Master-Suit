import { requirePageAccess } from '@/lib/workspace-page';
import { withTx } from '@/lib/db';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Proposals' };

/**
 * The shortlists this agency has sent, and what came back.
 *
 * Sorted newest first, but the column that earns the screen is "liked": a
 * proposal opened four times with two properties ticked is the call to make
 * this morning, and there was previously no way to know that had happened.
 */
export default async function ProposalsPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['requirements', 'VIEW'] });

  const rows = await withTx(ctx.tenantId, async (tx) => {
    const proposals = await tx.proposal.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        status: true,
        sentAt: true,
        firstViewedAt: true,
        lastViewedAt: true,
        viewCount: true,
        createdAt: true,
        owner: { select: { fullName: true } },
        _count: { select: { items: true } },
      },
    });
    if (proposals.length === 0) return [];

    const liked = await tx.proposalItem.groupBy({
      by: ['proposalId'],
      where: {
        tenantId: ctx.tenantId,
        reaction: 'INTERESTED',
        proposalId: { in: proposals.map((proposal) => proposal.id) },
      },
      _count: { _all: true },
    });
    const likes = new Map(liked.map((row) => [row.proposalId, row._count._all]));

    return proposals.map((proposal) => ({ ...proposal, interested: likes.get(proposal.id) ?? 0 }));
  });

  const waiting = rows.filter((row) => row.status === 'SENT' && row.firstViewedAt === null).length;

  return (
    <>
      <ListHeader
        title="Proposals"
        description={
          rows.length === 0
            ? 'A shortlist you send a client on a link, on your own letterhead — and which of the properties they liked.'
            : waiting > 0
              ? `${waiting} sent and not yet opened.`
              : 'Everything sent has been opened.'
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing sent yet"
          description="Open a client's requirement, pick from what matches, and send it as a shortlist."
        />
      ) : (
        <div className="lf-card" style={{ overflowX: 'auto' }}>
          <table className="lf-table">
            <thead>
              <tr>
                <th>Proposal</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Properties</th>
                <th style={{ textAlign: 'right' }}>Liked</th>
                <th>Opened</th>
                <th>Agent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <SalesLink href={`/proposals/${row.id}`}>{row.title}</SalesLink>
                    <span style={{ display: 'block', fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
                      {row.sentAt
                        ? `sent ${row.sentAt.toLocaleDateString('en-GB')}`
                        : `drafted ${row.createdAt.toLocaleDateString('en-GB')}`}
                    </span>
                  </td>
                  <td>
                    <Badge value={row.status} />
                  </td>
                  <td style={{ textAlign: 'right' }} className="lf-num">
                    {row._count.items}
                  </td>
                  <td style={{ textAlign: 'right' }} className="lf-num">
                    {row.interested > 0 ? row.interested : '—'}
                  </td>
                  <td>
                    {row.status !== 'SENT' ? (
                      <span style={{ color: 'var(--lf-ink-3)' }}>—</span>
                    ) : row.firstViewedAt ? (
                      <>
                        {row.lastViewedAt?.toLocaleDateString('en-GB')}
                        <span style={{ color: 'var(--lf-ink-3)' }}>
                          {' '}
                          ({row.viewCount} {row.viewCount === 1 ? 'time' : 'times'})
                        </span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--lf-ink-3)' }}>not yet</span>
                    )}
                  </td>
                  <td>{row.owner?.fullName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
