import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import PlaybookEditor from './PlaybookEditor';

export const metadata = { title: 'Objection Playbook' };

export default async function PlaybookPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['calls', 'VIEW'] });

  const objections = await prisma.objection.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null },
    orderBy: { name: 'asc' },
    take: 200,
    include: { _count: { select: { matches: true } } },
  });

  const canEdit = can(ctx, 'calls', 'CREATE');

  return (
    <>
      <ListHeader title="Objection playbook" count={objections.length} capped={objections.length === 200} />
      <p
        style={{
          margin: 'var(--lf-space-2) 0 var(--lf-space-4)',
          fontSize: 'var(--lf-text-sm)',
          color: 'var(--lf-ink-3)',
        }}
      >
        What your prospects push back with, and what a good answer sounds like. Every analysed call is checked against
        the trigger phrases here, and reps can rehearse any entry in Practice.
      </p>

      {objections.length === 0 && !canEdit ? (
        <div className="lf-card">
          <EmptyState title="No playbook yet" description="A manager can add objections and recommended responses." />
        </div>
      ) : (
        <PlaybookEditor
          canEdit={canEdit}
          objections={objections.map((o) => ({
            id: o.id,
            name: o.name,
            description: o.description,
            tags: o.tags,
            triggerPhrases: o.triggerPhrases,
            recommendedResponses: o.recommendedResponses,
            isActive: o.isActive,
            matchCount: o._count.matches,
          }))}
        />
      )}
    </>
  );
}
