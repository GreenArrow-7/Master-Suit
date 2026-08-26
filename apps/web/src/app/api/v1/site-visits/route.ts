import { z } from 'zod';
import { mergeWhere } from '@/lib/api/where';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Invalid } from '@/lib/errors';
import type { Prisma } from '@prisma/client';
import { visibilityWhere } from '@/lib/security/visibility';

const KINDS = ['PROPERTY_VISIT', 'CLIENT_MEETING'] as const;
const STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;

const listQuery = z
  .object({
    kind: z.enum(KINDS).optional(),
    status: z.enum(STATUSES).optional(),
    /** The leader's two queues, as a single named filter each. */
    queue: z.enum(['approval', 'verification', 'suspect']).optional(),
    projectId: z.string().cuid().optional(),
    leadId: z.string().cuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

const LIST_SELECT = {
  id: true,
  kind: true,
  status: true,
  verification: true,
  scheduledAt: true,
  durationMin: true,
  address: true,
  ownerId: true,
  leadId: true,
  contactId: true,
  checkInAt: true,
  checkOutAt: true,
  distanceMeters: true,
  geofenceOk: true,
  locationSuspect: true,
  suspectReason: true,
  outcome: true,
  amendedAt: true,
  updatedAt: true,
  project: { select: { id: true, name: true } },
  listing: { select: { id: true, reference: true, title: true } },
} as const;

/**
 * The visit register.
 *
 * Owner-scoped like leads: a visit is somebody's appointment with somebody's
 * client. A leader sees their subtree, which is what makes the approval and
 * verification queues below useful rather than a list of strangers.
 */
export const GET = route(
  { module: 'visits', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const scope = await visibilityWhere(ctx, 'visits', 'VIEW');

    const queueWhere: Prisma.SiteVisitWhereInput =
      query.queue === 'approval'
        ? { status: 'REQUESTED' }
        : query.queue === 'verification'
          ? { status: { in: ['COMPLETED', 'NO_SHOW'] }, verification: 'PENDING' }
          : query.queue === 'suspect'
            ? { locationSuspect: true }
            : {};

    const data = await prisma.siteVisit.findMany({
      where: mergeWhere(
        scope,
        { deletedAt: null },
        queueWhere,
        query.kind ? { kind: query.kind } : null,
        // `queue=verification` already constrains status; a `status=` alongside
        // it used to overwrite that constraint rather than narrow it, so the
        // verification queue could be asked for REQUESTED rows and would answer.
        query.status ? { status: query.status } : null,
        query.projectId ? { projectId: query.projectId } : null,
        query.leadId ? { leadId: query.leadId } : null,
        query.from || query.to
          ? { scheduledAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
          : null,
      ),
      select: LIST_SELECT,
      orderBy: { scheduledAt: 'desc' },
      take: query.limit,
    });

    return { data };
  },
);

const createBody = z
  .object({
    kind: z.enum(KINDS).default('PROPERTY_VISIT'),
    leadId: z.string().cuid().optional(),
    contactId: z.string().cuid().optional(),
    projectId: z.string().cuid().optional(),
    unitInventoryId: z.string().cuid().optional(),
    listingId: z.string().cuid().optional(),
    address: z.string().max(400).optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    scheduledAt: z.coerce.date(),
    durationMin: z.coerce.number().int().min(5).max(1440).default(60),
    notes: z.string().max(4000).optional(),
  })
  .strict();

/**
 * Requesting a visit.
 *
 * `status` is not accepted: everything starts REQUESTED and moves through the
 * state machine. Booking yourself an approved visit would make the register a
 * diary, which is the one thing it must not be.
 */
export const POST = route(
  {
    module: 'visits',
    productModule: 'SALES',
    action: 'CREATE',
    body: createBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => {
    if (!body.leadId && !body.contactId) {
      throw Invalid([{ field: 'leadId', code: 'required', message: 'Say who is being taken.' }]);
    }
    if (body.kind === 'PROPERTY_VISIT' && !body.projectId && !body.listingId && !body.unitInventoryId) {
      throw Invalid([{ field: 'projectId', code: 'required', message: 'A property visit needs a property to visit.' }]);
    }
    // Both are enforced by CHECK constraints too; named here so the message is
    // a sentence rather than a constraint name.
    if (body.scheduledAt.getTime() < Date.now() - 86_400_000) {
      throw Invalid([
        { field: 'scheduledAt', code: 'past', message: 'Log a past visit as an activity; the register is forward.' },
      ]);
    }

    return prisma.siteVisit.create({
      data: {
        tenantId: ctx.tenantId,
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
        ...body,
      },
      select: LIST_SELECT,
    });
  },
);
