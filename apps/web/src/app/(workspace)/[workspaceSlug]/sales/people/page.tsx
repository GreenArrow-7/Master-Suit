import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import TableSearch from '@/components/workspace/TableSearch';

export default async function PeoplePage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['users', 'VIEW'] });
  const [employees, activeCount, membershipCount] = await Promise.all([
    prisma.employeeProfile.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      include: { membership: { include: { platformUser: true } } },
      orderBy: { employeeNumber: 'asc' },
      take: 25,
    }),
    prisma.employeeProfile.count({ where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: 'ACTIVE' } }),
    prisma.workspaceMembership.count({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' } }),
  ]);

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
      <section>
        <div className="lf-eyebrow">HR & people</div>
        <h1 style={{ margin: 'var(--lf-space-2) 0' }}>People workspace</h1>
        <p style={{ margin: 0, color: 'var(--lf-ink-600)' }}>
          Employees and access now share the same company boundary as Sales.
        </p>
      </section>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--lf-space-4)' }}>
        {[
          ['Active employees', activeCount],
          ['Active members', membershipCount],
          ['Directory records', employees.length],
        ].map(([label, value]) => (
          <article className="lf-card" key={label} style={{ padding: 'var(--lf-space-5)' }}>
            <div className="lf-eyebrow">{label}</div>
            <div style={{ fontFamily: 'var(--lf-font-display)', fontSize: 36, marginTop: 8 }}>{value}</div>
          </article>
        ))}
      </section>
      <section className="lf-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 'var(--lf-space-5)', borderBottom: '1px solid var(--lf-border-subtle)' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--lf-text-lg)' }}>Employee directory</h2>
        </div>
        {employees.length === 0 ? (
          <EmptyState
            title="No employees yet"
            description="People invited in the People module appear here — the directory is the same one, read from the Sales side."
          />
        ) : (
          <div style={{ padding: 'var(--lf-space-4)' }}>
          <TableSearch placeholder="Name, email, number or designation…" label="Search the directory">
          <table className="lf-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Number</th>
                <th>Designation</th>
                <th>Status</th>
                <th>Access</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td>
                    <strong>{employee.membership.platformUser.fullName}</strong>
                    <div style={{ color: 'var(--lf-ink-500)', fontSize: 'var(--lf-text-xs)' }}>
                      {employee.membership.platformUser.email}
                    </div>
                  </td>
                  <td className="lf-num">{employee.employeeNumber}</td>
                  <td>{employee.designation ?? '—'}</td>
                  <td>
                    <span className="lf-badge">{employee.employmentStatus}</span>
                  </td>
                  <td>{employee.membership.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableSearch>
          </div>
        )}
      </section>
    </div>
  );
}
