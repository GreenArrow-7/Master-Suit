import Link from 'next/link';
import { prisma } from '@/lib/db';
import PageHeader from '@/components/ui/PageHeader';

export default async function WorkspacesPage() {
  const workspaces = await prisma.tenant.findMany({
    where: { deletedAt: null },
    include: {
      subscription: { include: { plan: true } },
      moduleEntitlements: true,
      _count: { select: { memberships: true, employeeProfiles: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="lf-page-stack">
      <PageHeader eyebrow="Customers" title="Workspaces" description="Manage companies, enabled modules, usage limits and subscription status." breadcrumbs={[{ label: 'Platform', href: '/platform' }, { label: 'Workspaces' }]} actions={<Link href="/platform/workspaces/new" className="lf-btn">Create workspace</Link>} />
      <section className="lf-table-wrap">
        <table className="lf-table">
          <thead><tr><th>Company</th><th>Status</th><th>Plan</th><th>Modules</th><th>Members</th><th>Employees</th><th>Created</th></tr></thead>
          <tbody>{workspaces.map((workspace) => (
            <tr key={workspace.id}>
              <td><Link href={`/platform/workspaces/${workspace.id}`}><strong>{workspace.displayName}</strong></Link><div style={{ color: 'var(--lf-ink-500)', fontSize: 'var(--lf-text-xs)' }}>{workspace.slug}</div></td>
              <td><span className="lf-badge">{workspace.status}</span></td>
              <td>{workspace.subscription?.plan.name ?? workspace.planCode}</td>
              <td>{workspace.moduleEntitlements.map((item) => item.module).join(' + ') || 'None'}</td>
              <td className="lf-num">{workspace._count.memberships}</td>
              <td className="lf-num">{workspace._count.employeeProfiles}</td>
              <td>{workspace.createdAt.toLocaleDateString('en-AE')}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
    </div>
  );
}
