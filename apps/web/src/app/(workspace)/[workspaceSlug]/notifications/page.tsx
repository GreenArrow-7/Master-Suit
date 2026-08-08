import { prisma } from '@/lib/db';
import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { permission: SELF_SERVICE });
  const rows = await prisma.notification.findMany({
    where: { tenantId: ctx.tenantId, userId: ctx.actor.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1>Notifications</h1>
      <WorkspaceTable
        headers={['Title', 'Message', 'Created', 'Read']}
        rows={rows.map((r) => [r.title, r.body, r.createdAt.toLocaleString('en-AE'), r.readAt ? 'Yes' : 'No'])}
      />
    </div>
  );
}
