import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { allocate, headroom, poolDepth, routeLeads } from '@/services/distribution/allocation';
import { askForLeads, cancelRequest, decideRequest, pendingRequests } from '@/services/distribution/requests';

const poolFilter = z
  .object({
    stageId: z.string().cuid().optional(),
    source: z.string().max(40).optional(),
    territoryId: z.string().cuid().optional(),
    campaignId: z.string().cuid().optional(),
  })
  .strict();

const listQuery = z
  .object({
    view: z.enum(['requests', 'pool', 'headroom']).default('requests'),
    userIds: z.string().max(2000).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

/** The queue, how deep the pool is, or what a set of people can still take. */
export const GET = route(
  { module: 'allocation', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    if (query.view === 'pool') return { depth: await poolDepth(ctx.tenantId) };
    if (query.view === 'headroom') {
      const ids = (query.userIds ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return { data: await headroom(ctx.tenantId, ids) };
    }
    return { data: await pendingRequests(ctx.tenantId, query.limit) };
  },
);

const askBody = z
  .object({
    action: z.literal('ASK'),
    requested: z.coerce.number().int().min(1).max(5000),
    reason: z.string().max(1000).optional(),
  })
  .strict();

const allocateBody = z
  .object({
    action: z.literal('ALLOCATE'),
    userIds: z.array(z.string().min(1)).min(1).max(100),
    count: z.coerce.number().int().min(1).max(5000),
    filter: poolFilter.optional(),
    reason: z.string().max(1000).optional(),
  })
  .strict();

const routeBody = z
  .object({
    action: z.literal('ROUTE'),
    leadIds: z.array(z.string().cuid()).min(1).max(500),
    toUserId: z.string().min(1).optional(),
    toTeamId: z.string().cuid().optional(),
    reason: z.string().min(3).max(1000),
  })
  .strict();

/**
 * Asking, allocating, or routing across teams.
 *
 * `allocate` and `routeLeads` check `allocation:APPROVE` themselves — asking is
 * everybody's, handing out is not — so the route gate is the weaker of the two
 * and the services hold the real line.
 */
export const POST = route(
  {
    module: 'allocation',
    productModule: 'SALES',
    action: 'CREATE',
    body: z.discriminatedUnion('action', [askBody, allocateBody, routeBody]),
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => {
    if (body.action === 'ASK') return askForLeads({ ctx, requested: body.requested, reason: body.reason });
    if (body.action === 'ALLOCATE') {
      return allocate({ ctx, userIds: body.userIds, count: body.count, filter: body.filter, reason: body.reason });
    }
    return routeLeads({
      ctx,
      leadIds: body.leadIds,
      toUserId: body.toUserId,
      toTeamId: body.toTeamId,
      reason: body.reason,
    });
  },
);

const decideBody = z
  .object({
    action: z.literal('DECIDE'),
    requestId: z.string().cuid(),
    approve: z.boolean(),
    note: z.string().max(1000).optional(),
    grant: z.coerce.number().int().min(1).max(5000).optional(),
    filter: poolFilter.optional(),
  })
  .strict();

const cancelBody = z.object({ action: z.literal('CANCEL'), requestId: z.string().cuid() }).strict();

export const PATCH = route(
  {
    module: 'allocation',
    productModule: 'SALES',
    action: 'VIEW',
    body: z.discriminatedUnion('action', [decideBody, cancelBody]),
    auditEvent: 'STAGE_CHANGED',
  },
  async ({ ctx, body }) => {
    if (body.action === 'CANCEL') return cancelRequest({ ctx, requestId: body.requestId });
    return decideRequest({
      ctx,
      requestId: body.requestId,
      approve: body.approve,
      note: body.note,
      grant: body.grant,
      filter: body.filter,
    });
  },
);
