import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Invalid } from '@/lib/errors';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';

const createBody = z
  .object({
    typeId: z.string().cuid(),
    title: z.string().min(1).max(200),
    // A task can stand alone (a personal to-do) or hang off a lead. Requiring a
    // lead is what made the standalone Tasks page unusable — there was no way to
    // create one that was not already attached to a record.
    leadId: z.string().cuid().optional(),
    // Who the task is for. Only someone who can assign across their scope may
    // set this to another user; otherwise it is silently their own.
    ownerId: z.string().cuid().optional(),
    dueAt: z.coerce.date(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();

/** Can this actor hand a task to someone other than themselves? */
function mayAssignOthers(scope: string) {
  return SCOPE_RANK[scope as keyof typeof SCOPE_RANK] >= SCOPE_RANK.TEAM;
}

export const POST = route(
  { module: 'leads', productModule: 'SALES', action: 'EDIT', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    const { ownerId, ...rest } = body;
    const scope = scopeFor(ctx, 'leads', 'EDIT');
    // Assigning to another person requires the reach to do it; without it the
    // task is your own regardless of what the payload asked for.
    let resolvedOwner = ctx.actor.id;
    if (ownerId && ownerId !== ctx.actor.id) {
      if (!mayAssignOthers(scope)) {
        throw Invalid([{ field: 'ownerId', code: 'forbidden', message: 'You can only create tasks for yourself.' }]);
      }
      const target = await prisma.user.findFirst({
        where: { tenantId: ctx.tenantId, id: ownerId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      if (!target) throw Invalid([{ field: 'ownerId', code: 'not_found', message: 'That teammate was not found.' }]);
      resolvedOwner = ownerId;
    }

    return prisma.task.create({
      data: {
        tenantId: ctx.tenantId,
        ownerId: resolvedOwner,
        createdById: ctx.actor.id,
        ...rest,
      },
      include: { type: true, owner: { select: { fullName: true } } },
    });
  },
);
