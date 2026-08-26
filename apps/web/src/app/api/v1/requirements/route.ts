import { z } from 'zod';
import { mergeWhere } from '@/lib/api/where';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Invalid } from '@/lib/errors';
import { visibilityWhere } from '@/lib/security/visibility';
import { FURNISHINGS, PROPERTY_TYPES } from '@/lib/inventory/listings';

const PURPOSES = ['BUY', 'RENT'] as const;
const STATUSES = ['OPEN', 'MATCHED', 'FULFILLED', 'CLOSED'] as const;

const listQuery = z
  .object({
    status: z.enum(STATUSES).optional(),
    purpose: z.enum(PURPOSES).optional(),
    leadId: z.string().cuid().optional(),
    contactId: z.string().cuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

/**
 * What clients are looking for.
 *
 * Owner-scoped, unlike the listing book. Stock is shared and demand is not: a
 * requirement is somebody's client, and the buyer list is the thing an agent
 * leaving takes with them. `visibilityWhere` gives an agent their own and a
 * manager their subtree, exactly as it does for leads.
 */
export const GET = route(
  { module: 'requirements', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const scope = await visibilityWhere(ctx, 'requirements', 'VIEW');

    const data = await prisma.clientRequirement.findMany({
      where: mergeWhere(
        scope,
        { deletedAt: null },
        query.status ? { status: query.status } : null,
        query.purpose ? { purpose: query.purpose } : null,
        query.leadId ? { leadId: query.leadId } : null,
        query.contactId ? { contactId: query.contactId } : null,
      ),
      orderBy: { updatedAt: 'desc' },
      take: query.limit,
    });

    return { data };
  },
);

const createBody = z
  .object({
    leadId: z.string().cuid().optional(),
    contactId: z.string().cuid().optional(),
    purpose: z.enum(PURPOSES),
    propertyTypes: z.array(z.enum(PROPERTY_TYPES)).max(8).default([]),
    micromarketIds: z.array(z.string().cuid()).max(20).default([]),
    bedroomsMin: z.coerce.number().int().min(0).max(50).optional(),
    bedroomsMax: z.coerce.number().int().min(0).max(50).optional(),
    areaMinSqft: z.coerce.number().int().positive().optional(),
    budgetMin: z.coerce.number().nonnegative().optional(),
    budgetMax: z.coerce.number().nonnegative().optional(),
    currency: z.string().length(3).default('AED'),
    possessionBy: z.coerce.date().optional(),
    furnishing: z.enum(FURNISHINGS).optional(),
    notes: z.string().max(4000).optional(),
  })
  .strict();

export const POST = route(
  {
    module: 'requirements',
    productModule: 'SALES',
    action: 'CREATE',
    body: createBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => {
    // Both enforced in the database as well; named here so the message is useful.
    if (!body.leadId && !body.contactId) {
      throw Invalid([{ field: 'leadId', code: 'required', message: 'A requirement belongs to a lead or a contact.' }]);
    }
    if (body.budgetMin != null && body.budgetMax != null && body.budgetMin > body.budgetMax) {
      throw Invalid([{ field: 'budgetMax', code: 'range', message: 'The top of the budget is below the bottom.' }]);
    }

    // The subject must exist and be ours. Without this a requirement can be
    // hung off an id from another workspace and surface in its owner's list.
    if (body.leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: body.leadId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!lead) throw Invalid([{ field: 'leadId', code: 'not_found', message: 'No such lead.' }]);
    }
    if (body.contactId) {
      const contact = await prisma.contact.findFirst({
        where: { id: body.contactId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!contact) throw Invalid([{ field: 'contactId', code: 'not_found', message: 'No such contact.' }]);
    }

    return prisma.clientRequirement.create({
      data: {
        tenantId: ctx.tenantId,
        ownerId: ctx.actor.id,
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
        ...body,
      },
    });
  },
);
