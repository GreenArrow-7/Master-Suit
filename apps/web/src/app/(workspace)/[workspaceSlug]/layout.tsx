import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requestCtx, requestWorkspace } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import WorkspaceSidebar from '@/components/workspace/WorkspaceSidebar';
import WorkspaceTopBar from '@/components/workspace/WorkspaceTopBar';
import SupportModeBanner from '@/components/platform/SupportModeBanner';
import ModuleTheme from '@/components/workspace/ModuleTheme';
import AssistantWidget from '@/components/assistant/AssistantWidget';

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

  /**
   * One central gate for an account still on an administrator-issued password.
   *
   * The login response reported `mustChangePassword` and sent the browser to
   * the security screen, but that was the whole enforcement: typing any other
   * URL walked straight past it. A temporary password is handed over by voice
   * or on paper and is the weakest credential the system ever issues, so the
   * server has to decide this, on every page, not the client's redirect.
   *
   * Here rather than in each page's access check, because this layout is the
   * one thing Next runs for every screen beneath it — and outside `loadShell`,
   * because `redirect()` signals by throwing and that function's catch would
   * swallow it, which is the same trap its own comment warns about.
   *
   * `passwordChangedAt` is null only while an issued password is still in
   * force, so this clears itself the moment the account does what it is asked.
   */
  if (shell.mustChangePassword) {
    const security = `/${shell.slug}/profile/security`;
    const here = (await headers()).get('x-pathname') ?? '';
    if (!here.endsWith('/profile/security') && !here.endsWith('/people/security')) redirect(security);
  }

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
        <WorkspaceTopBar
          slug={shell.slug}
          workspaceName={shell.displayName}
          plan={shell.plan}
          creatable={shell.creatable}
        />
        <main className="lf-page-main">{children}</main>
      </div>
      <AssistantWidget />
    </div>
  );
}

/** Null means "not signed in, or no access to this workspace". */
async function loadShell(workspaceSlug: string) {
  try {
    // Shared with the page beneath: one session lookup and one workspace read
    // per navigation instead of two of each.
    const ctx = await requestCtx();
    const workspace = await requestWorkspace(ctx, workspaceSlug);
    const now = new Date();
    const modules = workspace.moduleEntitlements
      .filter((item) => ['TRIAL', 'ACTIVE', 'GRACE'].includes(item.state) && (!item.endsAt || item.endsAt > now))
      .map((item) => item.module);
    const memberships = await prisma.workspaceMembership.findMany({
      where: { salesUserId: ctx.actor.id, status: 'ACTIVE', tenant: { deletedAt: null } },
      // The switcher renders two strings; the full Tenant row is ~30 columns.
      select: { tenant: { select: { slug: true, displayName: true } } },
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
      // resolveCtx read passwordChangedAt off the session row it already held;
      // strictly true only for real members — a support actor never carries it.
      mustChangePassword: ctx.mustChangePassword === true,
      plan: workspace.subscription?.plan.name ?? workspace.planCode,
      modules,
      availableWorkspaces:
        memberships.length > 0
          ? memberships.map((membership) => ({ slug: membership.tenant.slug, name: membership.tenant.displayName }))
          : [{ slug: workspace.slug, name: workspace.displayName }],
      // The sidebar is a client component and cannot evaluate permissions
      // itself, so the VIEW grants are resolved here and handed over as a list.
      permitted: PERMISSION_KEYS.filter((key) => can(ctx, key, 'VIEW')),
      // Same trick for the + Create menu: entries whose module the role cannot
      // CREATE never render (a read-only executive gets no menu at all).
      creatable: ['leads', 'opportunities', 'accounts', 'contacts', 'calls', 'events'].filter((key) =>
        can(ctx, key, 'CREATE'),
      ),
      user: {
        // buildActor carries the name from the row it loads anyway; the support
        // actor names itself 'Platform staff'.
        name: ctx.actor.fullName || ctx.actor.email || 'Signed in',
        role: ctx.actor.roleKey,
      },
    };
  } catch {
    return null;
  }
}
