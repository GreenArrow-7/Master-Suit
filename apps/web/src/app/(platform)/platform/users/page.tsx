import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { prisma } from '@/lib/db';
import { resolvePlatformCtx } from '@/lib/auth/session';
import PageHeader from '@/components/ui/PageHeader';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import PlatformRowActions from '@/components/platform/PlatformRowActions';

export const dynamic = 'force-dynamic';

const ROLE_OPTIONS = ['USER', 'OWNER', 'SUPPORT', 'SECURITY_AUDITOR'].map((role) => ({
  value: role,
  label: role.replaceAll('_', ' '),
}));
const STATUS_OPTIONS = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'INVITED'].map((status) => ({
  value: status,
  label: status,
}));

export default async function PlatformUsersPage() {
  // Who is viewing matters here: the API refuses self-demotion and
  // self-deletion, so the row for the signed-in owner carries no actions at all
  // rather than offering buttons that can only fail.
  const viewer = await resolvePlatformCtx(new Request('http://internal/', { headers: await headers() }), ulid());

  const rows = await prisma.platformUser.findMany({
    where: { deletedAt: null },
    include: { memberships: { include: { tenant: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="Identity"
        title="Platform users"
        description="Every login on the platform. Role and status changes apply immediately; deletion revokes access and keeps the audit trail."
        breadcrumbs={[{ label: 'Platform', href: '/platform' }, { label: 'Users' }]}
      />
      <WorkspaceTable
        empty="No platform users yet."
        headers={['User', 'Email', 'Platform role', 'Workspaces', 'Status', 'Last login', 'Actions']}
        rows={rows.map((user) => [
          user.fullName,
          user.email,
          <span key="role" className="lf-badge">
            {user.platformRole.replaceAll('_', ' ')}
          </span>,
          user.memberships.map((m) => m.tenant.displayName).join(', ') || 'None',
          user.status,
          user.lastLoginAt?.toLocaleString('en-AE') ?? 'Never',
          user.id === viewer.platformUserId ? (
            <span key="self" style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)' }}>
              You — ask another owner
            </span>
          ) : (
            <PlatformRowActions
              key="actions"
              endpoint={`/api/v1/platform/users/${user.id}`}
              fields={[
                { name: 'fullName', label: 'Full name', value: user.fullName },
                { name: 'platformRole', label: 'Platform role', type: 'select', value: user.platformRole, options: ROLE_OPTIONS },
                { name: 'status', label: 'Status', type: 'select', value: user.status, options: STATUS_OPTIONS },
              ]}
              deleteLabel="Delete"
              deleteWarning={`Deletes ${user.fullName}: sessions are revoked and workspace memberships suspended. Records they created keep their name for audit.`}
            />
          ),
        ])}
      />
    </div>
  );
}
