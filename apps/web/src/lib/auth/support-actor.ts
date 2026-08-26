import { prisma } from '../db';
import type { Actor, Scope } from '../security/rbac';
import { activeGrant } from './platform-access';

/** Platform roles allowed to open a customer workspace without a membership. */
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
): Promise<Actor> {
  // Checked on every request rather than cached with the session: a grant that
  // has expired, or been handed back from another tab, must stop working now and
  // not at the next sign-in.
  const fullControl = platformRole === 'OWNER' && (await activeGrant(platformUserId, tenantId)) !== null;
  const grantable = await prisma.permission.findMany({
    ...(fullControl ? {} : { where: { action: { in: ['VIEW', 'VIEW_REPORTS'] } } }),
    select: { module: true, action: true },
  });

  const permissions = new Map<string, Scope>();
  for (const permission of grantable) {
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
  const roleKey = platformRole === 'OWNER' ? 'platform_owner' : 'platform_support';

  return {
    // Namespaced so it can never collide with a real User id, and so anything
    // that does slip through to an audit row is obviously platform staff.
    id: `platform:${platformUserId}`,
    tenantId,
    // What the chrome shows for staff inside a customer workspace — the staff
    // member's own name stays out of the customer-facing shell deliberately.
    fullName: 'Platform staff',
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
