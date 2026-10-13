import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { loadFieldRules, seesField } from '@/lib/security/fieldSecurity';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import { MERGE_FIELDS, mergeLeads } from '@/services/leads/merge';

const params = z.object({ id: z.string().cuid() });
const body = z
  .object({
    /** The lead merged into this one; it stays as a merged record that names this one. */
    otherId: z.string().cuid(),
    /** The fields whose value comes from the other lead; the rest keep this lead's. */
    take: z.array(z.enum(MERGE_FIELDS)).max(MERGE_FIELDS.length).default([]),
  })
  .strict();

/**
 * Merge another lead into this one (M4-31). Needs `leads:EDIT` over both leads,
 * not `leads:DELETE`: nothing is lost, since every record moves to the kept lead
 * and the other stays resolvable, as closing it out as a duplicate needs EDIT
 * too. The service audits both leads.
 */
export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'EDIT', params, body },
  async ({ ctx, params, body }) => {
    const rules = await loadFieldRules(ctx, 'LEAD');
    // A value this role may not write, or sees masked, stays the kept lead's (PATCH's rule).
    const take = body.take.filter(
      (field) => rules.get(field)?.canEdit !== false && seesField(ctx, 'LEAD', rules, field, LEAD_SENSITIVE_FIELDS),
    );
    return mergeLeads(ctx, params.id, body.otherId, take);
  },
);
