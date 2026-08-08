import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { assertRecordVisible } from '@/lib/security/visibility';
import { matchesForRequirement } from '@/services/inventory/demand';
import { expireLapsedMandates } from '@/services/inventory/mandates';

const params = z.object({ id: z.string().cuid() });
const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();

/**
 * What can I show this client?
 *
 * The half of the demand check an agent runs before a call: live stock that
 * answers the requirement, closest to the middle of the stated budget first.
 *
 * Visibility is checked against the *requirement*, not the listings. The book is
 * shared; the client is not, so an agent cannot read somebody else's buyer by
 * asking what matches them.
 */
export const GET = route(
  { module: 'requirements', productModule: 'SALES', action: 'VIEW', params, query },
  async ({ ctx, params, query }) => {
    const requirement = await prisma.clientRequirement.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, tenantId: true, ownerId: true },
    });
    if (!requirement) throw NotFound('Requirement');
    await assertRecordVisible(ctx, 'requirements', requirement, prisma, 'VIEW');

    // Expired mandates first, so a match list never offers stock the agency has
    // lost the right to show.
    await expireLapsedMandates(ctx.tenantId);

    const result = await matchesForRequirement(ctx.tenantId, params.id, query.limit);
    if (!result) throw NotFound('Requirement');
    return result;
  },
);
