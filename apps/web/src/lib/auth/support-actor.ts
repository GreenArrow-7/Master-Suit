import { prisma } from '../db';
import type { Actor, Scope } from '../security/rbac';

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
 * Authority depends on the platform role:
 *
 *   * **OWNER** holds every permission at ORGANIZATION scope — create, edit,
 *     delete, assign, approve, sensitive fields, the lot. The platform owner
 *     administers the product; a read-only owner cannot fix a customer's data,
 *     which is most of what they enter a workspace to do.
 *   * **SUPPORT** and **SECURITY_AUDITOR** stay read-only: every module's VIEW
 *     and VIEW_REPORTS, nothing else, and no VIEW_SENSITIVE_FIELDS — salary and
 *     identity documents stay behind the company's own permission checks.
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
  const fullControl = platformRole === 'OWNER';
  const grantable = await prisma.permission.findMany({
    ...(fullControl ? {} : { where: { action: { in: ['VIEW', 'VIEW_REPORTS'] } } }),
    select: { module: true, action: true },
  });

  const permissions = new Map<string, Scope>();
  for (const permission of grantable) {
    permissions.set(`${permission.module}:${permission.action}`, 'ORGANIZATION');
  }

  return {
    // Namespaced so it can never collide with a real User id, and so anything
    // that does slip through to an audit row is obviously platform staff.
    id: `platform:${platformUserId}`,
    tenantId,
    roleId: fullControl ? 'platform_owner' : 'platform_support',
    roleKey: fullControl ? 'platform_owner' : 'platform_support',
    roleRank: 0,
    branchId: null,
    regionId: null,
    teamIds: [],
    managedUserIds: [],
    permissions,
  };
}
