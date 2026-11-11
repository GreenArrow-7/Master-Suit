import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import { isHrAdmin } from '@/services/hr/access';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import RowActions from '@/components/workspace/RowActions';

export const metadata = { title: 'Departments & designations' };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });

  const [rows, designations] = await Promise.all([
    prisma.department.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      include: { _count: { select: { employees: true } } },
      orderBy: { name: 'asc' },
    }),
    // Designations had a full API and no screen anywhere, so the field on Add
    // user could only ever read "Not set". They are listed here beside
    // departments rather than on a page of their own: the same people maintain
    // both, and both fill one form.
    prisma.designation.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true },
    }),
  ]);

  // The row actions call PATCH and DELETE, which the API refuses without
  // ORGANIZATION scope. Hiding them for everyone else is presentation, not the
  // control — the server check is in hr/[resource]/route.ts.
  const editable = isHrAdmin(ctx);
  const endpoint = `/api/v1/workspaces/${workspaceSlug}/hr/departments`;
  const designationEndpoint = `/api/v1/workspaces/${workspaceSlug}/hr/designations`;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>Departments &amp; designations</h1>
      </div>

      {editable && (
        <WorkspaceRecordForm
          endpoint={endpoint}
          fields={[
            { name: 'name', label: 'Department name', required: true },
            { name: 'code', label: 'Code', required: true },
          ]}
        />
      )}

      <WorkspaceTable
        headers={['Department', 'Code', 'Employees', '']}
        empty="No departments yet. Add the first one above."
        rows={rows.map((row) => [
          row.name,
          row.code,
          row._count.employees,
          <RowActions
            key={row.id}
            endpoint={endpoint}
            id={row.id}
            canEdit={editable}
            fields={[
              { name: 'name', label: 'Name', value: row.name },
              { name: 'code', label: 'Code', value: row.code },
            ]}
          />,
        ])}
      />

      <div>
        <h2 className="lf-h2" id="designations" style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>
          Designations
        </h2>
      </div>

      {editable && (
        <WorkspaceRecordForm
          endpoint={designationEndpoint}
          fields={[
            { name: 'name', label: 'Designation name', required: true },
            { name: 'code', label: 'Code', required: true },
          ]}
        />
      )}

      <WorkspaceTable
        headers={['Designation', 'Code', '']}
        empty="No designations yet. Add the first one above."
        rows={designations.map((row) => [
          row.name,
          row.code,
          <RowActions
            key={row.id}
            endpoint={designationEndpoint}
            id={row.id}
            canEdit={editable}
            fields={[
              { name: 'name', label: 'Name', value: row.name },
              { name: 'code', label: 'Code', value: row.code },
            ]}
          />,
        ])}
      />
    </div>
  );
}
