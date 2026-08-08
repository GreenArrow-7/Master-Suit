import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { punch } from '@/services/visits/punch';

const params = z.object({ id: z.string().cuid() });

const body = z
  .object({
    direction: z.enum(['in', 'out']),
    /**
     * Straight from `navigator.geolocation`. Taken as measurements and nothing
     * more — there is no "I am inside the fence" flag to send, because that is a
     * boolean the page could simply set.
     */
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    accuracyM: z.coerce.number().min(0).max(100_000).optional(),
  })
  .strict();

/**
 * The site punch.
 *
 * Browser geolocation, captured at an explicit checkpoint while the tab is
 * open — the web has no background location and this does not pretend
 * otherwise. What the server does with it is measure: distance to the property,
 * travel speed since the agent's last punch, and whether the coordinates repeat.
 *
 * A punch outside every fence is recorded and flagged, never discarded and
 * never refused. Silently accepting it hides the problem; refusing it means an
 * agent standing at a client's door cannot check in, and they will stop using
 * the register altogether.
 */
export const POST = route(
  {
    module: 'visits',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body,
    auditEvent: 'STAGE_CHANGED',
    // A punch is a physical act; nobody performs one thirty times a minute.
    rateLimit: { max: 30, windowSeconds: 300 },
  },
  async ({ ctx, params, body }) =>
    punch({
      ctx,
      visitId: params.id,
      direction: body.direction,
      coordinates: { latitude: body.latitude, longitude: body.longitude, accuracyM: body.accuracyM },
    }),
);
