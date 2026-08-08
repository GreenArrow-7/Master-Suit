import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { loadQueue } from '@/services/dialer/queue';

const params = z.object({ id: z.string().cuid() });

const listQuery = z
  .object({
    status: z
      .enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CALLBACK', 'SKIPPED', 'EXHAUSTED', 'SUPPRESSED'])
      .optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

export const GET = route(
  { module: 'dialer', productModule: 'SALES', action: 'VIEW', params, query: listQuery },
  async ({ ctx, params, query }) => {
    const data = await prisma.campaignContact.findMany({
      where: {
        tenantId: ctx.tenantId,
        campaignId: params.id,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { position: 'asc' },
      take: query.limit,
      select: {
        id: true,
        displayName: true,
        phone: true,
        status: true,
        attempts: true,
        outcome: true,
        lastAttemptAt: true,
        nextAttemptAt: true,
        leadId: true,
        notes: true,
      },
    });

    return { data };
  },
);

const loadBody = z
  .object({
    /** A curated marketing list… */
    listId: z.string().cuid().optional(),
    /** …or a filter over leads. One of the two is required. */
    stageIds: z.array(z.string().cuid()).max(20).optional(),
    ownerIds: z.array(z.string().cuid()).max(50).optional(),
    limit: z.coerce.number().int().min(1).max(5_000).optional(),
  })
  .strict();

/**
 * Loads the queue.
 *
 * `dialer:CREATE` rather than `VIEW`: choosing who the floor rings today is a
 * campaign decision. An agent works a queue; they do not decide what is in it.
 *
 * Re-runnable — it tops the queue up rather than replacing it, because building
 * a campaign is an interrupted, resumed job and a second press should not wipe
 * the calls already made.
 */
export const POST = route(
  {
    module: 'dialer',
    productModule: 'SALES',
    action: 'CREATE',
    params,
    body: loadBody,
    auditEvent: 'IMPORT_STARTED',
    // Each load scans up to 5 000 leads; this is not an endpoint to hold down.
    rateLimit: { max: 20, windowSeconds: 300 },
  },
  async ({ ctx, params, body }) => {
    const campaign = await prisma.campaign.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!campaign) throw NotFound('Campaign');

    return loadQueue({
      tenantId: ctx.tenantId,
      actorId: ctx.actor.id,
      campaignId: campaign.id,
      listId: body.listId,
      stageIds: body.stageIds,
      ownerIds: body.ownerIds,
      limit: body.limit,
    });
  },
);
