import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { Conflict } from '@/lib/errors';

/**
 * Buyer-type playbooks: how the workspace sells to one kind of customer.
 * Workspace-shared like the objection playbook (module 'calls', no owner
 * scoping): a playbook is leadership's strategy, not somebody's record.
 */

const fields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  leadTags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  discoveryQuestions: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  approvedClaims: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  objectionGuidance: z.string().max(4000).optional(),
  closingStrategy: z.string().max(4000).optional(),
  followUpStrategy: z.string().max(4000).optional(),
  complianceNotes: z.string().max(4000).optional(),
};

export const GET = route({ module: 'calls', productModule: 'SALES', action: 'VIEW' }, async ({ ctx }) => {
  const data = await prisma.salesPlaybook.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    take: 100,
  });
  return { data };
});

export const POST = route(
  {
    module: 'calls',
    productModule: 'SALES',
    action: 'CREATE',
    body: z.object(fields).strict(),
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) =>
    withTx(ctx.tenantId, async (tx) => {
      const clash = await tx.salesPlaybook.findFirst({
        where: { tenantId: ctx.tenantId, name: body.name, deletedAt: null },
        select: { id: true },
      });
      if (clash) throw Conflict(`A playbook named "${body.name}" already exists.`);

      // One default at a time: making this one the fallback demotes the rest,
      // in the same transaction, so there is never a moment with two.
      if (body.isDefault) {
        await tx.salesPlaybook.updateMany({
          where: { tenantId: ctx.tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.salesPlaybook.create({
        data: { tenantId: ctx.tenantId, createdById: ctx.actor.id, updatedById: ctx.actor.id, ...body },
      });
    }),
);
