import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { coachingCallList, coachingAnalytics } from '@/services/shared/coachingInsights';

/**
 * The coaching dashboard's data. `view=calls` is the list, `view=analytics` the
 * derived numbers; one route because they share every filter and the same
 * visibility resolution, and the page requests both.
 *
 * Gated the way the other report screens are (`calls:VIEW`, like call-audits):
 * the rows are calls, and the caller's scope on `calls` decides which people's
 * calls appear, via visibleCallerIds. A rep with OWN scope sees a dashboard of
 * exactly themselves, which is also useful.
 */
const query = z
  .object({
    view: z.enum(['calls', 'analytics']).default('calls'),
    callerId: z.string().cuid().optional(),
    stageId: z.string().cuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    /** Defaults off here so an integration sees every call unless it asks. */
    analysed: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

/**
 * Per-call and team coaching metrics — sentiment, talk ratio, audit scores,
 * objection handling — are derived from what was said on each call. They are
 * served to a monitoring grant only when it is marked sensitive; whether some
 * aggregate subset should be ordinary monitoring is an open owner decision, and
 * until it is made none of it is.
 */
export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', query, sensitive: 'call coaching metrics' },
  async ({ ctx, query }) => {
    const filters = {
      callerId: query.callerId,
      stageId: query.stageId,
      from: query.from,
      to: query.to,
      analysedOnly: query.analysed === 'true',
    };
    if (query.view === 'analytics') return coachingAnalytics(ctx, filters);
    return { data: await coachingCallList(ctx, filters, query.limit) };
  },
);
