import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { requireWorkspace } from '@/lib/workspace';

const paramsSchema = z.object({ workspaceSlug: z.string().min(2).max(64) });

export const GET = route(
  { module: 'leads', productModule: 'SALES', action: 'VIEW', params: paramsSchema },
  async ({ ctx, params }) => {
    await requireWorkspace(ctx, params.workspaceSlug, 'SALES');
    return prisma.lead.findMany({ where: { tenantId: ctx.tenantId, deletedAt: null }, include: { stage: true, owner: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  },
);

const bodySchema = z.object({
  fullName: z.string().min(2).max(160),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(40).optional(),
  company: z.string().max(160).optional(),
  ownerId: z.string().optional().or(z.literal('')),
});

export const POST = route(
  { module: 'leads', productModule: 'SALES', action: 'CREATE', params: paramsSchema, body: bodySchema, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, params, body }) => {
    await requireWorkspace(ctx, params.workspaceSlug, 'SALES');
    const stage = await prisma.leadStage.findFirst({ where: { tenantId: ctx.tenantId, deletedAt: null, isDefault: true } });
    if (!stage) throw NotFound('Default lead stage');
    if (body.ownerId) {
      const owner = await prisma.user.findFirst({ where: { tenantId: ctx.tenantId, id: body.ownerId, deletedAt: null, status: 'ACTIVE' } });
      if (!owner) throw NotFound('Lead owner');
    }
    const count = await prisma.lead.count({ where: { tenantId: ctx.tenantId } });
    return prisma.lead.create({
      data: {
        tenantId: ctx.tenantId,
        reference: `LEAD-${String(count + 1).padStart(6, '0')}`,
        fullName: body.fullName,
        email: body.email || null,
        phone: body.phone,
        company: body.company,
        ownerId: body.ownerId || null,
        stageId: stage.id,
        source: 'MANUAL',
        createdById: ctx.actor.id,
      },
      include: { stage: true, owner: true },
    });
  },
);
