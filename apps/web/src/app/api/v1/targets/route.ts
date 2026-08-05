import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';

const createBody = z.object({
  userId: z.string().cuid(),
  campaignId: z.string().cuid().optional(),
  metric: z.enum([
    'LEADS_ASSIGNED', 'CALLS_ATTEMPTED', 'CALLS_CONNECTED',
    'FOLLOWUPS_COMPLETED', 'INVITATIONS_SENT', 'RSVPS_CONFIRMED',
    'LEADS_QUALIFIED', 'LEADS_CONVERTED',
  ]),
  period: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).default('DAILY'),
  targetValue: z.number().int().positive(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
}).strict();

export const POST = route(
  { module: 'leads', action: 'ASSIGN', body: createBody, auditEvent: 'TARGET_CREATED' },
  async ({ ctx, body }) => {
    return prisma.employeeTarget.create({
      data: { tenantId: ctx.tenantId, createdById: ctx.actor.id, ...body },
    });
  },
);

const listQuery = z.object({
  userId: z.string().optional(),
  campaignId: z.string().optional(),
  period: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).optional(),
  active: z.enum(['true', 'false']).optional(),
}).strict();

export const GET = route(
  { module: 'leads', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const now = new Date();
    const scope = scopeFor(ctx, 'leads', 'VIEW');
    const where: Record<string, unknown> = { tenantId: ctx.tenantId };

    if (SCOPE_RANK[scope] < SCOPE_RANK.ORGANIZATION) {
      where.userId = query.userId ?? ctx.actor.id;
    } else if (query.userId) {
      where.userId = query.userId;
    }

    if (query.campaignId) where.campaignId = query.campaignId;
    if (query.period) where.period = query.period;
    if (query.active === 'true') {
      where.periodStart = { lte: now };
      where.periodEnd = { gte: now };
    }

    const targets = await prisma.employeeTarget.findMany({
      where,
      include: { progress: true, user: { select: { id: true, fullName: true } } },
      orderBy: { periodStart: 'desc' },
      take: 100,
    });

    return { data: targets };
  },
);
