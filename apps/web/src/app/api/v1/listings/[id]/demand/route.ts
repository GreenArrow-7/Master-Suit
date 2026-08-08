import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { NotFound } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { requirementsWanting } from '@/services/inventory/demand';

const params = z.object({ id: z.string().cuid() });
const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();

/**
 * Who wanted this?
 *
 * The half of the demand check an agent runs when they take a property on: the
 * open requirements this listing answers, newest first, with the client named so
 * somebody can be called this afternoon.
 *
 * Gated on `requirements:VIEW` as well as listings, because the answer is a list
 * of other people's clients. An agent who may browse the book is not thereby
 * entitled to the buyer list, and the two permissions are separate for exactly
 * this route.
 */
export const GET = route(
  { module: 'requirements', productModule: 'SALES', action: 'VIEW', params, query },
  async ({ ctx, params, query }) => {
    const result = await requirementsWanting(ctx.tenantId, params.id, query.limit);
    if (!result) throw NotFound('Listing');

    // The requirement itself carries no name — it hangs off a lead or a contact.
    // Resolved here so the caller gets somebody to ring rather than an id.
    const leadIds = result.requirements.map((r) => r.leadId).filter((v): v is string => Boolean(v));
    const contactIds = result.requirements.map((r) => r.contactId).filter((v): v is string => Boolean(v));

    const [leads, contacts] = await Promise.all([
      leadIds.length
        ? prisma.lead.findMany({
            where: { tenantId: ctx.tenantId, id: { in: leadIds } },
            select: { id: true, fullName: true, ownerId: true },
          })
        : [],
      contactIds.length
        ? prisma.contact.findMany({
            where: { tenantId: ctx.tenantId, id: { in: contactIds } },
            select: { id: true, fullName: true, ownerId: true },
          })
        : [],
    ]);

    const leadName = new Map(leads.map((l) => [l.id, l.fullName]));
    const contactName = new Map(contacts.map((c) => [c.id, c.fullName]));

    return {
      listing: {
        id: result.listing.id,
        reference: result.listing.reference,
        title: result.listing.title,
        price: result.listing.price,
        currency: result.listing.currency,
        listingType: result.listing.listingType,
      },
      matches: result.requirements.map((r) => ({
        ...r,
        client: (r.leadId && leadName.get(r.leadId)) || (r.contactId && contactName.get(r.contactId)) || 'Unknown',
      })),
    };
  },
);
