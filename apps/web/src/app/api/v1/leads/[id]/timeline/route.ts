import { z } from 'zod';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { leadScope } from '@/lib/security/record-scope';
import { leadTimeline, TIMELINE_CURSOR } from '@/services/leads/timeline';

const params = z.object({ id: z.string().cuid() });
const query = z
  .object({
    /** The `next` of the page before. */
    cursor: z.string().regex(TIMELINE_CURSOR, 'Not a timeline cursor.').optional(),
    limit: z.coerce.number().int().min(1).max(50).default(30),
  })
  .strict();

/**
 * A lead's timeline, a page at a time (M4-12, M4-46): the lead under the lead
 * page's own rule, 404 outside it; what each entry shows is the viewer's
 * (services/leads/timeline.ts).
 */
export const GET = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'VIEW', params, query },
  async ({ ctx, params, query }) => {
    const lead = await prisma.lead.findFirst({
      where: { ...(await leadScope(ctx, 'VIEW', { includeUnassigned: true })), id: params.id },
      select: { id: true },
    });
    if (!lead) throw NotFound('Lead');
    return leadTimeline(ctx, lead.id, query);
  },
);
