import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import Badge, { type Tone } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import { columnsFor } from '@/lib/grid/resolve';

export const metadata = { title: 'Documents' };

const STATUS_TONE: Record<string, Tone> = {
  UPLOADED: 'slate', VERIFIED: 'viridian', REJECTED: 'vermillion', PENDING_VERIFICATION: 'brass',
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DocumentsPage() {
  const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());

  if (!can(ctx, 'documents', 'VIEW')) {
    return <EmptyState title="Access denied" description="You do not have permission to view documents." />;
  }

  const rows = await prisma.document.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, name: true, category: true, mimeType: true,
      sizeBytes: true, status: true, createdAt: true,
    },
  });

  const columns = await columnsFor(ctx.tenantId, 'DOCUMENT');

  return (
    <>
      <ListHeader title="Documents" count={rows.length} capped={rows.length === 50} 
        actions={can(ctx, 'settings', 'MANAGE_CONFIGURATION') && <ColumnEditor object="DOCUMENT" current={columns.map((c) => c.key)} />}
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
