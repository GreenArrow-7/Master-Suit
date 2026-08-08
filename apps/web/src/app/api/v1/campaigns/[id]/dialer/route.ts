import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
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
  async ({ ctx, params }) => {
    const campaign = await prisma.campaign.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, status: true, name: true },
    });
    if (!campaign) throw NotFound('Campaign');

    return resumeOrStart(ctx.tenantId, ctx.actor.id, campaign.id);
  },
);

/** Queue health, for the campaign page and the leader's team view. */
export const GET = route(
  { module: 'dialer', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => queueStats(ctx.tenantId, params.id),
);
