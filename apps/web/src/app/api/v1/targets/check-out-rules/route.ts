import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { GATEABLE_METRICS } from '@/lib/hr/checkOutQuota';
import { quotaPolicy } from '@/services/hr/checkOutQuota';

/**
 * Whether the day's targets hold somebody at their desk.
 *
 * Gated exactly as creating a target is — `leads:ASSIGN` — because it is the
 * same decision: whoever sets a hundred calls decides whether a hundred calls
 * is a condition of going home. It is deliberately not an HR permission; a
 * brokerage licensing Sales alone has no HR administrator to ask.
 */
export const GET = route({ module: 'leads', productModule: 'SALES', action: 'VIEW' }, async ({ ctx }) => ({
  policy: await quotaPolicy(ctx.tenantId),
  available: GATEABLE_METRICS,
}));

const body = z.object({
  requireTargetsBeforeCheckOut: z.boolean(),
  /**
   * Only the effort metrics. A request naming LEADS_CONVERTED is refused here
   * as well as ignored downstream, so an administrator finds out at the moment
   * they try rather than discovering weeks later that it never applied.
   */
  checkOutQuotaMetrics: z.array(z.enum(GATEABLE_METRICS)).min(1).max(GATEABLE_METRICS.length),
  /** The statutory ceiling. The database refuses anything outside this too. */
  checkOutQuotaMaxHours: z.coerce.number().int().min(4).max(16),
});

export const PUT = route(
  { module: 'leads', productModule: 'SALES', action: 'ASSIGN', body, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, body: input }) => {
    await prisma.organizationSetting.update({
      where: { tenantId: ctx.tenantId },
      data: {
        requireTargetsBeforeCheckOut: input.requireTargetsBeforeCheckOut,
        checkOutQuotaMetrics: input.checkOutQuotaMetrics,
        checkOutQuotaMaxHours: input.checkOutQuotaMaxHours,
      },
    });
    return { policy: await quotaPolicy(ctx.tenantId) };
  },
);
