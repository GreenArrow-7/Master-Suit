import { withPlatformTx } from '@/lib/db';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
export default async function Page() {
  // Platform reads span every tenant, so they run with app.platform_admin set.
  // Without it the RLS policies match no rows and the console reported zero
  // employees, no modules and no subscriptions for perfectly healthy workspaces.
  const rows = await withPlatformTx((tx) =>
    tx.tenantSubscription.findMany({
      where: { tenantId: { not: '' } },
      include: { tenant: true, plan: true, modules: true },
      orderBy: { createdAt: 'desc' },
    }),
  );
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1>Subscriptions</h1>
      <WorkspaceTable
        headers={['Workspace', 'Plan', 'State', 'Modules', 'Trial ends', 'Period ends']}
        rows={rows.map((r) => [
          r.tenant.displayName,
          r.plan.name,
          r.state,
          r.modules
            .filter((m) => m.state !== 'CANCELED')
            .map((m) => m.module)
            .join(' + '),
          r.trialEndsAt?.toLocaleDateString('en-AE') ?? '—',
          r.currentPeriodEnd?.toLocaleDateString('en-AE') ?? '—',
        ])}
      />
    </div>
  );
}
