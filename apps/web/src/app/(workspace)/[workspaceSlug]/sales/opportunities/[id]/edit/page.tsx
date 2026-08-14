import { notFound, redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { prisma } from '@/lib/db';
import OpportunityForm from '../../new/OpportunityForm';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Edit opportunity' };

export default async function EditOpportunityPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; id: string }>;
}) {
  const { workspaceSlug, id } = await params;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['opportunities', 'EDIT'] });

  const scope = await visibilityWhere(ctx, 'opportunities', 'VIEW', { includeUnassigned: true });
  const opportunity = await prisma.opportunity.findFirst({
    where: { ...scope, id },
    select: {
      id: true,
      name: true,
      status: true,
      amount: true,
      currency: true,
      expectedCloseDate: true,
      stageId: true,
      pipeline: {
        select: { stages: { orderBy: { position: 'asc' }, select: { id: true, name: true } } },
      },
    },
  });
  if (!opportunity) notFound();
  // Closed deals are settled via Won/Lost on the detail page, not re-edited here.
  if (opportunity.status !== 'OPEN') redirect(`/${workspaceSlug}/sales/opportunities/${opportunity.id}`);

  const rules = await loadFieldRules(ctx, 'OPPORTUNITY');
  const safe = applyFieldSecurity(ctx, 'OPPORTUNITY', rules, opportunity) as typeof opportunity;

  return (
    <div style={{ maxWidth: 480 }}>
      <SalesLink href={`/opportunities/${opportunity.id}`} style={{ fontSize: 'var(--lf-text-sm)' }}>
        ← {opportunity.name}
      </SalesLink>
      <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: 'var(--lf-space-3) 0 var(--lf-space-5)' }}>
        Edit opportunity
      </h1>
      <OpportunityForm
        opportunityId={opportunity.id}
        stages={opportunity.pipeline.stages}
        initial={{
          name: safe.name,
          amount: String(safe.amount),
          currency: safe.currency,
          expectedCloseDate: opportunity.expectedCloseDate?.toISOString().slice(0, 10) ?? '',
          stageId: opportunity.stageId,
        }}
      />
    </div>
  );
}
