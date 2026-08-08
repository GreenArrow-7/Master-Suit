import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import PageHeader from '@/components/ui/PageHeader';

export default async function EmployeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });

  // The destination of the People search box in the top bar. Matches the three
  // columns the table actually shows a person by.
  const query = (await searchParams).q?.trim();
  const search = query
    ? {
        OR: [
          { employeeNumber: { contains: query, mode: 'insensitive' as const } },
          { membership: { platformUser: { fullName: { contains: query, mode: 'insensitive' as const } } } },
          { membership: { platformUser: { email: { contains: query, mode: 'insensitive' as const } } } },
        ],
      }
    : {};

  const rows = await prisma.employeeProfile.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null, ...search },
    include: {
      membership: { include: { platformUser: true, salesUser: { include: { role: true } } } },
      department: true,
    },
    orderBy: { employeeNumber: 'asc' },
  });
  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="People"
        title="Employees"
        description={
          query
            ? `${rows.length} employee records matching "${query}".`
            : `${rows.length} employee records in this workspace.`
        }
        breadcrumbs={[{ label: 'People', href: `/${workspaceSlug}/people` }, { label: 'Employees' }]}
        actions={
          <Link className="lf-btn" href={`/${workspaceSlug}/people/employees/new`}>
            Invite employee
          </Link>
        }
      />
      <WorkspaceTable
        empty={
          query
            ? `Nothing matches "${query}". Search covers name, work email and employee number.`
            : 'Invite the first employee and they will appear here once they accept.'
        }
        headers={['Employee', 'Number', 'Department', 'Designation', 'Role', 'Status']}
        rows={rows.map((employee) => [
          [
            <strong key="name">{employee.membership.platformUser.fullName}</strong>,
            <span key="email">{employee.membership.platformUser.email}</span>,
          ],
          employee.employeeNumber,
          employee.department?.name ?? '—',
          employee.designation ?? '—',
          employee.membership.salesUser?.role.name ?? employee.membership.roleSnapshot ?? '—',
          employee.employmentStatus,
        ])}
      />
    </div>
  );
}
