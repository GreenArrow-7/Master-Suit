import { z } from 'zod';
import { route } from '@/lib/api/handler';
import {
  activityCompliance,
  chasingQueue,
  conversion,
  funnel,
  interactionFeed,
  performerBoard,
  subtree,
} from '@/services/leadership/rollups';
import { profitAndLoss } from '@/services/leadership/pl';

const query = z
  .object({
    view: z
      .enum(['overview', 'funnel', 'conversion', 'compliance', 'board', 'feed', 'chasing', 'pl'])
      .default('overview'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    metric: z.enum(['bookings', 'revenue', 'leads', 'activities']).default('revenue'),
    grouping: z.enum(['team', 'region', 'branch']).default('team'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.to >= v.from, {
    path: ['to'],
    message: 'The range ends before it starts.',
  });

/** This month so far, when nothing is asked for. */
function defaultRange(from?: Date, to?: Date) {
  const end = to ?? new Date();
  if (from) return { from, to: end };
  const start = new Date(end);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return { from: start, to: end };
}

/**
 * The leader's numbers.
 *
 * Scoped once, at the top, by `subtree` — which reads the scope off the
 * `reports:VIEW` grant the caller already holds. Every view below is handed the
 * same list of people, so no two of them can disagree about who the team is.
 */
export const GET = route(
  { module: 'reports', productModule: 'SALES', action: 'VIEW', query },
  async ({ ctx, query: q }) => {
    const range = defaultRange(q.from, q.to);
    const userIds = await subtree(ctx);

    switch (q.view) {
      case 'funnel':
        return { range, data: await funnel(ctx.tenantId, userIds, range) };
      case 'conversion':
        return { range, data: await conversion(ctx.tenantId, userIds, range) };
      case 'compliance':
        return { range, data: await activityCompliance(ctx.tenantId, userIds, range) };
      case 'board':
        return { range, metric: q.metric, data: await performerBoard(ctx.tenantId, userIds, range, q.metric) };
      case 'feed':
        return { range, data: await interactionFeed(ctx.tenantId, userIds, range, q.limit) };
      case 'chasing':
        return { data: await chasingQueue(ctx.tenantId, userIds, new Date(), q.limit) };
      case 'pl':
        return profitAndLoss(ctx.tenantId, userIds, range.from, range.to, q.grouping);
      default: {
        // The dashboard's first paint. One round trip rather than six, because
        // six independently-ranged calls is how two panels end up describing
        // different fortnights.
        const [funnelRows, conversionRates, board, chasing] = await Promise.all([
          funnel(ctx.tenantId, userIds, range),
          conversion(ctx.tenantId, userIds, range),
          performerBoard(ctx.tenantId, userIds, range, q.metric),
          chasingQueue(ctx.tenantId, userIds, new Date(), 10),
        ]);
        return { range, funnel: funnelRows, conversion: conversionRates, board, chasing };
      }
    }
  },
);
