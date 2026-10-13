import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { Forbidden } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { can } from '@/lib/security/rbac';
import { moveLeadToData } from '@/services/leads/coldData';

/**
 * The lead grid's bulk Move to Data (M4-39), one lead per request: a cold
 * record made of it (`leads:CREATE`, as cold data is lead work) and the lead
 * closed out (`leads:EDIT`, in scope). Audited in the service.
 */
export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'EDIT', params: z.object({ id: z.string().cuid() }) },
  async ({ ctx, params }) => {
    if (!can(ctx, 'leads', 'CREATE')) throw Forbidden('Your role cannot add cold data.');
    return moveLeadToData(ctx, params.id);
  },
);
