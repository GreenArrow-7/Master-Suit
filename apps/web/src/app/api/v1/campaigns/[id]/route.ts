import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Invalid } from '@/lib/errors';

const params = z.object({ id: z.string().cuid() });

export const GET = route(
  { module: 'campaigns', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const campaign = await prisma.campaign.findFirst({
      where: { tenantId: ctx.tenantId, id: params.id },
      include: { _count: { select: { leads: true, opportunities: true } } },
    });
    if (!campaign) throw NotFound('Campaign');
    return campaign;
  },
);

/** Which moves the status machine allows; everything else is a 422. */
const STATUS_MOVES: Record<string, string[]> = {
  DRAFT: ['SCHEDULED', 'RUNNING', 'CANCELLED'],
  SCHEDULED: ['DRAFT', 'RUNNING', 'CANCELLED'],
  RUNNING: ['PAUSED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['RUNNING', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const patchBody = z
  .object({
    name: z.string().min(2).max(160).optional(),
    startDate: z.coerce.date().nullable().optional(),
    endDate: z.coerce.date().nullable().optional(),
    budget: z.coerce.number().min(0).nullable().optional(),
    expectedLeads: z.coerce.number().int().min(0).nullable().optional(),
    status: z.enum(['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED']).optional(),
  })
  .strict();

export const PATCH = route(
  {
    module: 'campaigns',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body: patchBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    const campaign = await prisma.campaign.findFirst({ where: { tenantId: ctx.tenantId, id: params.id } });
    if (!campaign) throw NotFound('Campaign');

    if (body.status && body.status !== campaign.status) {
      const allowed = STATUS_MOVES[campaign.status] ?? [];
      if (!allowed.includes(body.status)) {
        throw Invalid([
          {
            field: 'status',
            code: 'invalid_transition',
            message: `A ${campaign.status.toLowerCase()} campaign cannot move to ${body.status.toLowerCase()}.`,
          },
        ]);
      }
    }

    return prisma.campaign.update({
      where: { tenantId: ctx.tenantId, id: params.id },
      data: { ...body, updatedById: ctx.actor.id },
      select: { id: true, name: true, code: true, status: true, startDate: true, endDate: true },
    });
  },
);

export const DELETE = route(
  { module: 'campaigns', productModule: 'SALES', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    const campaign = await prisma.campaign.findFirst({ where: { tenantId: ctx.tenantId, id: params.id } });
    if (!campaign) throw NotFound('Campaign');
    if (campaign.status === 'RUNNING') {
      throw Invalid([
        { field: 'status', code: 'running', message: 'Pause or cancel a running campaign before deleting it.' },
      ]);
    }
    await prisma.campaign.update({
      where: { tenantId: ctx.tenantId, id: params.id },
      data: { deletedAt: new Date(), updatedById: ctx.actor.id },
    });
    return { deleted: true };
  },
);
