import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Ctx } from '@/lib/security/rbac';
import type { TargetMetric } from '@prisma/client';

/**
 * Target progress: how it is counted, and how it is written.
 *
 * The targets screen tells managers "Progress counts automatically as calls,
 * follow-ups and conversions are logged." Until now that sentence was false:
 * the only writer of TargetProgress in the product was a POST endpoint that no
 * component, worker or listener ever called, so every leaderboard and target
 * bar sat at zero — which is exactly what the user's screen recording showed,
 * row after row of "followups completed / calls connected / leads converted"
 * with no numbers beside them.
 *
 * `recordTargetProgress` is called from the services that record the work
 * itself — a call completing, a follow-up done, a lead qualifying or
 * converting. It mirrors `notifyCrm`'s contract: it NEVER throws, because a
 * call log must not fail to save over a counter.
 */

/** One day-bucket row, the shape both home screens and the targets page read. */
export interface ProgressRow {
  dateKey: string;
  achieved: number;
}

/**
 * Achieved within the target's own window, not just today.
 *
 * This helper existed only on /sales/targets, which is why that page showed
 * 38% while the manager's overview showed 0% for the same person and the same
 * target: the overview counted only today's row. One copy, used everywhere,
 * so the two screens cannot disagree again.
 */
export function achievedWithin(target: { periodStart: Date; periodEnd: Date; progress: ProgressRow[] }): number {
  const from = target.periodStart.toISOString().slice(0, 10);
  const to = target.periodEnd.toISOString().slice(0, 10);
  return target.progress
    .filter((row) => row.dateKey >= from && row.dateKey <= to)
    .reduce((sum, row) => sum + row.achieved, 0);
}

/**
 * Count one unit of work against every active target the user holds for the
 * metric. Multiple targets can overlap (a daily and a monthly one for the same
 * metric); the work counts toward each, because each is a promise about the
 * same activity over a different window.
 */
export async function recordTargetProgress(
  ctx: Ctx,
  userId: string | null | undefined,
  metric: TargetMetric,
  increment = 1,
): Promise<void> {
  if (!userId) return;
  try {
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    const targets = await prisma.employeeTarget.findMany({
      where: { tenantId: ctx.tenantId, userId, metric, periodStart: { lte: now }, periodEnd: { gte: now } },
      select: { id: true },
    });
    for (const target of targets) {
      await prisma.targetProgress.upsert({
        where: { tenantId: ctx.tenantId, targetId_dateKey: { targetId: target.id, dateKey } },
        create: { tenantId: ctx.tenantId, targetId: target.id, userId, dateKey, achieved: increment },
        update: { achieved: { increment } },
      });
    }
  } catch (err) {
    logger.error({ err, metric, userId }, 'target progress write failed');
  }
}
