import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { prisma } from '@/lib/db';
import DashboardCharts from './DashboardCharts';
import ListHeader from '@/components/workspace/ListHeader';

export const metadata = { title: 'Dashboards' };

export default async function DashboardsPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['dashboards', 'VIEW'] });
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
