import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Conflict, NotFound } from '@/lib/errors';
import { POSSESSION_STATUSES, PROJECT_STATUSES } from '@/lib/inventory/catalogue';

const params = z.object({ id: z.string().cuid() });

export const GET = route(
  { module: 'projects', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const project = await prisma.project.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      include: {
        developer: { select: { id: true, name: true, logoUrl: true, reraId: true } },
        micromarket: { select: { id: true, name: true, city: true, latitude: true, longitude: true } },
        media: { orderBy: [{ kind: 'asc' }, { position: 'asc' }] },
        unitPlans: { orderBy: { position: 'asc' } },
      },
    });
    if (!project) throw NotFound('Project');

    const [favourite, amenities] = await Promise.all([
      prisma.projectFavourite.findFirst({
        where: { tenantId: ctx.tenantId, projectId: project.id, userId: ctx.actor.id },
        select: { id: true },
      }),
      // Resolved to labels here rather than stored on the project, so renaming
      // an amenity reaches every project that references it.
      project.amenityKeys.length
        ? prisma.amenity.findMany({
            where: { tenantId: ctx.tenantId, key: { in: project.amenityKeys } },
            select: { key: true, label: true, category: true },
            orderBy: [{ category: 'asc' }, { position: 'asc' }],
          })
        : [],
    ]);

    return { ...project, amenities, isFavourite: Boolean(favourite) };
  },
);

const patchBody = z
  .object({
    name: z.string().min(2).max(200).optional(),
    developerId: z.string().cuid().nullable().optional(),
    micromarketId: z.string().cuid().nullable().optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    possessionStatus: z.enum(POSSESSION_STATUSES).optional(),
    possessionAt: z.coerce.date().nullable().optional(),
    currency: z.string().length(3).optional(),
    amenityKeys: z.array(z.string().max(60)).max(60).optional(),
    highlights: z.array(z.string().max(200)).max(20).optional(),
    address: z.string().max(400).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    description: z.string().max(8000).nullable().optional(),
    reraNumber: z.string().max(80).nullable().optional(),
    reraAuthority: z.string().max(80).nullable().optional(),
    reraApprovedAt: z.coerce.date().nullable().optional(),
    reraExpiresAt: z.coerce.date().nullable().optional(),
    isPriority: z.boolean().optional(),
    isPitchable: z.boolean().optional(),
    launchedAt: z.coerce.date().nullable().optional(),
    completedAt: z.coerce.date().nullable().optional(),
  })
  .strict();

/**
 * `code` is not editable, and neither are the derived bands or counts.
 *
 * The code is what an importer, a brochure and a WhatsApp message all refer to;
 * changing it silently breaks every one of those. Archive and recreate if it
 * really must change. The bands come from the unit plans — see rollups.ts.
 */
export const PATCH = route(
  {
    module: 'projects',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body: patchBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    const existing = await prisma.project.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw NotFound('Project');

    return prisma.project.update({
      where: { id: params.id, tenantId: ctx.tenantId },
      data: { ...body, updatedById: ctx.actor.id },
    });
  },
);

/**
 * Archive, not delete.
 *
 * A project is referenced by site visits, and will be referenced by bookings
 * and commissions once M9 lands. Removing the row would orphan all of it, and
 * the platform rule is that nothing with money attached is ever hard-deleted.
 * Refused outright while any unit is booked or sold: that inventory is somebody's
 * live deal.
 */
export const DELETE = route(
  { module: 'projects', productModule: 'SALES', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    const project = await prisma.project.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, soldUnits: true },
    });
    if (!project) throw NotFound('Project');
    if (project.soldUnits > 0) {
      throw Conflict('This project has booked or sold units. Archiving it would orphan live deals.');
    }

    return prisma.project.update({
      where: { id: params.id, tenantId: ctx.tenantId },
      data: { deletedAt: new Date(), isPitchable: false, updatedById: ctx.actor.id },
      select: { id: true, deletedAt: true },
    });
  },
);
