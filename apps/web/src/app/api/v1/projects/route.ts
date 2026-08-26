import { z } from 'zod';
import { mergeWhere } from '@/lib/api/where';
import { route } from '@/lib/api/handler';
import { pageQuery, decodeCursor, cursorWhere, toPage } from '@/lib/api/pagination';
import { prisma } from '@/lib/db';
import { Conflict } from '@/lib/errors';
import {
  catalogueFilters,
  catalogueWhere,
  PROJECT_LIST_SELECT,
  PROJECT_STATUSES,
  POSSESSION_STATUSES,
} from '@/lib/inventory/catalogue';

/**
 * The project catalogue.
 *
 * No visibility scoping, and that is the point: inventory is reference data
 * every salesperson must see in full to pitch it. `visibilityWhere` is absent
 * here on purpose, not by omission — there is no `ownerId` on a project to
 * scope by. What is gated is writing, which needs `projects:CREATE`.
 */
const listQuery = pageQuery.merge(catalogueFilters);

export const GET = route(
  { module: 'projects', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    // Resolved before the main query and passed in as ids: the favourite set is
    // per user and small, so an IN list beats a relation filter the planner has
    // to evaluate per candidate row.
    const favouriteIds = query.favourites
      ? (
          await prisma.projectFavourite.findMany({
            where: { tenantId: ctx.tenantId, userId: ctx.actor.id },
            select: { projectId: true },
          })
        ).map((f) => f.projectId)
      : undefined;

    const cursor = decodeCursor(query.cursor);
    const where = mergeWhere(catalogueWhere(ctx.tenantId, query, favouriteIds), cursorWhere(cursor));

    // limit + 1 tells us whether another page exists without a second query.
    const rows = await prisma.project.findMany({
      where,
      select: PROJECT_LIST_SELECT,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    return toPage(rows as never, query.limit);
  },
);

const createBody = z
  .object({
    name: z.string().min(2).max(200),
    code: z.string().min(2).max(40),
    developerId: z.string().cuid().optional(),
    micromarketId: z.string().cuid().optional(),
    status: z.enum(PROJECT_STATUSES).default('LAUNCHED'),
    possessionStatus: z.enum(POSSESSION_STATUSES).default('UNDER_CONSTRUCTION'),
    possessionAt: z.coerce.date().optional(),
    currency: z.string().length(3).default('AED'),
    unitTypes: z.array(z.string().max(40)).max(30).default([]),
    amenityKeys: z.array(z.string().max(60)).max(60).default([]),
    highlights: z.array(z.string().max(200)).max(20).default([]),
    address: z.string().max(400).optional(),
    // Coerced, because the create form posts form values as strings. The API
    // still refuses anything that is not a number — coercion widens the input,
    // it does not weaken the check.
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    description: z.string().max(8000).optional(),
    reraNumber: z.string().max(80).optional(),
    reraAuthority: z.string().max(80).optional(),
    reraApprovedAt: z.coerce.date().optional(),
    reraExpiresAt: z.coerce.date().optional(),
    isPriority: z.boolean().default(false),
    isPitchable: z.boolean().default(true),
    launchedAt: z.coerce.date().optional(),
  })
  .strict();

/**
 * The price band, area band and unit counts are deliberately not accepted here.
 * They are derived from the unit plans and units by recalculateProjectRollups,
 * and a hand-typed band that disagrees with the plans beneath it is a catalogue
 * filter that matches the wrong projects.
 */
export const POST = route(
  {
    module: 'projects',
    productModule: 'SALES',
    action: 'CREATE',
    body: createBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => {
    const clash = await prisma.project.findFirst({
      where: { tenantId: ctx.tenantId, code: body.code },
      select: { id: true, deletedAt: true },
    });
    if (clash) {
      throw Conflict(
        clash.deletedAt
          ? `Project code ${body.code} belongs to an archived project. Restore it or choose another code.`
          : `Project code ${body.code} is already in use.`,
      );
    }

    return prisma.project.create({
      data: { tenantId: ctx.tenantId, createdById: ctx.actor.id, updatedById: ctx.actor.id, ...body },
      select: PROJECT_LIST_SELECT,
    });
  },
);
