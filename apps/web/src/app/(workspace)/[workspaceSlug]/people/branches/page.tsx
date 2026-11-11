import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import { isHrAdmin } from '@/services/hr/access';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import RowActions from '@/components/workspace/RowActions';

export const metadata = { title: 'Branches' };

/**
 * Branches had no screen and no API: only the seed could create one.
 *
 * Two things followed. The "Branch / office" field on Add user could only ever
 * read "Not set" in a workspace the seed had not touched, and the BRANCH record
 * scope — which the role editor offers alongside ORGANIZATION and TEAM — bound
 * to a set that was always empty, so a role granted it saw nothing.
 *
 * Name and code only, plus city and country. A branch also carries a timezone
 * and working hours, which keep their schema defaults until somebody asks for
 * them; adding fields nobody has asked for would be the easier mistake here.
 */
export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });

  const rows = await prisma.branch.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null },
    include: { _count: { select: { users: true } } },
    orderBy: { name: 'asc' },
  });

  // Presentation only. The server refuses PATCH and DELETE without ORGANIZATION
  // scope in hr/[resource]/route.ts, which is where the control actually is.
  const editable = isHrAdmin(ctx);
  const endpoint = `/api/v1/workspaces/${workspaceSlug}/hr/branches`;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>Branches</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
          Offices people are posted to. A role whose data scope is BRANCH sees the records of the branch its holder
          belongs to.
        </p>
      </div>

      {editable && (
        <WorkspaceRecordForm
          endpoint={endpoint}
          fields={[
            { name: 'name', label: 'Branch name', required: true },
            { name: 'code', label: 'Code', required: true },
            { name: 'city', label: 'City' },
            { name: 'country', label: 'Country' },
          ]}
        />
      )}

      <WorkspaceTable
        headers={['Branch', 'Code', 'City', 'Country', 'People', '']}
        empty="No branches yet. Add the first one above."
        rows={rows.map((row) => [
          row.name,
          row.code,
          row.city ?? '—',
          row.country ?? '—',
          row._count.users,
          <RowActions
            key={row.id}
            endpoint={endpoint}
            id={row.id}
            canEdit={editable}
            fields={[
              { name: 'name', label: 'Name', value: row.name },
              { name: 'code', label: 'Code', value: row.code },
              { name: 'city', label: 'City', value: row.city ?? '' },
              { name: 'country', label: 'Country', value: row.country ?? '' },
            ]}
          />,
        ])}
      />
    </div>
  );
}
