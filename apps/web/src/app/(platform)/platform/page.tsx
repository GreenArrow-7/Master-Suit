import Link from 'next/link';
import { withPlatformTx } from '@/lib/db';
import PageHeader from '@/components/ui/PageHeader';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';

export default async function PlatformOverviewPage() {
  const [
    workspaceCount,
    activeCount,
    trialCount,
    suspendedCount,
    userCount,
    employeeCount,
    hrmsCount,
    salesCount,
    recentEvents,
  ] = // Platform reads span every tenant, so they run with app.platform_admin set.
    // Without it the RLS policies match no rows and the console reported zero
    // employees, no modules and no subscriptions for perfectly healthy workspaces.
    await withPlatformTx((tx) =>
      Promise.all([
        tx.tenant.count({ where: { deletedAt: null } }),
        tx.tenant.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
        tx.tenantSubscription.count({ where: { tenantId: { not: '' }, state: 'TRIAL' } }),
        tx.tenant.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
        tx.platformUser.count({ where: { deletedAt: null } }),
        tx.employeeProfile.count({ where: { tenantId: { not: '' }, deletedAt: null } }),
        tx.moduleEntitlement.count({
          where: { tenantId: { not: '' }, module: 'HRMS', state: { in: ['TRIAL', 'ACTIVE', 'GRACE'] } },
        }),
        tx.moduleEntitlement.count({
          where: { tenantId: { not: '' }, module: 'SALES', state: { in: ['TRIAL', 'ACTIVE', 'GRACE'] } },
        }),
        tx.platformAuditEvent.findMany({
          take: 8,
          orderBy: { occurredAt: 'desc' },
          include: { actor: true, tenant: true },
        }),
      ]),
    );

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="Commercial operations"
        title="Platform overview"
        description="Monitor every workspace, subscription and security boundary from one control centre."
        breadcrumbs={[{ label: 'Platform' }]}
        actions={
          <>
            <Link className="lf-btn lf-btn--secondary" href="/platform/subscriptions">
              View subscriptions
            </Link>
            <Link className="lf-btn" href="/platform/workspaces/new">
              Create workspace
            </Link>
          </>
        }
      />

      <section className="lf-metric-grid">
        {[
          ['Workspaces', workspaceCount],
          ['Active', activeCount],
          ['Trials', trialCount],
          ['Suspended', suspendedCount],
          ['Platform users', userCount],
          ['Employees', employeeCount],
          ['HRMS adoption', hrmsCount],
          ['Sales adoption', salesCount],
        ].map(([label, value]) => (
          <article key={label} className="lf-metric-card">
            <div className="lf-eyebrow">{label}</div>
            <div className="lf-metric-card__value">{value}</div>
          </article>
        ))}
      </section>

      <section>
        <h2 className="lf-h2" style={{ marginBottom: 10 }}>
          Recent platform activity
        </h2>
        <WorkspaceTable
          empty="No platform events yet."
          headers={['Event', 'Workspace', 'Actor', 'Time']}
          rows={recentEvents.map((event) => [
            event.event.replaceAll('_', ' '),
            event.tenant?.displayName ?? 'Global',
            event.actor?.email ?? 'System',
            event.occurredAt.toLocaleString('en-AE'),
          ])}
        />
      </section>
    </div>
  );
}
