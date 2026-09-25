import { prisma } from '@/lib/db';
import type { Ctx } from '@/lib/security/rbac';
import { achievedWithin } from '@/services/targets/progress';
import {
  enforcedMetrics,
  quotaVerdict,
  type QuotaPolicy,
  type QuotaRow,
  type QuotaVerdict,
} from '@/lib/hr/checkOutQuota';

/**
 * The day's targets, read at the moment somebody tries to leave.
 *
 * The rules are in lib/hr/checkOutQuota.ts. This is the half that touches the
 * database: which daily targets the person holds, and how much of each they
 * have done.
 *
 * No new model. `EmployeeTarget` already says "a hundred calls attempted,
 * daily, from this date to that one", `TargetProgress` already counts them as
 * calls are logged, and `achievedWithin` already sums a target's own window. A
 * separate quota table would have been a second, quieter copy of all three,
 * and the first week a manager edited one and not the other, the floor would
 * have stopped trusting both.
 */

/**
 * The workspace's rule.
 *
 * On OrganizationSetting beside `dialerMaxAttempts` and `visitGeofenceRadiusM`,
 * not in the HR policy JSON where the other attendance parameters live. That
 * one's writer refuses anybody who is not an HR administrator, and its settings
 * screen is behind the HRMS module — so on a brokerage licensing Sales alone,
 * the rule would have existed with no way to switch it on.
 */
export async function quotaPolicy(tenantId: string): Promise<QuotaPolicy> {
  const setting = await prisma.organizationSetting.findUnique({
    where: { tenantId },
    select: {
      requireTargetsBeforeCheckOut: true,
      checkOutQuotaMetrics: true,
      checkOutQuotaMaxHours: true,
    },
  });
  return {
    requireTargetsBeforeCheckOut: setting?.requireTargetsBeforeCheckOut ?? false,
    checkOutQuotaMetrics: setting?.checkOutQuotaMetrics ?? ['CALLS_ATTEMPTED'],
    checkOutQuotaMaxHours: setting?.checkOutQuotaMaxHours ?? 10,
  };
}

/** Targets are held by the sales user, not the employee profile. */
export async function checkOutQuota(
  ctx: Ctx,
  workedMinutes: number | null,
  now = new Date(),
): Promise<QuotaVerdict> {
  const policy = await quotaPolicy(ctx.tenantId);
  const metrics = enforcedMetrics(policy);
  if (metrics.length === 0) {
    return { blocked: false, rows: [], message: '', releasedByHours: false };
  }

  const targets = await prisma.employeeTarget.findMany({
    where: {
      tenantId: ctx.tenantId,
      userId: ctx.actor.id,
      // Daily only. A monthly target is a plan, not a condition of going home
      // on the fourteenth.
      period: 'DAILY',
      metric: { in: metrics },
      periodStart: { lte: now },
      periodEnd: { gte: now },
    },
    select: {
      metric: true,
      targetValue: true,
      periodStart: true,
      periodEnd: true,
      progress: { select: { dateKey: true, achieved: true } },
    },
  });

  /**
   * Two targets for the same metric are summed into one row rather than shown
   * twice. A manager who sets "80 calls" and later "100 calls" for the same day
   * has changed their mind, not asked for 180 — and the agent should be told a
   * number, not an argument between two rows.
   */
  const byMetric = new Map<string, QuotaRow>();
  for (const target of targets) {
    const achieved = achievedWithin(target);
    const existing = byMetric.get(target.metric);
    if (!existing || target.targetValue > existing.target) {
      byMetric.set(target.metric, {
        metric: target.metric,
        target: target.targetValue,
        achieved,
        remaining: Math.max(0, target.targetValue - achieved),
      });
    }
  }

  return quotaVerdict([...byMetric.values()], workedMinutes, policy);
}

/** Minutes since the open check-in, or null when there is no open one. */
export function workedMinutesSince(checkInAt: Date | null | undefined, now = new Date()): number | null {
  if (!checkInAt) return null;
  return Math.max(0, Math.round((now.getTime() - checkInAt.getTime()) / 60_000));
}
