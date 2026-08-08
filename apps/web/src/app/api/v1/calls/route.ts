import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';

const createBody = z
  .object({
    leadId: z.string().cuid().optional(),
    contactId: z.string().cuid().optional(),
    accountId: z.string().cuid().optional(),
    campaignId: z.string().cuid().optional(),
    /** Set for a meeting held for an Event, so its recording and AI summary hang off the event. */
    eventId: z.string().cuid().optional(),
    direction: z.enum(['OUTBOUND', 'INBOUND']).default('OUTBOUND'),
    recipientNumber: z.string().min(1).max(30),
    callerNumber: z.string().max(30).optional(),
    scriptId: z.string().cuid().optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();

export const POST = route(
  { module: 'calls', productModule: 'SALES', action: 'CREATE', body: createBody, auditEvent: 'CALL_STARTED' },
  async ({ ctx, body }) => {
    return prisma.call.create({
      data: {
        tenantId: ctx.tenantId,
        callerId: ctx.actor.id,
        status: 'SCHEDULED',
        ...body,
      },
    });
  },
);

const listQuery = z
  .object({
    status: z.enum(['SCHEDULED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'FAILED', 'CANCELLED']).optional(),
    outcome: z
      .enum([
        'CONNECTED',
        'NO_ANSWER',
        'BUSY',
        'VOICEMAIL',
        'WRONG_NUMBER',
        'CALLBACK_REQUESTED',
        'NOT_INTERESTED',
        'INTERESTED',
        'QUALIFIED',
        'CONVERTED',
      ])
      .optional(),
    leadId: z.string().optional(),
    campaignId: z.string().optional(),
    eventId: z.string().optional(),
    callerId: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const scope = scopeFor(ctx, 'calls', 'VIEW');
    const where: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null };

    if (SCOPE_RANK[scope] < SCOPE_RANK.TEAM) {
      where.callerId = ctx.actor.id;
    } else if (query.callerId) {
      where.callerId = query.callerId;
    }

    if (query.status) where.status = query.status;
    if (query.outcome) where.outcome = query.outcome;
    if (query.leadId) where.leadId = query.leadId;
    if (query.campaignId) where.campaignId = query.campaignId;
    if (query.eventId) where.eventId = query.eventId;

    const data = await prisma.call.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: {
        caller: { select: { id: true, fullName: true } },
      },
    });

    return { data };
  },
);
