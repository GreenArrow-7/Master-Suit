import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { requireWorkspace } from '@/lib/workspace';
import { visibilityWhere } from '@/lib/security/visibility';

const paramsSchema = z.object({ workspaceSlug: z.string().min(2).max(64) });

export const GET = route(
  { module: 'leads', productModule: 'SALES', action: 'VIEW', params: paramsSchema },
  async ({ ctx, params }) => {
    await requireWorkspace(ctx, params.workspaceSlug, 'SALES');
    // Same row filter as /api/v1/leads — this legacy path previously returned
    // every lead in the tenant regardless of the caller's scope.
    const scope = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
    return prisma.lead.findMany({
      where: { ...scope, deletedAt: null },
      include: { stage: true, owner: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
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
  {
    module: 'leads',
    productModule: 'SALES',
    action: 'CREATE',
    params: paramsSchema,
    body: bodySchema,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, params, body }) => {
    await requireWorkspace(ctx, params.workspaceSlug, 'SALES');
    const stage = await prisma.leadStage.findFirst({
      where: { tenantId: ctx.tenantId, deletedAt: null, isDefault: true },
    });
    if (!stage) throw NotFound('Default lead stage');
    if (body.ownerId) {
      const owner = await prisma.user.findFirst({
        where: { tenantId: ctx.tenantId, id: body.ownerId, deletedAt: null, status: 'ACTIVE' },
      });
      if (!owner) throw NotFound('Lead owner');
    }
    // Timestamp-based reference: the previous count+1 raced under concurrent
    // creates against the unique index.
    return prisma.lead.create({
      data: {
        tenantId: ctx.tenantId,
        reference: `LEAD-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 2)
          .toString(36)
          .toUpperCase()
          .padStart(2, '0')}`,
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
