import { headers } from 'next/headers';
import { forbidden } from 'next/navigation';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { requireWorkspace } from '@/lib/workspace';
import { assertPermission, type Action, type Ctx } from '@/lib/security/rbac';
import { assertModuleEntitlement, type ProductModule } from '@/lib/security/entitlements';

export interface WorkspacePageOptions {
  /** Product module this screen belongs to, when it belongs to one. */
  module?: ProductModule;
  /**
   * `[module, action]` the viewer must hold. **Required, deliberately.**
   *
   * This helper backs 46 of the 65 workspace pages and used to resolve the
   * session, check the workspace, and return — with no permission check at all.
   * Any authenticated employee could open the company profile, the role list,
   * the subscription, the security settings, the integration list, the whole
   * employee directory and the audit log simply by typing the URL.
   *
   * Making it required rather than optional turns every call site into a
   * compile error until it says what it needs. A default here would have let
   * the next page added quietly inherit the same hole.
   *
   * Use `SELF_SERVICE` for the handful of screens that show only the viewer's
   * own record and are correctly available to every member.
   */
  permission: readonly [string, Action] | typeof SELF_SERVICE;
}

/**
 * For screens that read nothing but `ctx.actor` — your own profile, your own
 * security settings, your own notifications. Spelled out so it is a visible
 * decision in the page rather than an absent argument.
 */
export const SELF_SERVICE = Symbol('self-service');

export async function resolveWorkspacePage(workspaceSlug: string, options: WorkspacePageOptions) {
  const ctx = await resolveCtx(new Request(`http://internal/${workspaceSlug}`, { headers: await headers() }), ulid());
  const workspace = await requireWorkspace(ctx, workspaceSlug, options.module);
  assertPageAccess(ctx, options);
  return { ctx, workspace };
}

/**
 * For pages that need the actor but not the workspace record.
 *
 * Thirty-nine pages called `resolveCtx` directly and did nothing else — no
 * permission, no entitlement. This gives them the two checks they were missing
 * without threading `params` through every signature.
 *
 * It does not re-verify that the URL slug matches the session's tenant, because
 * `(workspace)/[workspaceSlug]/layout.tsx` already did: it calls
 * `requireWorkspace(ctx, workspaceSlug)`, which throws when they disagree, and
 * Next runs that layout for every page nested beneath it. A page rendered
 * outside that layout must use `resolveWorkspacePage` instead.
 */
export async function requirePageAccess(options: WorkspacePageOptions) {
  const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());
  if (options.module) await assertModuleEntitlement(ctx.tenantId, options.module);
  assertPageAccess(ctx, options);
  return ctx;
}

/**
 * Refuses with Next's `forbidden()` interrupt rather than a thrown 403.
 *
 * A thrown AppError reached the generic error boundary, which told the viewer
 * "Something went wrong on our side" and offered "Try again" — a server-fault
 * story for a working access check, and a button that will never help. The
 * interrupt renders forbidden.tsx instead, which says what actually happened.
 *
 * The API path still throws: `assertPermission` is unchanged, and route
 * handlers must answer with a 403 body, not a rendered page.
 */
function assertPageAccess(ctx: Ctx, options: WorkspacePageOptions) {
  if (options.permission === SELF_SERVICE) return;
  try {
    assertPermission(ctx, options.permission[0], options.permission[1]);
  } catch {
    forbidden();
  }
}
