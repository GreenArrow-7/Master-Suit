import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { restoreLead } from '@/services/leads/updateLead';

/**
 * The lead grid's Undo after a bulk delete (M4-36): a deleted lead back in
 * every list. The delete's permission and scope; audited as RECORD_RESTORED.
 */
export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'DELETE', params: z.object({ id: z.string().cuid() }) },
  async ({ ctx, params }) => restoreLead(ctx, params.id),
);
