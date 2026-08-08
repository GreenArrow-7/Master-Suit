import { requirePageAccess } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import { columnsFor } from '@/lib/grid/resolve';

export const metadata = { title: 'Campaigns' };

export default async function CampaignsPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['campaigns', 'VIEW'] });

  if (!can(ctx, 'campaigns', 'VIEW')) {
    return <EmptyState title="Access denied" description="You do not have permission to view campaigns." />;
  }

  const rows = await prisma.campaign.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      campaignType: true,
      channel: true,
      status: true,
      startDate: true,
      endDate: true,
      budget: true,
    },
  });

  const columns = await columnsFor(ctx.tenantId, 'CAMPAIGN');

  return (
    <>
      <ListHeader
        title="Campaigns"
        count={rows.length}
        actions={
          can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
            <ColumnEditor object="CAMPAIGN" current={columns.map((c) => c.key)} />
          )
        }
      />

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState title="No campaigns yet" description="Create a campaign to start reaching your audience." />
        </div>
      ) : (
        <ConfigurableGrid object="CAMPAIGN" columns={columns} rows={rows as any} />
      )}
    </>
  );
}
