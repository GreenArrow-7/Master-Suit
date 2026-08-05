import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';

export default async function NewEmployeePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params; const { ctx } = await resolveWorkspacePage(workspaceSlug, 'HRMS');
  const departments = await prisma.department.findMany({ where: { tenantId: ctx.tenantId, deletedAt: null }, orderBy: { name: 'asc' } });
  return <div style={{ maxWidth: 760, display: 'grid', gap: 18 }}><div><div className="lf-eyebrow">People</div><h1 style={{ margin: '8px 0 0' }}>Create employee</h1><p>This creates one shared user, workspace membership, employee profile and Sales actor under workspace <code>{ctx.tenantId}</code>.</p></div><WorkspaceRecordForm endpoint={`/api/v1/workspaces/${workspaceSlug}/hr/employees`} submitLabel="Create employee" fields={[
    { name: 'fullName', label: 'Full name', required: true }, { name: 'email', label: 'Work email', type: 'email', required: true },
    { name: 'initialPassword', label: 'Initial password', type: 'password', required: true }, { name: 'employeeNumber', label: 'Employee number', required: true },
    { name: 'roleKey', label: 'Role', type: 'select', required: true, options: [{ value: 'employee', label: 'Employee' }, { value: 'sales_rep', label: 'Sales Representative' }, { value: 'manager', label: 'Manager' }, { value: 'hr_manager', label: 'HR Manager' }] },
    { name: 'departmentId', label: 'Department', type: 'select', options: departments.map((department) => ({ value: department.id, label: department.name })) },
    { name: 'designation', label: 'Designation' }, { name: 'employmentType', label: 'Employment type', placeholder: 'Full-time' }, { name: 'joinedOn', label: 'Joining date', type: 'date' },
  ]} /></div>;
}
