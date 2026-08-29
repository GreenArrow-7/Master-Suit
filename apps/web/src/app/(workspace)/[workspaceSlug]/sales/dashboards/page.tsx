import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import DashboardCharts from './DashboardCharts';
import ListHeader from '@/components/workspace/ListHeader';

export const metadata = { title: 'Dashboards' };

export default async function DashboardsPage() {
  /**
   * Gated on `leads:VIEW`, not `dashboards:VIEW`.
   *
   * Every figure here is derived from leads — the totals, the month-on-month
   * count, the stage, source and SLA breakdowns. `dashboards:VIEW` was the
   * declared gate, so a role holding it without `leads:VIEW` reached the page
   * and was then refused deeper in, when `visibilityWhere` threw on a NONE
   * scope. Twenty-two roles in this database are in exactly that position.
   *
   * So the page now asks for what it actually reads, and the sidebar asks for
   * both (see WorkspaceSidebar): the link appears only for someone who can
   * open it, and the page refuses cleanly if reached directly. The secondary
   * figures are guarded individually below — see the note on the scopes.
   */
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['leads', 'VIEW'] });
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Figures follow the viewer's role scope, like every list page: a SELF-scoped
  // rep sees their own numbers, a manager the team's, an admin the org's.
  //
  // Leads are the gate, so that scope is unconditional. Tasks and activities
  // are separate grants and were asked for regardless — `visibilityWhere`
  // throws Forbidden on a NONE scope, so a role holding leads without
  // activities (call_qa, in both tenants here) crashed the whole page for the
  // want of one tile. A missing permission drops its tile, not the dashboard.
  const canSeeTasks = can(ctx, 'tasks', 'VIEW');
  const canSeeActivities = can(ctx, 'activities', 'VIEW');
  const [leadScope, taskScope, activityScope] = await Promise.all([
    visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true }),
    canSeeTasks ? visibilityWhere(ctx, 'tasks', 'VIEW', { ownerField: 'ownerId' }) : null,
    canSeeActivities ? visibilityWhere(ctx, 'activities', 'VIEW', { ownerField: 'ownerId' }) : null,
  ]);

  const [
    totalLeads,
    newThisMonth,
    openTasks,
    overdueTasks,
    activitiesThisMonth,
    leadsByStageRaw,
    leadsBySourceRaw,
    slaRaw,
    stages,
  ] = await Promise.all([
    prisma.lead.count({ where: leadScope }),
    prisma.lead.count({ where: { ...leadScope, createdAt: { gte: monthStart } } }),
    taskScope ? prisma.task.count({ where: { ...taskScope, status: 'OPEN' } }) : null,
    taskScope ? prisma.task.count({ where: { ...taskScope, status: 'OPEN', dueAt: { lt: now } } }) : null,
    activityScope ? prisma.activity.count({ where: { ...activityScope, createdAt: { gte: monthStart } } }) : null,
    prisma.lead.groupBy({ by: ['stageId'], where: leadScope, _count: { id: true } }),
    prisma.lead.groupBy({ by: ['source'], where: leadScope, _count: { id: true } }),
    prisma.lead.groupBy({ by: ['slaState'], where: leadScope, _count: { id: true } }),
    prisma.leadStage.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { position: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const leadsByStage = stages
    .map((s) => {
      const match = leadsByStageRaw.find((r) => r.stageId === s.id);
      return { name: s.name, count: match?._count.id ?? 0 };
    })
    .filter((s) => s.count > 0);

  const leadsBySource = leadsBySourceRaw.map((r) => ({
    name: r.source.replace(/_/g, ' '),
    count: r._count.id,
  }));

  const slaStats = slaRaw.map((r) => ({
    name: r.slaState.replace(/_/g, ' '),
    key: r.slaState,
    count: r._count.id,
  }));

  return (
    <>
      <ListHeader title="Dashboard" description="Sales overview for this month" />
      <DashboardCharts
        totalLeads={totalLeads}
        newThisMonth={newThisMonth}
        openTasks={openTasks}
        overdueTasks={overdueTasks}
        activitiesThisMonth={activitiesThisMonth}
        leadsByStage={leadsByStage}
        leadsBySource={leadsBySource}
        slaStats={slaStats}
      />
    </>
  );
}
