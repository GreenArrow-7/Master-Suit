import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';

export default async function NewEmployeePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['users', 'MANAGE_USERS'] });
  const departments = await prisma.department.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null },
    orderBy: { name: 'asc' },
  });
  return (
    <div style={{ maxWidth: 760, display: 'grid', gap: 18 }}>
      <div>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>Invite employee</h1>
        {/*
          This page used to be headed "Create employee" and to ask for an
          "Initial password". The endpoint behind it does not accept one — it
          issues an invitation, and the schema drops the field — so whoever
          filled that box chose a password that was silently discarded and then
          had nothing to hand over. Inviting is the deliberate design: a login
          only ever comes into existence through a token its owner redeems, and
          the person sending the invitation never sees the password.
        */}
        <p>
          This sends an invitation. When it is accepted, one shared user, workspace membership, employee profile and
          Sales actor are created under workspace <code>{ctx.tenantId}</code>.
        </p>
      </div>
      <WorkspaceRecordForm
        endpoint={`/api/v1/workspaces/${workspaceSlug}/hr/employees`}
        submitLabel="Send invitation"
        fields={[
          { name: 'fullName', label: 'Full name', required: true },
          { name: 'email', label: 'Work email', type: 'email', required: true },
          { name: 'employeeNumber', label: 'Employee number', required: true },
          {
            name: 'roleKey',
            label: 'Role',
            type: 'select',
            required: true,
            options: [
              { value: 'employee', label: 'Employee' },
              { value: 'sales_rep', label: 'Sales Representative' },
              { value: 'manager', label: 'Manager' },
              { value: 'hr_manager', label: 'HR Manager' },
            ],
          },
          {
            name: 'departmentId',
            label: 'Department',
            type: 'select',
            options: departments.map((department) => ({ value: department.id, label: department.name })),
          },
          { name: 'designation', label: 'Designation' },
          { name: 'employmentType', label: 'Employment type', placeholder: 'Full-time' },
          { name: 'joinedOn', label: 'Joining date', type: 'date' },
        ]}
      />
    </div>
  );
}
