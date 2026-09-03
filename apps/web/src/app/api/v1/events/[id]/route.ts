import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { requireMutableEvent, requireVisibleEvent } from '@/services/crm/eventVisibility';

const params = z.object({ id: z.string().cuid() });

export const GET = route(
  { module: 'events', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    // Read: the invitee exemption applies, so somebody attending can open it.
    await requireVisibleEvent(ctx, params.id);
    const event = await prisma.event.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      include: {
        invitees: { orderBy: { createdAt: 'desc' }, take: 200 },
        _count: { select: { invitees: true } },
      },
    });
    if (!event) throw NotFound('Event');
    return event;
  },
);

const patchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']).optional(),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
    location: z.string().max(300).optional(),
    meetingUrl: z.string().url().nullable().optional(),
    capacity: z.number().int().positive().nullable().optional(),
    notes: z.string().max(2000).optional(),
    /**
     * Who the event is for. `SCOPED` (the default) behaves like every other CRM
     * record; `ORGANIZATION` is the deliberate company-wide announcement that
     * every member holding `events:VIEW` can see.
     *
     * Publishing company-wide is a read grant only — editing it still requires
     * scope over the host, so this cannot be used to hand the company write
     * access to an event.
     */
    visibility: z.enum(['SCOPED', 'ORGANIZATION']).optional(),
  })
  .strict();

export const PATCH = route(
  { module: 'events', productModule: 'SALES', action: 'EDIT', params, body: patchBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    // Mutation: scope only. Being invited to an event is not authority over it.
    await requireMutableEvent(ctx, params.id, 'EDIT');
    return prisma.event.update({
      where: { id: params.id, tenantId: ctx.tenantId },
      data: { ...body, updatedById: ctx.actor.id },
    });
  },
);

export const DELETE = route(
  { module: 'events', productModule: 'SALES', action: 'DELETE', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) => {
    await requireMutableEvent(ctx, params.id, 'DELETE');
    await prisma.event.update({
      where: { id: params.id, tenantId: ctx.tenantId },
      data: { deletedAt: new Date(), updatedById: ctx.actor.id },
    });
    return { ok: true };
  },
);
