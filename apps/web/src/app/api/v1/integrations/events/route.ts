import { z } from 'zod';

import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

/**
 * What each integration has actually been doing.
 *
 * The board at `/api/v1/integrations` answers "is it connected and does the
 * credential still work". This answers the question that comes next, and the one
 * §33 is really about: leads stopped arriving on Tuesday — what happened?
 *
 * A log, so it is read-only and newest-first. Filters exist for the two ways
 * people actually arrive here: from a provider tile ("show me Meta"), and from a
 * suspicion that something is broken ("show me what failed").
 */
const query = z.object({
  provider: z.string().max(50).optional(),
  direction: z.enum(['INBOUND', 'OUTBOUND']).optional(),
  outcome: z.enum(['OK', 'SKIPPED', 'FAILED']).optional(),
  /** ISO instant. Defaults to the whole retained window, which is 30 days. */
  since: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /**
   * Keyset rather than an offset. These rows arrive continuously, so an offset
   * page two would re-show rows page one already had every time a webhook landed
   * mid-read.
   */
  before: z.coerce.date().optional(),
});

export const GET = route({ module: 'integrations', action: 'VIEW', query }, async ({ ctx, query }) => {
  const createdAt =
    query.since || query.before
      ? { ...(query.since ? { gte: query.since } : {}), ...(query.before ? { lt: query.before } : {}) }
      : undefined;

  const events = await prisma.integrationEvent.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.direction ? { direction: query.direction } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(createdAt ? { createdAt } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: query.limit,
  });

  return {
    events,
    // The cursor for the next page, or null at the end. Handing it back beats
    // making every caller know that `before` takes the last row's createdAt.
    nextBefore: events.length === query.limit ? (events[events.length - 1]?.createdAt ?? null) : null,
  };
});
