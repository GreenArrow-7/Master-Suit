import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requestCtx, requestWorkspace } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import { usableModules } from '@/lib/security/entitlements';
import { ACTIVE_PRODUCT_COOKIE } from '@/lib/nav/activeProduct';
import { passwordPolicy } from '@/services/identity/accounts';
import { passwordExpired } from '@/services/identity/passwordHistory';
import WorkspaceSidebar from '@/components/workspace/WorkspaceSidebar';
import MobileTabBar from '@/components/workspace/MobileTabBar';
import WorkspaceTopBar from '@/components/workspace/WorkspaceTopBar';
import SupportModeBanner from '@/components/platform/SupportModeBanner';
import ModuleTheme from '@/components/workspace/ModuleTheme';
import AssistantWidget from '@/components/assistant/AssistantWidget';
import NativePush from '@/components/pwa/NativePush';

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
        lastUsed={shell.lastProduct}
        permitted={shell.permitted}
        workspaces={shell.availableWorkspaces}
        user={shell.user}
        serviceMode={shell.serviceMode}
      />
      <div className="lf-content-column">
        {shell.supportMode && (
          <SupportModeBanner
            workspaceId={shell.workspaceId}
            workspaceName={shell.displayName}
            readOnly={shell.supportReadOnly}
          />
        )}
        <WorkspaceTopBar
          slug={shell.slug}
          workspaceName={shell.displayName}
          plan={shell.plan}
          creatable={shell.creatable}
        />
        <main className="lf-page-main">{children}</main>
        {/* Phone-tier primary navigation; hidden by CSS above it. */}
        <MobileTabBar slug={shell.slug} modules={shell.modules} lastUsed={shell.lastProduct} />
      </div>
      <AssistantWidget slug={shell.slug} />
      <NativePush />
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
    // One rule, shared with the API gate and the product hub — see
    // lib/security/entitlements.ts. Previously spelled out here and, differently,
    // on the dashboard.
    const modules = usableModules(workspace.moduleEntitlements, now);
    const memberships = await prisma.workspaceMembership.findMany({
      where: { salesUserId: ctx.actor.id, status: 'ACTIVE', tenant: { deletedAt: null } },
      // The switcher renders two strings; the full Tenant row is ~30 columns.
      select: { tenant: { select: { slug: true, displayName: true } } },
      orderBy: { tenant: { displayName: 'asc' } },
    });

    const serviceMode = ctx.actor.roleKey === 'platform_service';
    /**
     * The support banner is for people, and `platform_service` is deliberately
     * not in this list.
     *
     * It was, briefly. The argument for including it still holds — the banner
     * is the one piece of chrome distinguishing "you are inside someone else's
     * data" from an ordinary tab — but it is an interruption aimed at a human
     * who might forget which hat they are wearing, and this identity exists to
     * be driven deliberately, by an operator who signed into a separate
     * `/service-login` page with a separate credential and cannot have arrived
     * here by accident.
     *
     * Nothing about accountability changes with it gone: every request this
     * identity makes still writes a PlatformAuditEvent, the actor is still
     * labelled "Platform service" in the customer's own audit log, and the
     * session is still read-only — `buildSupportActor` grants it VIEW and
     * VIEW_REPORTS and there is no path to anything else.
     */
    const supportMode = ctx.actor.roleKey === 'platform_support' || ctx.actor.roleKey === 'platform_owner';
    const supportReadOnly = ctx.actor.roleKey === 'platform_support';

    return {
      workspaceId: workspace.id,
      supportMode,
      supportReadOnly,
      serviceMode,
      slug: workspace.slug,
      displayName: workspace.displayName,
      /**
       * The server-side half of the forced-change gate, and the one that counts:
       * the login response only *suggests* a destination, and typing any other
       * URL used to walk straight past it.
       *
       * Two conditions, one predicate. Null `passwordChangedAt` means the account
       * is still on the password an administrator issued — handed over by voice
       * or on paper, the weakest credential the system ever mints. The workspace's
       * `maxAgeDays` is the other, and until now it was a setting that did nothing.
       *
       * `undefined` is deliberately *not* expiry: a platform support actor has no
       * workspace User row at all, and an absent timestamp must not read as a
       * password that needs changing — it would trap them in a redirect to a
       * screen they have no account on. `null` is the opposite and does mean
       * expiry, which is why this tests for `undefined` rather than falsiness.
       *
       * Not `ctx.mustChangePassword`: that field is `passwordChangedAt === null`
       * and nothing more, so it carries the temporary-password half of the rule
       * and not the expiry half. Using it here would leave `maxAgeDays` a setting
       * that does nothing again, silently and on every workspace page.
       *
       * The timestamp comes off the context this navigation already resolved, so
       * the membership lookup this used to make is gone rather than moved.
       */
      mustChangePassword:
        ctx.passwordChangedAt !== undefined
          ? passwordExpired(ctx.passwordChangedAt, await passwordPolicy(workspace.id))
          : false,
      plan: workspace.subscription?.plan.name ?? workspace.planCode,
      modules,
      /**
       * The product the viewer last used, for the shared routes that have a
       * genuine choice. A cookie rather than localStorage because this is
       * rendered on the server: the sidebar writes it on navigation, and an
       * unrecognised or no-longer-owned value is discarded by
       * `resolveActiveProduct` rather than trusted.
       */
      lastProduct: (await cookies()).get(ACTIVE_PRODUCT_COOKIE)?.value ?? null,
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
