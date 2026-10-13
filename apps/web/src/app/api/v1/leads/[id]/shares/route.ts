import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { createShare, revokeShare, shareRequest } from '@/services/leads/leadShares';

const params = z.object({ id: z.string().cuid() });

/**
 * Share a project or a listing with the lead (Lead Eagle audit row M4-30): a
 * signed public page, `/s/{token}`, for this lead, that logs on its timeline
 * when the client opens it. Under the lead's scope (`leads:EDIT`, 404 outside
 * it), for stock the sharer can see (404 otherwise) and may show a client
 * (409 for a listing off the market). Lapses after `days` (30 unless given);
 * DELETE `?share=` revokes it at once. Both audited.
 */
export const POST = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params,
    body: shareRequest,
  },
  async ({ ctx, params, body }) => {
    const { days, ...target } = body;
    return createShare(ctx, params.id, target, days);
  },
);

export const DELETE = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params,
    query: z.object({ share: z.string().cuid() }),
  },
  async ({ ctx, params, query }) => revokeShare(ctx, params.id, query.share),
);
