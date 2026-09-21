import { prisma } from '@/lib/db';
import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { permission: SELF_SERVICE });
  // A failed query throws to the error boundary and loading.tsx covers the wait,
  // so reaching the empty state below means the inbox really is empty.
  const rows = await prisma.notification.findMany({
    where: { tenantId: ctx.tenantId, userId: ctx.actor.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return (
    <div className="lf-page-stack">
      <PageHeader title="Inbox" />
      {rows.length === 0 ? (
        <section className="lf-card">
          <EmptyState icon="✓" title="You're all caught up" description="New notifications will appear here." />
        </section>
      ) : (
        <WorkspaceTable
          headers={[
            'Title',
            { label: 'Message', priority: 'secondary' },
            { label: 'Created', priority: 'secondary' },
            { label: 'Read', priority: 'detail' },
          ]}
          rows={rows.map((r) => [r.title, r.body, r.createdAt.toLocaleString('en-AE'), r.readAt ? 'Yes' : 'No'])}
        />
      )}
    </div>
  );
}
