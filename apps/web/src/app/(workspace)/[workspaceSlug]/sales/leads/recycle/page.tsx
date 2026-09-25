import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { findRecyclable, recyclePolicy } from '@/services/leads/recycling';
import ListHeader from '@/components/workspace/ListHeader';
import EmptyState from '@/components/ui/EmptyState';
import RecycleQueue from './RecycleQueue';

export const metadata = { title: 'Recycle leads' };

/**
 * The leads that went cold, and whether they may be offered to somebody else.
 *
 * The queue is the second half of a lead's life. A brokerage pays the same for
 * a lead whether it closes or not, and the ones marked lost in March are the
 * cheapest list it will ever own — provided the people on it are contacted
 * again at a decent interval, and provided the ones who said "stop" never are.
 *
 * Data is loaded here and handed down, rather than fetched on mount: the page
 * is already a server component and a second round trip on every visit buys
 * nothing.
 */
export default async function RecycleLeadsPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['leads', 'REASSIGN'] });

  const [policy, candidates, stages] = await Promise.all([
    recyclePolicy(ctx.tenantId),
    findRecyclable(ctx.tenantId),
    prisma.leadStage.findMany({
      where: { tenantId: ctx.tenantId, category: 'OPEN', deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
      select: { id: true, name: true },
    }),
  ]);

  const ready = candidates.filter((candidate) => candidate.blocked === null).length;

  return (
    <>
      <ListHeader
        title="Recycle leads"
        description={
          policy.afterDays <= 0
            ? 'Switched off. Nothing is recycled until a cooling-off period is set below.'
            : ready > 0
              ? `${ready} ${ready === 1 ? 'lead is' : 'leads are'} ready to go back to the floor.`
              : 'Nothing is ready yet. The queue fills as lost leads pass their cooling-off period.'
        }
      />

      <RecycleQueue
        policy={policy}
        stages={stages}
        candidates={candidates.map((candidate) => ({
          ...candidate,
          lostAt: candidate.lostAt?.toISOString() ?? null,
        }))}
      />

      {candidates.length === 0 && (
        <EmptyState
          title="No lost leads"
          description="Leads appear here once they are moved to a lost stage. Nothing has been."
        />
      )}
    </>
  );
}
