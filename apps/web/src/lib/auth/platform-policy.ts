export type WorkspaceCandidate = {
  status: string;
  tenant: { status: string; deletedAt: Date | null };
  salesUser: { status: string; deletedAt: Date | null } | null;
};

export function isPlatformOwner(role: string): boolean {
  return role === 'OWNER';
}

/**
 * The machine identity: background and AI reads across every workspace.
 *
 * Kept apart from the human roles everywhere it matters. It authenticates with
 * a rotatable credential rather than a password (lib/auth/service-identity.ts),
 * it is refused an interactive session by `resolvePlatformCtx`, and
 * `buildSupportActor` gives it read-only permissions with no elevation path.
 */
export function isPlatformServiceRole<T extends string>(role: T): role is T & 'AI_SERVICE' {
  return role === 'AI_SERVICE';
}

/**
 * Any platform role that can reach across tenant boundaries.
 *
 * OWNER runs the platform console; OWNER, SUPPORT and SECURITY_AUDITOR can all
 * open a customer workspace without holding a membership (see
 * lib/auth/support-actor.ts). Every one of them therefore reads data belonging
 * to customers who never granted them access, which is why two-factor
 * authentication is mandatory for all three and not only for the owner.
 *
 * `USER` — an ordinary workspace member — is deliberately not privileged here.
 */
export function isPrivilegedPlatformRole(role: string): boolean {
  return role !== 'USER';
}

export function isActiveWorkspaceMembership(membership: WorkspaceCandidate): boolean {
  return (
    membership.status === 'ACTIVE' &&
    membership.tenant.status === 'ACTIVE' &&
    membership.tenant.deletedAt === null &&
    membership.salesUser?.status === 'ACTIVE' &&
    membership.salesUser.deletedAt === null
  );
}
