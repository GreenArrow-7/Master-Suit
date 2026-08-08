import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import { isHrAdmin } from '@/services/hr/access';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import RowActions from '@/components/workspace/RowActions';

export const metadata = { title: 'Holidays' };

const isoDate = (value: Date) => value.toISOString().slice(0, 10);

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });

  const rows = await prisma.hrHoliday.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { holidayDate: 'asc' },
  });

  const editable = isHrAdmin(ctx);
  const endpoint = `/api/v1/workspaces/${workspaceSlug}/hr/holidays`;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>Holidays</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
          Holidays are excluded from the working-day count when leave is calculated.
        </p>
      </div>

      {editable && (
        <WorkspaceRecordForm
          endpoint={endpoint}
          fields={[
            { name: 'name', label: 'Holiday name', required: true },
            { name: 'holidayDate', label: 'Date', type: 'date', required: true },
          ]}
        />
      )}

      <WorkspaceTable
        headers={['Holiday', 'Date', 'Confirmed', '']}
        empty="No holidays recorded for this workspace yet."
        rows={rows.map((row) => [
          row.name,
          isoDate(row.holidayDate),
          row.confirmed ? 'Yes' : 'Provisional',
          <RowActions
            key={row.id}
            endpoint={endpoint}
            id={row.id}
            canEdit={editable}
            // A holiday references nothing, so this really removes it. Entering
            // the wrong date is the common case and a tombstone helps nobody.
            archiveLabel="Delete"
            fields={[
              { name: 'name', label: 'Name', value: row.name },
              { name: 'holidayDate', label: 'Date', type: 'date', value: isoDate(row.holidayDate) },
            ]}
          />,
        ])}
      />
    </div>
  );
}
