import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import { headroom, poolDepth } from '@/services/distribution/allocation';
import { pendingRequests } from '@/services/distribution/requests';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Allocation' };

/**
 * The pool, who is waiting for work, and how much each of them can take.
 *
 * Headroom sits next to the ask on purpose. Approving 200 for somebody whose
 * daily quota is 3 and then wondering why the number came back different is the
 * thing this page exists to prevent.
 */
export default async function AllocationPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['allocation', 'VIEW'] });
  const view = params.view === 'capacity' ? 'capacity' : 'requests';

  const isLeader = can(ctx, 'allocation', 'APPROVE');

  const agents = await prisma.user.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true, fullName: true, dailyLeadQuota: true, activeLeadCapacity: true },
    orderBy: { fullName: 'asc' },
    take: 100,
  });

  const [depth, requests, room] = await Promise.all([
    poolDepth(ctx.tenantId),
    pendingRequests(ctx.tenantId, 50),
    view === 'capacity'
      ? headroom(
          ctx.tenantId,
          agents.map((a) => a.id),
        )
      : [],
  ]);

  const roomBy = new Map(room.map((r) => [r.userId, r]));
  const nameBy = new Map(agents.map((a) => [a.id, a.fullName]));

  return (
    <>
      <ListHeader
        title="Allocation"
        description={
          <>
            {depth.toLocaleString('en-GB')} unassigned lead{depth === 1 ? '' : 's'} in the pool
            {requests.length > 0 && <> · {requests.length} waiting to be decided</>}
          </>
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="View">
        <SalesLink className="lf-tab" href="/allocation" aria-selected={view === 'requests'} role="tab">
          Requests
        </SalesLink>
        <SalesLink className="lf-tab" href="/allocation?view=capacity" aria-selected={view === 'capacity'} role="tab">
          Capacity
        </SalesLink>
      </nav>

      {view === 'requests' &&
        (requests.length === 0 ? (
          <div className="lf-card">
            <EmptyState
              title="Nobody is waiting"
              description={
                isLeader
                  ? 'When an agent runs out of leads and asks for more, the request lands here.'
                  : 'Ask for more leads and your request will appear here until a leader decides.'
              }
            />
          </div>
        ) : (
          <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
            <table className="lf-grid">
              <thead>
                <tr>
                  <th>Who</th>
                  <th style={{ textAlign: 'right' }}>Asked for</th>
                  <th style={{ textAlign: 'right' }}>Can take</th>
                  <th>Why</th>
                  <th>Waiting since</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500 }}>{r.requesterName ?? r.requesterId}</td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {r.requested}
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {/* Null means no quota is configured, which is not the
                          same as being unable to take anything. */}
                      {r.headroom?.available === null ? (
                        'no limit'
                      ) : (
                        <span
                          style={{ color: (r.headroom?.available ?? 0) === 0 ? 'var(--lf-vermillion)' : undefined }}
                        >
                          {r.headroom?.available ?? 0}
                        </span>
                      )}
                      {r.headroom && r.headroom.reasons.length > 0 && (
                        <div className="lf-hint">{r.headroom.reasons.join('; ')}</div>
                      )}
                    </td>
                    <td>{r.reason ?? '—'}</td>
                    <td>{r.createdAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {view === 'capacity' && (
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th>Who</th>
                <th style={{ textAlign: 'right' }}>Daily quota</th>
                <th style={{ textAlign: 'right' }}>Open-lead cap</th>
                <th style={{ textAlign: 'right' }}>Can take now</th>
                <th>Holding it up</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const r = roomBy.get(a.id);
                return (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 500 }}>{nameBy.get(a.id)}</td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {a.dailyLeadQuota ?? '—'}
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {a.activeLeadCapacity ?? '—'}
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {r?.available === null ? 'no limit' : (r?.available ?? 0)}
                    </td>
                    <td>
                      {r && r.reasons.length > 0 ? (
                        <Badge value={r.reasons[0]} tone="brass" />
                      ) : (
                        <span className="lf-hint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
