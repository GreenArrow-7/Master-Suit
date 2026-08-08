import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import DashboardCharts from './DashboardCharts';
import ListHeader from '@/components/workspace/ListHeader';

export const metadata = { title: 'Dashboards' };

export default async function DashboardsPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['dashboards', 'VIEW'] });
  const tid = ctx.tenantId;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

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
    prisma.lead.count({ where: { tenantId: tid } }),
    prisma.lead.count({ where: { tenantId: tid, createdAt: { gte: monthStart } } }),
    prisma.task.count({ where: { tenantId: tid, status: 'OPEN' } }),
    prisma.task.count({ where: { tenantId: tid, status: 'OPEN', dueAt: { lt: now } } }),
    prisma.activity.count({ where: { tenantId: tid, createdAt: { gte: monthStart } } }),
    prisma.lead.groupBy({ by: ['stageId'], where: { tenantId: tid }, _count: { id: true } }),
    prisma.lead.groupBy({ by: ['source'], where: { tenantId: tid }, _count: { id: true } }),
    prisma.lead.groupBy({ by: ['slaState'], where: { tenantId: tid }, _count: { id: true } }),
    prisma.leadStage.findMany({
      where: { tenantId: tid },
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
