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
 * It is deliberately read-only:
 *
 *   * every module's VIEW and VIEW_REPORTS, at ORGANIZATION scope, so support can
 *     see what the customer sees and answer questions about it;
 *   * no CREATE/EDIT/DELETE/ASSIGN — support looks, it does not act as the
 *     customer, and a write would be attributed to a user who does not exist here;
 *   * no VIEW_SENSITIVE_FIELDS — salary, identity documents and the rest stay
 *     behind the company's own permission checks even for the platform owner.
 *
 * Entry is recorded as a PlatformAuditEvent by the route that sets it up.
 */
export async function buildSupportActor(tenantId: string, platformUserId: string): Promise<Actor> {
  const readable = await prisma.permission.findMany({
    where: { action: { in: ['VIEW', 'VIEW_REPORTS'] } },
    select: { module: true, action: true },
  });

  const permissions = new Map<string, Scope>();
  for (const permission of readable) {
    permissions.set(`${permission.module}:${permission.action}`, 'ORGANIZATION');
  }

  return {
    // Namespaced so it can never collide with a real User id, and so anything
    // that does slip through to an audit row is obviously platform staff.
    id: `platform:${platformUserId}`,
    tenantId,
    roleId: 'platform_support',
    roleKey: 'platform_support',
    roleRank: 0,
    branchId: null,
    regionId: null,
    teamIds: [],
    managedUserIds: [],
    permissions,
  };
}
