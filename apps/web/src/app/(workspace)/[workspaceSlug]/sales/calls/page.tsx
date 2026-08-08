import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import MetricCard from '@/components/ui/MetricCard';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import { columnsFor } from '@/lib/grid/resolve';
import { can } from '@/lib/security/rbac';

export const metadata = { title: 'Calls' };

export default async function CallsPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['calls', 'VIEW'] });

  const [calls, stats] = await Promise.all([
    prisma.call.findMany({
      where: { tenantId: ctx.tenantId, callerId: ctx.actor.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        status: true,
        outcome: true,
        direction: true,
        recipientNumber: true,
        durationSecs: true,
        startedAt: true,
        createdAt: true,
        leadId: true,
        notes: true,
        campaignId: true,
      },
    }),
    prisma.call.groupBy({
      by: ['outcome'],
      where: {
        tenantId: ctx.tenantId,
        callerId: ctx.actor.id,
        deletedAt: null,
        status: 'COMPLETED',
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
      _count: true,
    }),
  ]);

  const todayTotal = stats.reduce((s, r) => s + r._count, 0);
  const todayConnected = stats
    .filter((r) => r.outcome && ['CONNECTED', 'INTERESTED', 'QUALIFIED', 'CONVERTED'].includes(r.outcome))
    .reduce((s, r) => s + r._count, 0);

  const columns = await columnsFor(ctx.tenantId, 'CALL');

  return (
    <>
      <ListHeader
        title="Calls"
        count={calls.length}
        capped={calls.length === 100}
        actions={
          <>
            {can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
              <ColumnEditor object="CALL" current={columns.map((c) => c.key)} />
            )}
            <SalesLink href="/calls/new" className="lf-btn lf-btn--primary" style={{ textDecoration: 'none' }}>
              New Call
            </SalesLink>
          </>
        }
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 'var(--lf-space-4)',
          marginBottom: 'var(--lf-space-5)',
        }}
      >
        <MetricCard label="Today's Calls" value={todayTotal} />
        <MetricCard label="Connected" value={todayConnected} tone="viridian" />
        <MetricCard
          label="Connect Rate"
          value={todayTotal ? `${Math.round((todayConnected / todayTotal) * 100)}%` : '—'}
          tone="brass"
        />
        <MetricCard label="Total Calls" value={calls.length} />
      </div>

      {calls.length === 0 ? (
        <div className="lf-card">
          <EmptyState title="No calls yet" description="Start making calls to see your history here." />
        </div>
      ) : (
        <ConfigurableGrid object="CALL" columns={columns} rows={calls as any} />
      )}
    </>
  );
}
