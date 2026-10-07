import { prisma } from '@/lib/db';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { can } from '@/lib/security/rbac';
import { requirePageAccess } from '@/lib/workspace-page';
import ListHeader from '@/components/workspace/ListHeader';
import StageEditor from './StageEditor';

export const metadata = { title: 'Lead stages' };

/**
 * The pipeline a lead moves through, and what each stage asks for on entry:
 * a reason (or one of its sub-statuses) and the fields that must be filled.
 * Stages were created at provisioning and had no screen at all.
 */
export default async function LeadStagesPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['settings', 'VIEW'] });
  const stages = await prisma.leadStage.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      key: true,
      name: true,
      category: true,
      isDefault: true,
      slaMinutes: true,
      position: true,
      requiresReason: true,
      reasons: true,
      requiredFields: true,
      _count: { select: { leads: true } },
    },
  });

  return (
    <>
      <ListHeader
        title="Lead stages"
        description="The pipeline every lead moves through, and what each stage asks for."
        help={
          <p>
            A stage can require a reason when a lead enters it — one of its reasons when you list some, otherwise
            written in — and can require fields to be filled first.
          </p>
        }
      />
      <StageEditor
        workspaceSlug={workspaceSlug}
        canEdit={can(ctx, 'settings', 'MANAGE_CONFIGURATION')}
        stages={stages.map(({ _count, ...stage }) => ({ ...stage, leads: _count.leads }))}
      />
    </>
  );
}
