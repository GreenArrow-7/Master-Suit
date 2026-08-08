import { prisma } from '@/lib/db';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
export default async function Page() {
  const rows = await prisma.platformUser.findMany({
    where: { deletedAt: null },
    include: { memberships: { include: { tenant: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1>Platform users</h1>
      <WorkspaceTable
        headers={['User', 'Email', 'Platform role', 'Workspaces', 'Status', 'Last login']}
        rows={rows.map((r) => [
          r.fullName,
          r.email,
          r.platformRole,
          r.memberships.map((m) => m.tenant.displayName).join(', ') || 'None',
          r.status,
          r.lastLoginAt?.toLocaleString('en-AE') ?? 'Never',
        ])}
      />
    </div>
  );
}
