import { prisma, withPlatformTx } from '@/lib/db';
import PageHeader from '@/components/ui/PageHeader';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import PlatformRowActions from '@/components/platform/PlatformRowActions';

export const dynamic = 'force-dynamic';

const SUBSCRIPTION_STATES = ['TRIAL', 'ACTIVE', 'GRACE', 'SUSPENDED', 'CANCELED'] as const;

export default async function SubscriptionsPage() {
  // Platform reads span every tenant, so they run with app.platform_admin set.
  // Without it the RLS policies match no rows and the console reported zero
  // employees, no modules and no subscriptions for perfectly healthy workspaces.
  const [rows, plans] = await Promise.all([
    withPlatformTx((tx) =>
      tx.tenantSubscription.findMany({
        where: { tenantId: { not: '' } },
        include: { tenant: true, plan: true, modules: true },
        orderBy: { createdAt: 'desc' },
      }),
    ),
    prisma.subscriptionPlan.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
  ]);

  const planOptions = plans.map((plan) => ({ value: plan.code, label: plan.name }));
  const stateOptions = SUBSCRIPTION_STATES.map((state) => ({ value: state, label: state }));

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="Commercial"
        title="Subscriptions"
        description="Change a customer's plan or state here; module entitlements follow the subscription automatically."
        breadcrumbs={[{ label: 'Platform', href: '/platform' }, { label: 'Subscriptions' }]}
      />
      <WorkspaceTable
        empty="No subscriptions yet — they are created with each workspace."
        headers={['Workspace', 'Plan', 'State', 'Modules', 'Trial ends', 'Period ends', 'Actions']}
        rows={rows.map((row: any) => [
          row.tenant.displayName,
          row.plan.name,
          <span key="state" className="lf-badge">
            {row.state}
          </span>,
          row.modules
            .filter((m: any) => m.state !== 'CANCELED')
            .map((m: any) => m.module)
            .join(' + ') || 'None',
          row.trialEndsAt?.toLocaleDateString('en-AE') ?? '—',
          row.currentPeriodEnd?.toLocaleDateString('en-AE') ?? '—',
          <PlatformRowActions
            key="actions"
            endpoint={`/api/v1/platform/subscriptions/${row.id}`}
            fields={[
              { name: 'planCode', label: 'Plan', type: 'select', value: row.plan.code, options: planOptions },
              { name: 'state', label: 'State', type: 'select', value: row.state, options: stateOptions },
              {
                name: 'trialEndsAt',
                label: 'Trial ends',
                type: 'date',
                value: row.trialEndsAt?.toISOString().slice(0, 10) ?? null,
              },
              {
                name: 'currentPeriodEnd',
                label: 'Period ends',
                type: 'date',
                value: row.currentPeriodEnd?.toISOString().slice(0, 10) ?? null,
              },
            ]}
            deleteLabel="Cancel"
            deleteWarning={`Cancels ${row.tenant.displayName}'s subscription: module access ends now. The record stays for billing history.`}
          />,
        ])}
      />
    </div>
  );
}
