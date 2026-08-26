import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import BreakGlass from './BreakGlass';
import WorkspaceControls from './WorkspaceControls';
import WorkspaceEditForm from './WorkspaceEditForm';

const date = (value: Date | null | undefined) => value?.toLocaleDateString('en-AE') ?? '—';
const isoDate = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : '');

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;

  const [workspace, plans] = await Promise.all([
    prisma.tenant
      .findFirst({
        where: { id: workspaceId, deletedAt: null },
        include: {
          subscription: { include: { plan: true, modules: true } },
          moduleEntitlements: true,
          workspaceUsage: true,
          memberships: { include: { platformUser: true, salesUser: { include: { role: true } } } },
        },
      })
      .catch(() => null),
    prisma.subscriptionPlan.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
  ]);
  if (!workspace) notFound();

  const liveModules = workspace.moduleEntitlements
    .filter((entitlement) => entitlement.state !== 'CANCELED')
    .map((entitlement) => entitlement.module);
  const address = (workspace.address ?? {}) as { formatted?: string };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <div className="lf-eyebrow">Workspace</div>
        <h1 style={{ margin: '8px 0 0' }}>{workspace.displayName}</h1>
        <p>
          <code>{workspace.id}</code> · /{workspace.slug}/dashboard
        </p>
      </div>

      <WorkspaceControls workspaceId={workspace.id} status={workspace.status} />

      {/* Above the edit form deliberately: every field below it is a change to a
          customer's data, and the control that makes those changes possible
          should be read before them rather than found afterwards. */}
      <BreakGlass workspaceId={workspace.id} workspaceName={workspace.displayName} />

      <WorkspaceEditForm
        workspaceId={workspace.id}
        plans={plans.map((plan) => ({ code: plan.code, name: plan.name }))}
        initial={{
          workspaceName: workspace.workspaceName ?? workspace.displayName,
          legalName: workspace.legalName,
          displayName: workspace.displayName,
          industry: workspace.industry ?? '',
          country: workspace.country ?? 'AE',
          timezone: workspace.timezone,
          currency: workspace.currency,
          companyEmail: workspace.companyEmail ?? '',
          companyPhone: workspace.companyPhone ?? '',
          companyAddress: address.formatted ?? '',
          logoUrl: workspace.logoUrl ?? '',
          planCode: workspace.subscription?.plan.code ?? workspace.planCode,
          modules: liveModules,
          maxUsers: workspace.maxUsers?.toString() ?? '',
          maxEmployees: workspace.maxEmployees?.toString() ?? '',
          maxStorageMb: workspace.maxStorageMb?.toString() ?? '',
          trialStartedAt: isoDate(workspace.trialStartedAt),
          trialEndsAt: isoDate(workspace.trialEndsAt),
        }}
      />

      <h2>Company administrators and users</h2>
      <WorkspaceTable
        headers={['Name', 'Email', 'Role', 'Status']}
        rows={workspace.memberships.map((membership) => [
          membership.platformUser.fullName,
          membership.platformUser.email,
          membership.salesUser?.role.name ?? membership.roleSnapshot ?? '—',
          membership.status,
        ])}
      />

      <h2>Usage</h2>
      <WorkspaceTable
        headers={['Metric', 'Used', 'Limit', 'Measured']}
        rows={workspace.workspaceUsage.map((usage) => [
          usage.metric,
          usage.used,
          usage.limit ?? '—',
          usage.measuredAt.toLocaleString('en-AE'),
        ])}
      />

      <h2>Subscription at a glance</h2>
      <WorkspaceTable
        headers={['Field', 'Value']}
        rows={[
          ['Status', workspace.status],
          ['Plan', workspace.subscription?.plan.name ?? workspace.planCode],
          ['Modules', liveModules.join(' + ') || 'None'],
          ['Trial', `${date(workspace.trialStartedAt)} – ${date(workspace.trialEndsAt)}`],
        ]}
      />
    </div>
  );
}
