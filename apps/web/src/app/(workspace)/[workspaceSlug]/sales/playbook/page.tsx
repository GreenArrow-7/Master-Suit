import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { mayEditPlaybook } from '@/lib/security/record-scope';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import PlaybookEditor from './PlaybookEditor';
import BuyerPlaybooks, { type PlaybookRow } from './BuyerPlaybooks';

export const metadata = { title: 'Objection Playbook' };

export default async function PlaybookPage() {
  // Every lead module (M21-01): the live coach in Real Estate and Lead Eagle cites these cards too.
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['calls', 'VIEW'] });

  const [objections, playbooks] = await Promise.all([
    prisma.objection.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      take: 200,
      include: { _count: { select: { matches: true } } },
    }),
    prisma.salesPlaybook.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      take: 100,
    }),
  ]);

  const canEdit = mayEditPlaybook(ctx);

  return (
    <>
      <ListHeader title="Objection playbook" description="Prepare responses to common customer objections." />
      <details className="lf-help" style={{ marginBottom: 'var(--lf-space-4)' }}>
        <summary>How this works</summary>
        <div className="lf-help__body">
          <p>
            What your prospects push back with, and what a good answer sounds like. Every analysed call is checked
            against the trigger phrases here, and reps can rehearse any entry in Practice.
            {objections.length === 200
              ? ' Showing the first 200 objections in your scope.'
              : ` ${objections.length} objection${objections.length === 1 ? '' : 's'} in your scope.`}
          </p>
        </div>
      </details>

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

      <BuyerPlaybooks playbooks={playbooks as PlaybookRow[]} canEdit={canEdit} />
    </>
  );
}
