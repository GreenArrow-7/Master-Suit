import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { listDeliveries, replayDelivery } from '@/services/leads/deliveries';

const params = z.object({ provider: z.string().min(2).max(40) });

/** A lead source's deliveries, newest first, 25 a page by `?cursor=` (M6-21, M6-22). */
export const GET = route(
  {
    module: 'integrations',
    productModule: LEAD_MODULES,
    action: 'VIEW',
    params,
    query: z.object({ cursor: z.string().cuid().optional() }),
  },
  ({ ctx, params, query }) => listDeliveries(ctx, params.provider, query.cursor),
);

/** Replay one the queue is done with: its stored body queued again, audited in services/leads/deliveries.ts. */
export const POST = route(
  {
    module: 'integrations',
    productModule: LEAD_MODULES,
    action: 'MANAGE_CONFIGURATION',
    params,
    body: z.object({ id: z.string().cuid() }).strict(),
  },
  ({ ctx, params, body }) => replayDelivery(ctx, params.provider, body.id),
);
