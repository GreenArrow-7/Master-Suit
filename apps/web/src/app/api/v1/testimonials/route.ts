import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { visibilityWhere } from '@/lib/security/visibility';
import { decideTestimonial, requestTestimonial, TESTIMONIAL_STATUSES } from '@/services/clients/testimonials';

const listQuery = z
  .object({
    status: z.enum(TESTIMONIAL_STATUSES).optional(),
    leadId: z.string().cuid().optional(),
    contactId: z.string().cuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export const GET = route(
  { module: 'testimonials', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const scope = await visibilityWhere(ctx, 'testimonials', 'VIEW');
    const data = await prisma.testimonial.findMany({
      where: {
        ...scope,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.leadId ? { leadId: query.leadId } : {}),
        ...(query.contactId ? { contactId: query.contactId } : {}),
      },
      orderBy: { requestedAt: 'desc' },
      take: query.limit,
    });
    return { data };
  },
);

const requestBody = z
  .object({
    leadId: z.string().cuid().optional(),
    contactId: z.string().cuid().optional(),
    message: z.string().max(2000).optional(),
  })
  .strict();

/** Asking. The response carries the link to send them. */
export const POST = route(
  {
    module: 'testimonials',
    productModule: 'SALES',
    action: 'CREATE',
    body: requestBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => requestTestimonial({ ctx, ...body }),
);

const decideBody = z
  .object({
    testimonialId: z.string().cuid(),
    to: z.enum(TESTIMONIAL_STATUSES),
    reason: z.string().max(1000).optional(),
  })
  .strict();

/**
 * Approving, publishing or closing one.
 *
 * SUBMITTED is refused here: the client's words arrive through the public link
 * and nowhere else, so there is no staff path that writes them.
 */
export const PATCH = route(
  {
    module: 'testimonials',
    productModule: 'SALES',
    action: 'EDIT',
    body: decideBody,
    auditEvent: 'STAGE_CHANGED',
  },
  async ({ ctx, body }) => decideTestimonial({ ctx, ...body }),
);
