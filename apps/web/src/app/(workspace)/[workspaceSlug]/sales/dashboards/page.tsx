import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
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
   * Guarding each query instead — the fix applied to the other pages in this
   * audit — would leave those roles a page of zeroes, which is a worse answer
   * than a clear one. So the page now asks for what it actually reads, and the
   * sidebar asks for both (see WorkspaceSidebar): the link appears only for
   * someone who can open it, and the page refuses cleanly if reached directly.
   */
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['leads', 'VIEW'] });
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Figures follow the viewer's role scope, like every list page: a SELF-scoped
  // rep sees their own numbers, a manager the team's, an admin the org's.
  const [leadScope, taskScope, activityScope] = await Promise.all([
    visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true }),
    visibilityWhere(ctx, 'tasks', 'VIEW', { ownerField: 'ownerId' }),
    visibilityWhere(ctx, 'activities', 'VIEW', { ownerField: 'ownerId' }),
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
    prisma.task.count({ where: { ...taskScope, status: 'OPEN' } }),
    prisma.task.count({ where: { ...taskScope, status: 'OPEN', dueAt: { lt: now } } }),
    prisma.activity.count({ where: { ...activityScope, createdAt: { gte: monthStart } } }),
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
