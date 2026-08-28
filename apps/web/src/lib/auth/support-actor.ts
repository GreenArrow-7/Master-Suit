import { prisma } from '../db';
import type { Actor, Scope } from '../security/rbac';
import { activeGrant } from './platform-access';

/**
 * Platform roles allowed to open a customer workspace without a membership.
 *
 * `AI_SERVICE` is deliberately absent. This set gates the *session* path in
 * resolveCtx, and a service identity has no session to reach it with — it
 * arrives through requirePlatformServiceActor, which calls `buildSupportActor`
 * directly. Adding it here would create a second, session-shaped way in for a
 * credential that is supposed to have exactly one.
 */
const SUPPORT_ROLES = new Set(['OWNER', 'SUPPORT', 'SECURITY_AUDITOR']);

export const isSupportRole = (platformRole: string) => SUPPORT_ROLES.has(platformRole);

/**
 * The actor platform staff get inside a customer workspace.
 *
 * Platform staff hold no WorkspaceMembership by design — they are not employees
 * of the company — so there is no role to derive permissions from. Without this,
 * every workspace URL is unreachable for them and the People and Sales modules
 * cannot be seen at all from the platform console.
 *
 * Authority depends on the platform role, and — for OWNER — on whether they have
 * opened a break-glass grant:
 *
 *   * **OWNER without a grant** is read-only, exactly like SUPPORT. This used to
 *     be full control, permanently, from the moment a workspace was opened. The
 *     argument for it was that a read-only owner cannot fix a customer's data,
 *     which is true and is an argument for *elevation being available*, not for
 *     it being ambient — reading a customer's data and changing it are different
 *     acts.
 *   * **OWNER with a live grant** holds every permission at ORGANIZATION scope,
 *     until the grant expires. See lib/auth/platform-access.ts: a stated reason,
 *     a clock, and a row in the customer's audit trail.
 *   * **SUPPORT** and **SECURITY_AUDITOR** stay read-only and cannot elevate:
 *     every module's VIEW and VIEW_REPORTS, nothing else, and no
 *     VIEW_SENSITIVE_FIELDS — salary and identity documents stay behind the
 *     company's own permission checks.
 *
 * Writes are attributed to the namespaced actor id below, so an audit row from
 * platform staff can never be mistaken for one of the customer's own users.
 * Entry is recorded as a PlatformAuditEvent by the route that sets it up.
 */
export async function buildSupportActor(
  tenantId: string,
  platformUserId: string,
  platformRole: string,
  /**
   * `module:read` strings from a service credential, narrowing the map further.
   *
   * Only meaningful for `AI_SERVICE`, which is the only caller that carries a
   * per-credential scope list. Omitted for staff, whose authority comes from
   * their platform role and — for OWNER — a break-glass grant.
   */
  serviceScopes?: string[],
): Promise<Actor> {
  // Checked on every request rather than cached with the session: a grant that
  // has expired, or been handed back from another tab, must stop working now and
  // not at the next sign-in.
  //
  // The `=== 'OWNER'` is what makes the service identity structurally read-only:
  // there is no grant, no scope string and no column value that reaches this
  // branch for AI_SERVICE. Giving it write capability later means editing this
  // line, in review, which is the intended cost.
  const fullControl = platformRole === 'OWNER' && (await activeGrant(platformUserId, tenantId)) !== null;
  const grantable = await prisma.permission.findMany({
    ...(fullControl ? {} : { where: { action: { in: ['VIEW', 'VIEW_REPORTS'] } } }),
    select: { module: true, action: true },
  });

  const permissions = new Map<string, Scope>();
  for (const permission of grantable) {
    // An absent list is "no narrowing" for staff; an empty one is "nothing
    // granted" for a credential, which is why the two cases are distinguished
    // rather than both treated as falsy. A credential minted with a forgotten
    // scopes argument must read nothing, not everything.
    if (serviceScopes && !serviceScopes.includes(`${permission.module}:read`)) continue;
    permissions.set(`${permission.module}:${permission.action}`, 'ORGANIZATION');
  }

  /**
   * The role name follows who they *are*, not what they may currently do.
   *
   * Deriving it from `fullControl` made an un-elevated OWNER report as
   * `platform_support`, which puts the wrong name on every audit row they
   * generate and tells the console the wrong thing about who is signed in.
   * Authority lives in `permissions`; identity lives here.
   */
  const roleKey =
    platformRole === 'OWNER' ? 'platform_owner' : platformRole === 'AI_SERVICE' ? 'platform_service' : 'platform_support';

  return {
    // Namespaced so it can never collide with a real User id, and so anything
    // that does slip through to an audit row is obviously platform staff.
    id: `platform:${platformUserId}`,
    tenantId,
    // What the chrome shows for staff inside a customer workspace — the staff
    // member's own name stays out of the customer-facing shell deliberately.
    // A service identity names the *kind* of caller rather than the account, for
    // the same reason: nothing tenant-facing should read as a person here.
    fullName: platformRole === 'AI_SERVICE' ? 'Platform service' : 'Platform staff',
    email: '',
    // From `roleKey` above, not from `fullControl`. Main's side of this merge
    // derived both from the grant, which is the behaviour the comment above
    // exists to describe as wrong: an un-elevated OWNER reported as
    // `platform_support`, putting the wrong name on every audit row they wrote.
    roleId: roleKey,
    roleKey,
    roleRank: 0,
    branchId: null,
    regionId: null,
    grantedBranchIds: [],
    grantedRegionIds: [],
    teamIds: [],
    managedUserIds: [],
    permissions,
  };
}
