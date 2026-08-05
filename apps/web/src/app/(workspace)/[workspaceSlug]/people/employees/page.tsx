import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import PageHeader from '@/components/ui/PageHeader';

export default async function EmployeesPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, 'HRMS');
  const rows = await prisma.employeeProfile.findMany({ where: { tenantId: ctx.tenantId, deletedAt: null }, include: { membership: { include: { platformUser: true, salesUser: { include: { role: true } } } }, department: true }, orderBy: { employeeNumber: 'asc' } });
  return <div className="lf-page-stack">
    <PageHeader eyebrow="People" title="Employees" description={`${rows.length} employee records in this workspace.`} breadcrumbs={[{ label: 'People', href: `/${workspaceSlug}/people` }, { label: 'Employees' }]} actions={<Link className="lf-btn" href={`/${workspaceSlug}/people/employees/new`}>Create employee</Link>} />
    <WorkspaceTable headers={['Employee', 'Number', 'Department', 'Designation', 'Role', 'Status']} rows={rows.map((employee) => [[<strong key="name">{employee.membership.platformUser.fullName}</strong>, <span key="email">{employee.membership.platformUser.email}</span>], employee.employeeNumber, employee.department?.name ?? '—', employee.designation ?? '—', employee.membership.salesUser?.role.name ?? employee.membership.roleSnapshot ?? '—', employee.employmentStatus])} />
  </div>;
}
