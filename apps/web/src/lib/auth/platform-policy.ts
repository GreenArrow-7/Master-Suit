export type WorkspaceCandidate = {
  status: string;
  tenant: { status: string; deletedAt: Date | null };
  salesUser: { status: string; deletedAt: Date | null } | null;
};

export function isPlatformOwner(role: string): boolean {
  return role === 'OWNER';
}

export function isActiveWorkspaceMembership(membership: WorkspaceCandidate): boolean {
  return membership.status === 'ACTIVE'
    && membership.tenant.status === 'ACTIVE'
    && membership.tenant.deletedAt === null
    && membership.salesUser?.status === 'ACTIVE'
    && membership.salesUser.deletedAt === null;
}
