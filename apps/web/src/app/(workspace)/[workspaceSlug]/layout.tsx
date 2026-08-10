import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ulid } from 'ulid';
import { prisma } from '@/lib/db';
import { resolveCtx } from '@/lib/auth/session';
import { requireWorkspace } from '@/lib/workspace';
import { can } from '@/lib/security/rbac';
import WorkspaceSidebar from '@/components/workspace/WorkspaceSidebar';
import WorkspaceTopBar from '@/components/workspace/WorkspaceTopBar';
import SupportModeBanner from '@/components/platform/SupportModeBanner';
import ModuleTheme from '@/components/workspace/ModuleTheme';

export const dynamic = 'force-dynamic';

/** Every permission module the workspace navigation can gate an item on. */
const PERMISSION_KEYS = [
  'leads',
  'opportunities',
  'accounts',
  'contacts',
  'activities',
  'tasks',
  'documents',
  'tickets',
  'products',
  'fieldsales',
  'campaigns',
  'calls',
  'events',
  'forms',
  'landingpages',
  'communications',
  'automation',
  'reports',
  'dashboards',
  'smartviews',
  'users',
  'roles',
  'settings',
  'integrations',
  'auditlogs',
  // HR, split by authority (P1-8).
  'employee',
  'leave',
  'attendance',
  'hr_documents',
];

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  /**
   * Data gathering and rendering are separated deliberately.
   *
   * Wrapping the JSX in the try block meant an error thrown *while React
   * rendered* the children — after this function returned — was caught by this
   * handler and turned into a redirect to /login, hiding it. Only the data
   * fetching can fail in a way that means "not signed in"; everything after the
   * try block renders outside it.
   */
  const shell = await loadShell(workspaceSlug);
  if (!shell) redirect('/login');

  return (
    <div className="lf-app-frame">
      <ModuleTheme />
      <WorkspaceSidebar
        slug={shell.slug}
        name={shell.displayName}
        modules={shell.modules}
        permitted={shell.permitted}
        workspaces={shell.availableWorkspaces}
        user={shell.user}
      />
      <div className="lf-content-column">
        {shell.supportMode && (
          <SupportModeBanner workspaceId={shell.workspaceId} workspaceName={shell.displayName} readOnly={shell.supportReadOnly} />
        )}
        <WorkspaceTopBar slug={shell.slug} workspaceName={shell.displayName} plan={shell.plan} />
        <main className="lf-page-main">{children}</main>
      </div>
    </div>
  );
}

/** Null means "not signed in, or no access to this workspace". */
async function loadShell(workspaceSlug: string) {
  try {
    const ctx = await resolveCtx(new Request(`http://internal/${workspaceSlug}`, { headers: await headers() }), ulid());
    const workspace = await requireWorkspace(ctx, workspaceSlug);
    const signedInAs = await prisma.user.findFirst({
      where: { tenantId: ctx.tenantId, id: ctx.actor.id },
      select: { fullName: true, email: true },
    });
    const now = new Date();
    const modules = workspace.moduleEntitlements
      .filter((item) => ['TRIAL', 'ACTIVE', 'GRACE'].includes(item.state) && (!item.endsAt || item.endsAt > now))
      .map((item) => item.module);
    const memberships = await prisma.workspaceMembership.findMany({
      where: { salesUserId: ctx.actor.id, status: 'ACTIVE', tenant: { deletedAt: null } },
      include: { tenant: true },
      orderBy: { tenant: { displayName: 'asc' } },
    });

    const supportMode = ctx.actor.roleKey === 'platform_support' || ctx.actor.roleKey === 'platform_owner';
    const supportReadOnly = ctx.actor.roleKey === 'platform_support';

    return {
      workspaceId: workspace.id,
      supportMode,
      supportReadOnly,
      slug: workspace.slug,
      displayName: workspace.displayName,
      plan: workspace.subscription?.plan.name ?? workspace.planCode,
      modules,
      availableWorkspaces:
        memberships.length > 0
          ? memberships.map((membership) => ({ slug: membership.tenant.slug, name: membership.tenant.displayName }))
          : [{ slug: workspace.slug, name: workspace.displayName }],
      // The sidebar is a client component and cannot evaluate permissions
      // itself, so the VIEW grants are resolved here and handed over as a list.
      permitted: PERMISSION_KEYS.filter((key) => can(ctx, key, 'VIEW')),
      user: {
        name: signedInAs?.fullName ?? signedInAs?.email ?? (supportMode ? 'Platform staff' : 'Signed in'),
        role: ctx.actor.roleKey,
      },
    };
  } catch {
    return null;
  }
}
