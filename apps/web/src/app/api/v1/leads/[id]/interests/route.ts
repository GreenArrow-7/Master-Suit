import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx, type TxClient } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { can, type Ctx } from '@/lib/security/rbac';
import { assertLeadInScope } from '@/lib/security/record-scope';

const params = z.object({ id: z.string().cuid() });
const target = z
  .object({ projectId: z.string().cuid().optional(), listingId: z.string().cuid().optional() })
  .strict()
  .refine((t) => Boolean(t.projectId) !== Boolean(t.listingId), {
    message: 'Name one project or one listing.',
    path: ['projectId'],
  });

/**
 * The projects and listings a lead asked about (Lead Eagle audit row M4-06),
 * from the picker on its page. Written under the lead's scope (`leads:EDIT`;
 * a lead out of reach answers 404), and only for a project or listing the
 * caller can see: the workspace's own, live, with `projects:VIEW` or
 * `listings:VIEW`. Anything else answers 404, as a missing one does.
 */
async function assertTarget(ctx: Ctx, tx: TxClient, t: z.infer<typeof target>) {
  if (t.projectId) {
    const found =
      can(ctx, 'projects', 'VIEW') &&
      (await tx.project.findFirst({ where: { tenantId: ctx.tenantId, id: t.projectId, deletedAt: null } }));
    if (!found) throw NotFound('Project');
    return { kind: 'project', name: found.name } as const;
  }
  const found =
    can(ctx, 'listings', 'VIEW') &&
    (await tx.listing.findFirst({ where: { tenantId: ctx.tenantId, id: t.listingId!, deletedAt: null } }));
  if (!found) throw NotFound('Listing');
  return { kind: 'listing', name: found.title } as const;
}

const change = (ctx: Ctx, tx: TxClient, leadId: string, action: string, t: z.infer<typeof target>, name?: string) =>
  audit(ctx, { event: 'RECORD_UPDATED', objectType: 'lead', recordId: leadId, metadata: { action, ...t, name } }, tx);

export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'EDIT', params, body: target },
  async ({ ctx, params, body }) =>
    withTx(ctx.tenantId, async (tx) => {
      const lead = await assertLeadInScope(ctx, params.id, tx, 'EDIT');
      const { name } = await assertTarget(ctx, tx, body);
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
  { module: 'leads', productModule: LEAD_MODULES, action: 'EDIT', params, query: target },
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
