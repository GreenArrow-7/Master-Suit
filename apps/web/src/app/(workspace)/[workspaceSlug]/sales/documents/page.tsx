import { requirePageAccess } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import { columnsFor } from '@/lib/grid/resolve';

export const metadata = { title: 'Documents' };

export default async function DocumentsPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['documents', 'VIEW'] });

  if (!can(ctx, 'documents', 'VIEW')) {
    return <EmptyState title="Access denied" description="You do not have permission to view documents." />;
  }

  /**
   * Scoped, not merely tenant-filtered.
   *
   * The page gated on `documents:VIEW` at *any* scope and then listed every
   * document in the workspace, so a sales representative holding that
   * permission at OWN — which is what the seeded role grants — read every
   * other rep's uploads and the organisation's own files. The permission was
   * being treated as a door rather than as a scope.
   *
   * `visibilityWhere` returns the bare tenant filter for ORGANIZATION, so an
   * organisation administrator still sees everything; below that it narrows to
   * the viewer's own records the same way every other list in the product does.
   */
  const scope = await visibilityWhere(ctx, 'documents', 'VIEW');

  const rows = await prisma.document.findMany({
    where: scope,
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      name: true,
      category: true,
      mimeType: true,
      sizeBytes: true,
      status: true,
      scanState: true,
      createdAt: true,
    },
  });

  const columns = await columnsFor(ctx.tenantId, 'DOCUMENT');

  return (
    <>
      <ListHeader
        title="Documents"
        count={rows.length}
        capped={rows.length === 50}
        actions={
          can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
            <ColumnEditor object="DOCUMENT" current={columns.map((c) => c.key)} />
          )
        }
      />

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState title="No documents" description="Upload a document to get started." />
        </div>
      ) : (
        <ConfigurableGrid object="DOCUMENT" columns={columns} rows={rows as any} />
      )}
    </>
  );
}
