import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';

const params = z.object({ id: z.string().cuid() });

const patchBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    triggerPhrases: z.array(z.string().min(2).max(200)).max(50).optional(),
    recommendedResponses: z.array(z.string().min(2).max(2000)).max(20).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const objection = await prisma.objection.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      include: { _count: { select: { matches: true } } },
    });
    if (!objection) throw NotFound('Objection');
    return objection;
  },
);

export const PATCH = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, body: patchBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    const existing = await prisma.objection.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw NotFound('Objection');

    /**
     * Editing the trigger phrases does not re-match the calls already analysed.
     * Deliberate: re-matching every historical call on an edit is an unbounded
     * write behind a form field, and the matches are rewritten anyway the next
     * time a call is analysed. A manager who wants the old calls re-scored
     * re-runs the analysis from the call screen.
     */
    return prisma.objection.update({
      where: { id: params.id, tenantId: ctx.tenantId },
      data: { ...body, updatedById: ctx.actor.id },
    });
  },
);

/**
 * Soft delete. The matches already recorded against past calls stay: they are
 * the record of what was said on a call, not a live reference to the playbook,
 * and a manager reading a six-month-old call should still see why it was
 * flagged. A deleted entry stops matching new calls because `matchPlaybook`
 * filters on `deletedAt: null`.
 */
export const DELETE = route(
  { module: 'calls', productModule: 'SALES', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    const existing = await prisma.objection.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw NotFound('Objection');

    await prisma.objection.update({
      where: { id: params.id, tenantId: ctx.tenantId },
      data: { deletedAt: new Date(), isActive: false, updatedById: ctx.actor.id },
    });
    return { ok: true };
  },
);
