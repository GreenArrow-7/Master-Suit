import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';
import { listFeed } from '@/services/notifications/feed';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { permission: SELF_SERVICE });
  // A failed query throws to the error boundary and loading.tsx covers the wait,
  // so reaching the empty state below means the inbox really is empty.
  const rows = await listFeed(ctx.tenantId, ctx.actor.id, 100);
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
          rows={rows.map((r) => [
            // One span, so the phone card layout keeps title and badge together.
            <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {r.title}
              {(r.priority === 'HIGH' || r.priority === 'URGENT') && <Badge value={r.priority} />}
            </span>,
            r.body,
            r.createdAt.toLocaleString('en-AE'),
            r.readAt ? 'Yes' : 'No',
          ])}
        />
      )}
    </div>
  );
}
