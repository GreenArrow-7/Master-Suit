import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';

const params = z.object({ id: z.string().cuid() });

const patchBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(1000).nullable().optional(),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    leadTags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    discoveryQuestions: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
    approvedClaims: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
    objectionGuidance: z.string().max(4000).nullable().optional(),
    closingStrategy: z.string().max(4000).nullable().optional(),
    followUpStrategy: z.string().max(4000).nullable().optional(),
    complianceNotes: z.string().max(4000).nullable().optional(),
  })
  .strict();

export const PATCH = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, body: patchBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) =>
    withTx(ctx.tenantId, async (tx) => {
      const existing = await tx.salesPlaybook.findFirst({
        where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw NotFound('Playbook');

      if (body.isDefault) {
        await tx.salesPlaybook.updateMany({
          where: { tenantId: ctx.tenantId, isDefault: true, id: { not: params.id } },
          data: { isDefault: false },
        });
      }

      return tx.salesPlaybook.update({
        where: { id: params.id, tenantId: ctx.tenantId },
        data: { ...body, updatedById: ctx.actor.id },
      });
    }),
);

/** Soft: a retired playbook is still what old calls were coached against. */
export const DELETE = route(
  { module: 'calls', productModule: 'SALES', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) =>
    withTx(ctx.tenantId, async (tx) => {
      const existing = await tx.salesPlaybook.findFirst({
        where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw NotFound('Playbook');
      return tx.salesPlaybook.update({
        where: { id: params.id, tenantId: ctx.tenantId },
        data: { deletedAt: new Date(), isActive: false, isDefault: false, updatedById: ctx.actor.id },
        select: { id: true, deletedAt: true },
      });
    }),
);
