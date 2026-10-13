import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { Forbidden } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { loadFieldRules } from '@/lib/security/fieldSecurity';
import { mayMoveToData, moveLeadToData } from '@/services/leads/coldData';

/**
 * The lead grid's bulk Move to Data (M4-39), one lead per request: a cold
 * record made of it and the lead closed out, under `mayMoveToData` (CREATE,
 * EDIT in scope, and the lead's numbers in full). Audited in the service.
 */
export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'EDIT', params: z.object({ id: z.string().cuid() }) },
  async ({ ctx, params }) => {
    if (!mayMoveToData(ctx, await loadFieldRules(ctx, 'LEAD'))) {
      throw Forbidden('Your role cannot move leads to Cold Data.');
    }
    return moveLeadToData(ctx, params.id);
  },
);
