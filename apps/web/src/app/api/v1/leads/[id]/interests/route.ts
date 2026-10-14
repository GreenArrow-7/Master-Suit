import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx, type TxClient } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import type { Ctx } from '@/lib/security/rbac';
import { assertLeadInScope } from '@/lib/security/record-scope';
import { assertLeadTarget, leadTarget, type LeadTarget } from '@/services/leads/leadShares';

const params = z.object({ id: z.string().cuid() });

const change = (ctx: Ctx, tx: TxClient, leadId: string, action: string, t: LeadTarget, name?: string) =>
  audit(ctx, { event: 'RECORD_UPDATED', objectType: 'lead', recordId: leadId, metadata: { action, ...t, name } }, tx);

/**
 * The projects and listings a lead asked about (Lead Eagle audit row M4-06),
 * from the picker on its page. Written under the lead's scope (`leads:EDIT`;
 * a lead out of reach answers 404), and only for a project or listing the
 * caller can see: the workspace's own, live, with `projects:VIEW` or
 * `listings:VIEW`. Anything else answers 404, as a missing one does.
 */
export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'EDIT', params, body: leadTarget },
  async ({ ctx, params, body }) =>
    withTx(ctx.tenantId, async (tx) => {
      const lead = await assertLeadInScope(ctx, params.id, tx, 'EDIT');
      const { name } = await assertLeadTarget(ctx, tx, body);
      const row = { tenantId: ctx.tenantId, leadId: lead.id, createdById: ctx.actor.id };
      // Once each: naming it again changes nothing.
      const { count } = body.projectId
        ? await tx.leadProject.createMany({ data: [{ ...row, projectId: body.projectId }], skipDuplicates: true })
        : await tx.leadListing.createMany({ data: [{ ...row, listingId: body.listingId! }], skipDuplicates: true });
      if (count) await change(ctx, tx, lead.id, 'lead.interest_added', body, name);
      return { leadId: lead.id, ...body, added: count > 0 };
    }),
);

export const DELETE = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'EDIT', params, query: leadTarget },
  async ({ ctx, params, query }) =>
    withTx(ctx.tenantId, async (tx) => {
      const lead = await assertLeadInScope(ctx, params.id, tx, 'EDIT');
      const where = { tenantId: ctx.tenantId, leadId: lead.id };
      const { count } = query.projectId
        ? await tx.leadProject.deleteMany({ where: { ...where, projectId: query.projectId } })
        : await tx.leadListing.deleteMany({ where: { ...where, listingId: query.listingId! } });
      if (count) await change(ctx, tx, lead.id, 'lead.interest_removed', query);
      return { leadId: lead.id, ...query, removed: count > 0 };
    }),
);
