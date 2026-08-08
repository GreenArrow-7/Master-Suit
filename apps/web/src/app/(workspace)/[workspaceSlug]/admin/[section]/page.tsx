import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import { can, type Action } from '@/lib/security/rbac';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import SettingsForm, { type SettingsField } from './SettingsForm';

/**
 * One route serving four administration screens.
 *
 * Each needs its own permission — reading the subscription is not the same right
 * as reading the security posture — so the permission is resolved from the
 * section before the workspace is loaded. Previously this page took no
 * permission at all (P1-1) *and* rendered a static table with no way to change
 * anything (4.4). Both are fixed here.
 */
const SECTION_PERMISSION: Record<string, readonly [string, Action]> = {
  company: ['settings', 'VIEW'],
  modules: ['settings', 'VIEW'],
  subscription: ['settings', 'VIEW'],
  security: ['settings', 'VIEW'],
};

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string; section: string }> }) {
  const { workspaceSlug, section } = await params;

  // `roles` has a real editor of its own; this read-only duplicate only ever
  // confused the two. Send people to the screen that can change things.
  if (section === 'roles') redirect(`/${workspaceSlug}/admin/roles`);

  const permission = SECTION_PERMISSION[section];
  if (!permission) notFound();

  const { ctx, workspace } = await resolveWorkspacePage(workspaceSlug, { permission });
  const canConfigure = can(ctx, 'settings', 'MANAGE_CONFIGURATION');
  const endpoint = (target: string) => `/api/v1/workspaces/${workspaceSlug}/settings/${target}`;
  const address = (workspace.address ?? {}) as { formatted?: string };

  switch (section) {
    case 'company': {
      const fields: SettingsField[] = [
        { name: 'displayName', label: 'Display name', value: workspace.displayName },
        { name: 'legalName', label: 'Legal name', value: workspace.legalName },
        { name: 'industry', label: 'Industry', value: workspace.industry ?? '' },
        { name: 'timezone', label: 'Time zone', value: workspace.timezone },
        { name: 'currency', label: 'Currency', value: workspace.currency, hint: 'Three-letter code.' },
        { name: 'companyEmail', label: 'Company email', type: 'email', value: workspace.companyEmail ?? '' },
        { name: 'companyPhone', label: 'Company phone', value: workspace.companyPhone ?? '' },
        { name: 'companyAddress', label: 'Address', value: address.formatted ?? '' },
        {
          name: 'logoUrl',
          label: 'Logo URL',
          type: 'url',
          value: workspace.logoUrl ?? '',
          hint: 'A link to your logo. Shown in the workspace shell.',
        },
      ];
      return (
        <Shell title="Company profile">
          <SettingsForm endpoint={endpoint('company')} fields={fields} canEdit={canConfigure} />
        </Shell>
      );
    }

    case 'security': {
      const setting = await prisma.organizationSetting.findUnique({ where: { tenantId: ctx.tenantId } });
      const policy = (setting?.passwordPolicy ?? {}) as Record<string, unknown>;
      const fields: SettingsField[] = [
        {
          name: 'mfaRequired',
          label: 'Require two-factor authentication',
          type: 'checkbox',
          value: Boolean(setting?.mfaRequired),
          hint: 'Anyone who has not enrolled is sent to set up an authenticator at their next sign-in — they are not locked out.',
        },
      ];
      return (
        <Shell title="Security">
          <SettingsForm endpoint={endpoint('security')} fields={fields} canEdit={canConfigure} />
          <WorkspaceTable
            headers={['Control', 'Value']}
            rows={[
              ['Minimum password length', String(policy.minLength ?? 12)],
              ['Session workspace binding', 'Enabled'],
              ['Tenant query guard', 'Enabled'],
              ['Database row-level security', 'Enforced'],
              ['Workspace status', workspace.status],
            ]}
          />
        </Shell>
      );
    }

    case 'modules':
      return (
        <Shell title="Modules">
          <SettingsForm
            endpoint={endpoint('company')}
            fields={[]}
            canEdit={false}
            readOnlyReason="Which products this workspace can use is set by your platform provider, not from inside the workspace — otherwise a workspace could grant itself a module it has not bought."
          />
          <WorkspaceTable
            headers={['Module', 'State', 'Ends']}
            rows={workspace.moduleEntitlements.map((entitlement) => [
              entitlement.module,
              entitlement.state,
              entitlement.endsAt?.toLocaleDateString('en-AE') ?? '—',
            ])}
          />
        </Shell>
      );

    case 'subscription':
      return (
        <Shell title="Subscription">
          <SettingsForm
            endpoint={endpoint('company')}
            fields={[]}
            canEdit={false}
            readOnlyReason="Your plan and its limits are set by your platform provider. Ask them to change the plan, add seats or extend a trial."
          />
          <WorkspaceTable
            headers={['Field', 'Value']}
            rows={[
              ['Plan', workspace.subscription?.plan.name ?? workspace.planCode],
              ['Status', workspace.subscription?.state ?? '—'],
              ['Users', `${workspace._count.memberships} / ${workspace.maxUsers ?? 'unlimited'}`],
              ['Employees', `${workspace._count.employeeProfiles} / ${workspace.maxEmployees ?? 'unlimited'}`],
              ['Storage MB', workspace.maxStorageMb ?? 'unlimited'],
              ['Trial ends', workspace.trialEndsAt?.toLocaleDateString('en-AE') ?? '—'],
            ]}
          />
        </Shell>
      );

    default:
      notFound();
  }
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <div className="lf-eyebrow">Administration</div>
        <h1 style={{ margin: '8px 0 0' }}>{title}</h1>
      </div>
      {children}
    </div>
  );
}
