import { cache } from 'react';
import { headers } from 'next/headers';
import { forbidden } from 'next/navigation';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { requireWorkspace } from '@/lib/workspace';
import { assertPermission, type Action, type Ctx } from '@/lib/security/rbac';
import { recordPlatformAccess } from '@/lib/auth/service-identity';
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

/**
 * The signed-in actor, resolved once per request.
 *
 * The layout and the page it wraps both need it, and both used to resolve it
 * from scratch: two session lookups, two membership lookups and two permission
 * builds for a single navigation, which is most of what a tab click was paying
 * for. `resolveCtx` reads nothing from the request but the cookie header — the
 * URL it is handed is decorative — so within one render the answer cannot
 * differ, and React's `cache` collapses the pair into one.
 *
 * Per-request by construction: `cache` is scoped to a single render pass, so a
 * context can never survive into another user's request.
 */
export const requestCtx = cache(async (): Promise<Ctx> =>
  resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid()),
);

/**
 * Same reasoning for the workspace record, which both callers also load.
 *
 * The record load is cached on (ctx, slug) alone. `cache` keys on the full
 * argument list, so when the module rode along as a third argument the layout's
 * two-argument call and a page's three-argument call were different keys — and
 * the heavy tenant query ran twice per navigation. The entitlement check runs
 * outside the cache instead; it is already Redis-cached for a minute.
 */
const workspaceRecord = cache(async (ctx: Ctx, slug: string) => requireWorkspace(ctx, slug));

export async function requestWorkspace(ctx: Ctx, slug: string, module?: ProductModule) {
  const workspace = await workspaceRecord(ctx, slug);
  if (module) await assertModuleEntitlement(workspace.id, module);
  return workspace;
}

export async function resolveWorkspacePage(workspaceSlug: string, options: WorkspacePageOptions) {
  const ctx = await requestCtx();
  const workspace = await requestWorkspace(ctx, workspaceSlug, options.module);
  await assertPageAccess(ctx, options);
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
  const ctx = await requestCtx();
  if (options.module) await assertModuleEntitlement(ctx.tenantId, options.module);
  await assertPageAccess(ctx, options);
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
/**
 * Runs a page's data load, and refuses the same way the page gate does.
 *
 * The gate below only knows the coarse permission a route declares; several
 * services then apply a stricter rule of their own — the compliance register
 * needs `employee:VIEW` at TEAM, payroll needs `payroll:VIEW` at ORGANIZATION —
 * and throw when the caller falls short. Thrown from inside a server component
 * that has already passed the gate, that 403 lands on the generic error
 * boundary, so somebody whose role simply does not cover the screen was told
 * "Something went wrong on our side" and offered a Try again button that could
 * never work. It reads as the application crashing, which is exactly how it was
 * reported.
 *
 * Converting it to the same `forbidden()` interrupt `assertPageAccess` uses
 * gets the honest answer on screen and keeps genuine faults on the error page
 * where they belong. The API path is untouched: route handlers still receive a
 * thrown 403 and answer with a body.
 */
export async function pageLoad<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (err) {
    if ((err as { status?: number } | null)?.status === 403) forbidden();
    throw err;
  }
}

/**
 * The gate, and — for platform staff only — the audit row for having passed it.
 *
 * ── Why the audit hook is here and not in the API kernel ────────────────────
 *
 * The kernel audits every request a platform identity makes, but a workspace
 * *screen* never reaches it: `sales/leads/page.tsx` and its 113 siblings are
 * server components that call this helper and then query Prisma directly. So
 * the one path platform staff actually use to look at a customer's data — open
 * the console, enter the workspace, click through Leads, Calls, Follow-ups —
 * produced exactly one `WORKSPACE_OPENED` row at the door and nothing after it.
 *
 * This function is the only choke point both gate helpers share, which is why
 * the hook sits here rather than in either of them. A page that renders without
 * passing through here renders without a permission check either, and
 * `tests/security/page-access` is the suite that holds that line.
 *
 * `recordPlatformAccess` is the same writer the kernel uses, so staff page views
 * and staff API calls land in one stream under one event name rather than
 * becoming two things an incident has to join up. It self-guards on the actor
 * id: for one of the customer's own employees this costs a string comparison and
 * writes nothing.
 *
 * The write is awaited and may throw, exactly as on the API path. A screen that
 * renders a customer's records when the record of that read could not be written
 * is the outcome the whole design exists to prevent, and a page is not a weaker
 * case than an endpoint.
 */
async function assertPageAccess(ctx: Ctx, options: WorkspacePageOptions) {
  const accessModule = options.permission === SELF_SERVICE ? 'self' : options.permission[0];
  const action = options.permission === SELF_SERVICE ? 'VIEW' : options.permission[1];

  /**
   * Refusals are recorded too, then refused.
   *
   * A monitoring session is refused self-service screens outright — they are
   * where passwords, two-factor and recovery codes are managed, and a monitoring
   * session manages neither credential. Every other refusal is the permission
   * check. Either way the row is written before `forbidden()` interrupts, so an
   * attempt is as visible as a success. Best effort: a failed write here must
   * not turn a refusal into an error page.
   */
  let refused = false;
  if (options.permission === SELF_SERVICE) {
    refused = ctx.actor.platformMode === 'monitoring';
  } else {
    try {
      assertPermission(ctx, options.permission[0], options.permission[1]);
    } catch {
      refused = true;
    }
  }
  if (refused) {
    await recordPlatformAccess(ctx, {
      module: accessModule,
      action,
      method: 'GET',
      path: await pagePath(),
      status: 403,
    }).catch(() => {});
    forbidden();
  }

  await recordPlatformAccess(ctx, {
    // SELF_SERVICE screens carry no module/action pair to report. They are the
    // viewer's own profile and notifications, so `self` is the honest label —
    // and they are still recorded, because "which screens did they open" must
    // not have holes in it.
    module: options.permission === SELF_SERVICE ? 'self' : options.permission[0],
    action: options.permission === SELF_SERVICE ? 'VIEW' : options.permission[1],
    method: 'GET',
    path: await pagePath(),
    status: 200,
  });
}

/**
 * The URL of the screen being rendered, as well as a server component can know it.
 *
 * There is no first-class way to read it: `headers()` is what a server component
 * has, and Next populates `next-url` on a client-side navigation and leaves it
 * absent on a full document load, where `referer` is no help either. So this is
 * best-effort by construction, and the audit row does not depend on it — the
 * module and action above are derived from the page's own declared permission
 * and are always correct.
 */
async function pagePath(): Promise<string> {
  try {
    const header = await headers();
    return header.get('next-url') ?? header.get('x-invoke-path') ?? 'page';
  } catch {
    return 'page';
  }
}
