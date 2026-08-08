import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { recalculateProjectRollups } from '@/services/inventory/rollups';

const params = z.object({ id: z.string().cuid() });

const createBody = z
  .object({
    name: z.string().min(1).max(120),
    unitType: z.string().min(1).max(40),
    bedrooms: z.number().int().min(0).max(20).optional(),
    bathrooms: z.number().int().min(0).max(20).optional(),
    carpetAreaSqft: z.number().int().positive().max(1_000_000).optional(),
    builtUpAreaSqft: z.number().int().positive().max(1_000_000).optional(),
    price: z.number().nonnegative().optional(),
    floorPlanKey: z.string().max(500).optional(),
    position: z.number().int().min(0).max(999).default(0),
  })
  .strict();

/**
 * Unit plans are where the catalogue's pricing comes from.
 *
 * Creating one recalculates the project's price band, area band, rate per
 * square foot and unit-type list in the same transaction. Doing it afterwards —
 * or on a schedule — means a window in which the catalogue filters on a price
 * band that does not match the plans a salesperson can see on the same screen.
 */
export const POST = route(
  {
    module: 'projects',
    productModule: 'SALES',
    action: 'CREATE',
    params,
    body: createBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, params, body }) => {
    const project = await prisma.project.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, currency: true },
    });
    if (!project) throw NotFound('Project');

    return withTx(ctx.tenantId, async (tx) => {
      const plan = await tx.unitPlan.create({
        data: {
          tenantId: ctx.tenantId,
          projectId: project.id,
          currency: project.currency,
          createdById: ctx.actor.id,
          ...body,
        },
      });
      const rollups = await recalculateProjectRollups(tx, ctx.tenantId, project.id);
      return { plan, rollups };
    });
  },
);

const deleteQuery = z.object({ planId: z.string().cuid() }).strict();

/**
 * Removing a plan leaves any units built from it in place, with their plan
 * reference nulled by the schema. Deleting the units too would silently destroy
 * inventory that may be held or sold — the plan is a template, not a parent.
 */
export const DELETE = route(
  {
    module: 'projects',
    productModule: 'SALES',
    action: 'DELETE',
    params,
    query: deleteQuery,
    auditEvent: 'RECORD_DELETED',
  },
  async ({ ctx, params, query }) => {
    return withTx(ctx.tenantId, async (tx) => {
      const { count } = await tx.unitPlan.deleteMany({
        where: { id: query.planId, tenantId: ctx.tenantId, projectId: params.id },
      });
      if (count === 0) throw NotFound('Unit plan');
      const rollups = await recalculateProjectRollups(tx, ctx.tenantId, params.id);
      return { deleted: count, rollups };
    });
  },
);
