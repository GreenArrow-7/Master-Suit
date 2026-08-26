import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { resumeOrStart } from '@/services/dialer/session';
import { queueStats } from '@/services/dialer/queue';

const params = z.object({ id: z.string().cuid() });

/**
 * Start a dialer, or get back the one already running.
 *
 * Idempotent, and that is the acceptance criterion: this is what the screen
 * calls on every load, so a refresh returns the same session holding the same
 * contact rather than starting a second one or losing the first.
 */
export const POST = route(
  { module: 'dialer', productModule: 'SALES', action: 'VIEW', params, auditEvent: 'CALL_STARTED' },
  // The campaign lookup that used to be here selected `status` and `name` and
  // read neither — the same selected-and-unread column that let a cancelled
  // campaign be dialled. `resumeOrStart` now loads the campaign itself, refuses
  // on its status, and raises the identical NotFound when there is no such row,
  // so repeating the query here would only be a second chance to disagree.
  async ({ ctx, params }) => resumeOrStart(ctx.tenantId, ctx.actor.id, params.id),
);

/** Queue health, for the campaign page and the leader's team view. */
export const GET = route(
  { module: 'dialer', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => queueStats(ctx.tenantId, params.id),
);
