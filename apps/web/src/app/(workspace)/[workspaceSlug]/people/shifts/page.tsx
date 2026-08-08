import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import { isHrAdmin } from '@/services/hr/access';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import RowActions from '@/components/workspace/RowActions';
import Badge from '@/components/ui/Badge';

export const metadata = { title: 'Shifts' };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });

  const rows = await prisma.hrShift.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });

  const editable = isHrAdmin(ctx);
  const endpoint = `/api/v1/workspaces/${workspaceSlug}/hr/shifts`;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>Shifts</h1>
      </div>

      {editable && (
        <WorkspaceRecordForm
          endpoint={endpoint}
          fields={[
            { name: 'name', label: 'Shift name', required: true },
            { name: 'code', label: 'Code', required: true },
            { name: 'startTime', label: 'Start time', type: 'time', required: true },
            { name: 'endTime', label: 'End time', type: 'time', required: true },
          ]}
        />
      )}

      <WorkspaceTable
        headers={['Shift', 'Code', 'Hours', 'Status', '']}
        empty="No shifts defined yet."
        rows={rows.map((row) => [
          row.name,
          row.code,
          `${row.startTime}–${row.endTime}`,
          <Badge key={`${row.id}-status`} tone={row.isActive ? 'viridian' : 'slate'}>
            {row.isActive ? 'Active' : 'Retired'}
          </Badge>,
          <RowActions
            key={row.id}
            endpoint={endpoint}
            id={row.id}
            canEdit={editable && row.isActive}
            // Deactivated, not deleted: attendance rows point at this shift and
            // the history has to survive its retirement.
            archiveLabel="Retire"
            fields={[
              { name: 'name', label: 'Name', value: row.name },
              { name: 'startTime', label: 'Start', value: row.startTime },
              { name: 'endTime', label: 'End', value: row.endTime },
            ]}
          />,
        ])}
      />
    </div>
  );
}
