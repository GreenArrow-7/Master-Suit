import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { Invalid, NotFound } from '@/lib/errors';
import { recalculateProjectRollups } from '@/services/inventory/rollups';
import { releaseExpiredHolds } from '@/services/inventory/unitStatus';
import { UNIT_STATUSES } from '@/services/inventory/unitStatus';

const params = z.object({ id: z.string().cuid() });

const listQuery = z
  .object({
    status: z.enum(UNIT_STATUSES).optional(),
    tower: z.string().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict();

export const GET = route(
  { module: 'projects', productModule: 'SALES', action: 'VIEW', params, query: listQuery },
  async ({ ctx, params, query }) => {
    // Expired holds are returned to the market at the moment someone looks,
    // rather than by a sweeper that runs over every tenant to change nothing.
    // Without this the availability count is right and the unit list is wrong.
    await releaseExpiredHolds(ctx.tenantId, params.id);

    const units = await prisma.unitInventory.findMany({
      where: {
        tenantId: ctx.tenantId,
        projectId: params.id,
        ...(query.status ? { status: query.status } : {}),
        ...(query.tower ? { tower: query.tower } : {}),
      },
      orderBy: [{ tower: 'asc' }, { floor: 'asc' }, { unitNumber: 'asc' }],
      take: query.limit,
      select: {
        id: true,
        tower: true,
        floor: true,
        unitNumber: true,
        status: true,
        price: true,
        currency: true,
        areaSqft: true,
        facing: true,
        heldUntil: true,
        unitPlan: { select: { id: true, name: true, unitType: true } },
      },
    });

    return { data: units };
  },
);

const createBody = z
  .object({
    unitPlanId: z.string().cuid().optional(),
    tower: z.string().max(40).optional(),
    facing: z.string().max(40).optional(),
    /**
     * Units are created in a floor range rather than one at a time. A tower is
     * entered once, at handover, as "floors 1 to 40, four units a floor" — and
     * 160 separate POSTs is how that becomes a job nobody does.
     */
    fromFloor: z.number().int().min(-5).max(200),
    toFloor: z.number().int().min(-5).max(200),
    unitsPerFloor: z.number().int().min(1).max(20),
    /** `{floor}0{n}` → 1201, 1202. The house style varies; this is the common one. */
    numberPattern: z.string().max(40).default('{floor}0{n}'),
    price: z.number().nonnegative().optional(),
    areaSqft: z.number().int().positive().optional(),
  })
  .strict();

/** Hard ceiling on one request, so a typo in the floor range cannot create 40 000 rows. */
const MAX_UNITS_PER_REQUEST = 1_000;

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

    if (body.toFloor < body.fromFloor) {
      throw Invalid([{ field: 'toFloor', code: 'range', message: 'The top floor cannot be below the bottom one.' }]);
    }
    const count = (body.toFloor - body.fromFloor + 1) * body.unitsPerFloor;
    if (count > MAX_UNITS_PER_REQUEST) {
      throw Invalid([
        {
          field: 'toFloor',
          code: 'too_many',
          message: `That range is ${count} units. Add at most ${MAX_UNITS_PER_REQUEST} at a time.`,
        },
      ]);
    }

    const rows: Prisma.UnitInventoryCreateManyInput[] = [];
    for (let floor = body.fromFloor; floor <= body.toFloor; floor++) {
      for (let n = 1; n <= body.unitsPerFloor; n++) {
        rows.push({
          tenantId: ctx.tenantId,
          projectId: project.id,
          unitPlanId: body.unitPlanId,
          tower: body.tower,
          facing: body.facing,
          floor,
          unitNumber: body.numberPattern.replace('{floor}', String(floor)).replace('{n}', String(n)),
          price: body.price,
          currency: project.currency,
          areaSqft: body.areaSqft,
          createdById: ctx.actor.id,
        });
      }
    }

    return withTx(ctx.tenantId, async (tx) => {
      // `skipDuplicates`, because the unique key is (projectId, unitNumber) and
      // re-running a range that partly exists should top it up rather than fail
      // the whole batch — entering a tower is an interrupted, resumed job.
      const created = await tx.unitInventory.createMany({ data: rows, skipDuplicates: true });
      const rollups = await recalculateProjectRollups(tx, ctx.tenantId, project.id);
      return { created: created.count, skipped: rows.length - created.count, ...rollups };
    });
  },
);
