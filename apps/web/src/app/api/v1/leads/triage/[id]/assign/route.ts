import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { assignFromTriage } from '@/services/distribution/triageQueue';

/**
 * A manager places a waiting lead.
 *
 * `leads:ASSIGN` is asserted by the kernel *and* re-asserted in the service,
 * because the service is also reachable from the worker path and authorization
 * must not depend on which door was used. Scope is checked against the lead, so
 * holding the verb is not enough — the lead has to be inside the actor's
 * visibility.
 */
const params = z.object({ id: z.string().min(1) });

const body = z.object({
  toUserId: z.string().min(1),
  reason: z.string().max(500).optional(),
  /**
   * Optional idempotency key, honoured for people as well as machines: a
   * double-submitted form is one decision delivered twice. Contracts §2.2.
   */
  requestKey: z.string().max(200).optional(),
});

export const POST = route(
  { module: 'leads', productModule: 'SALES', action: 'ASSIGN', body, params },
  async ({ ctx, body: input, params: p }) => {
    const result = await assignFromTriage({
      ctx,
      entryId: p.id,
      toUserId: input.toUserId,
      reason: input.reason,
      requestKey: input.requestKey,
    });
    return { data: result };
  },
);
