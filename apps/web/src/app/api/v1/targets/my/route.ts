import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

export const GET = route({ module: 'leads', productModule: 'SALES', action: 'VIEW' }, async ({ ctx }) => {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);

  const targets = await prisma.employeeTarget.findMany({
    where: {
      tenantId: ctx.tenantId,
      userId: ctx.actor.id,
      periodStart: { lte: now },
      periodEnd: { gte: now },
    },
    include: { progress: { where: { dateKey: todayKey } } },
    orderBy: { metric: 'asc' },
  });

  return {
    data: targets.map((t) => ({
      ...t,
      achieved: t.progress[0]?.achieved ?? 0,
      remaining: Math.max(0, t.targetValue - (t.progress[0]?.achieved ?? 0)),
      percentage: Math.min(100, Math.round(((t.progress[0]?.achieved ?? 0) / t.targetValue) * 100)),
    })),
  };
});
