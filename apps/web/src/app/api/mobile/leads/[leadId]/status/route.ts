import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { loadFieldRules, stripUneditableFields } from '@/lib/security/fieldSecurity';
import { updateLead } from '@/services/leads/updateLead';

const params = z.object({ leadId: z.string().cuid() });
const body = z
  .object({
    /** The stage to move to (the standalone app's status). */
    statusId: z.string().cuid(),
    /** The standalone's sub-status has no stage of its own here; a reason carries it. */
    subStatusId: z.string().max(40).nullish(),
    reason: z.string().trim().max(2000).nullish(),
  })
  .strict();

/**
 * Move a lead from the phone, through `updateLead` like the lead page: the
 * stage's required reason and fields are checked there (a stage that books a
 * visit or meeting asks for its time, so is refused here 422), under the
 * caller's `leads:EDIT` scope, audited.
 */
export const POST = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    mobile: true,
    params,
    body,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    const rules = await loadFieldRules(ctx, 'LEAD');
    const move = stripUneditableFields(rules, {
      stageId: body.statusId,
      ...(body.reason ? { stageReason: body.reason } : {}),
    });
    await updateLead(ctx, params.leadId, move);
    return { ok: true, id: params.leadId };
  },
);
