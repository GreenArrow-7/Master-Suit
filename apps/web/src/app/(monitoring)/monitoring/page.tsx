import { prisma } from '@/lib/db';
import { requireMonitoringPage } from '@/lib/monitoring-page';
import { activeCoverage, authorizedTenantIds } from '@/lib/auth/platform-access';
import OpenWorkspaceButton from '@/components/platform/OpenWorkspaceButton';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import EmptyState from '@/components/ui/EmptyState';

export const metadata = { title: 'Monitoring' };

/**
 * Where a monitoring identity lands after signing in: the workspaces they are
 * authorised for, and nothing else.
 *
 * The control plane's own list at `/platform/workspaces` is every workspace on
 * the platform, because provisioning and billing need it. That is a different
 * question from "which customers may this person look at", and conflating the
 * two is what let any platform OWNER open any workspace. Administering a
 * workspace and entering it are separate authorities — `enter` re-asks this same
 * question server-side, so a workspace omitted here cannot be reached by typing
 * its id either.
 */
export default async function MonitoringHome() {
  const ctx = await requireMonitoringPage();

  const [allowed, coverage] = await Promise.all([
    authorizedTenantIds(ctx.platformUserId),
    activeCoverage(ctx.platformUserId),
  ]);

  /**
   * `null` means coverage of every workspace, so the filter is omitted rather
   * than built from a list of every tenant id. An empty array means no grants,
   * and `{ in: [] }` correctly matches nothing — the case that must not
   * accidentally become "everything".
   */
  const workspaces = await prisma.tenant.findMany({
    where: { deletedAt: null, status: 'ACTIVE', ...(allowed ? { id: { in: allowed } } : {}) },
    select: { id: true, slug: true, displayName: true, status: true },
    orderBy: { displayName: 'asc' },
  });

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1>Monitoring</h1>
        <p className="lf-muted">
          {coverage
            ? `Coverage of every workspace until ${coverage.expiresAt.toISOString().slice(0, 16).replace('T', ' ')} — ${coverage.reason}`
            : `${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'} you are authorised for.`}
        </p>
      </div>

      {workspaces.length === 0 ? (
        <EmptyState
          title="No workspaces authorised"
          description="Monitoring access is granted per workspace by the platform owner. Ask for the workspace you need, and the reason is recorded with the grant."
        />
      ) : (
        <WorkspaceTable
          headers={['Workspace', 'Slug', 'Status', '']}
          searchPlaceholder="Search workspaces…"
          rows={workspaces.map((workspace) => [
            workspace.displayName,
            workspace.slug,
            workspace.status,
            <OpenWorkspaceButton key={workspace.id} workspaceId={workspace.id} />,
          ])}
        />
      )}
    </div>
  );
}
