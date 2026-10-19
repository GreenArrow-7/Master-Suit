import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { mergeWhere } from '@/lib/api/where';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { applyFieldSecurity, loadFieldRules, seesField } from '@/lib/security/fieldSecurity';
import { isNamedLeadFilter } from '@/lib/leads/namedFilters';
import { leadListQuery, leadPage } from '@/services/leads/leadList';
import { LEAD_SENSITIVE_FIELDS, leadSearch } from '@/services/leads/createLead';
import { scopedNextFollowUp } from '@/services/leads/nextFollowUp';

const query = z.object({
  /** A search, or a lead's id: the app opens a lead by asking the list for it. */
  q: z.string().trim().max(200).optional(),
  /** `mine`, `overdue`, `untouched`, …: a named lead filter; empty or unknown is all. */
  preset: z.string().max(40).optional(),
  /** The last row's id from the previous page (`nextCursor`). */
  cursor: z.string().cuid().optional(),
  take: z.coerce.number().int().min(1).max(50).default(25),
});

/**
 * The lead list for the phone, in the standalone Lead Eagle app's row shape:
 * the web grid's query (`leadListQuery`: the caller's lead scope, the named
 * filter, the search, closed-out leads left out), keyset-paged as the grid is,
 * each row's numbers as the role reads them.
 */
export const GET = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'VIEW', mobile: true, query },
  async ({ ctx, query }) => {
    const rules = await loadFieldRules(ctx, 'LEAD');
    const filter = query.preset && isNamedLeadFilter(query.preset) ? query.preset : undefined;
    const { where, access, orderBy } = await leadListQuery(ctx, { filter }, rules);
    // The id as one more match of the search: "Christina" passes for a cuid, so neither replaces the other.
    const scoped = mergeWhere(where, query.q ? { OR: [{ id: query.q }, ...leadSearch(ctx, rules, query.q).OR] } : null);
    const page = await leadPage('updated', query.cursor, false, scoped);
    // A cursor no longer in the list (deleted, moved out of scope) ends it rather than restarting it.
    if (query.cursor && !page) return { rows: [], nextCursor: null };

    const found = await prisma.lead.findMany({
      where: mergeWhere(scoped, page?.where ?? null),
      orderBy: page?.orderBy ?? orderBy,
      take: query.take + 1,
      select: {
        id: true,
        reference: true,
        fullName: true,
        phone: true,
        email: true,
        tags: true,
        stageReason: true,
        lastActivityAt: true,
        updatedAt: true,
        stage: { select: { name: true, color: true } },
        leadSource: { select: { name: true } },
        owner: { select: { fullName: true } },
      },
    });
    const leads = found.slice(0, query.take);
    const ids = leads.map((lead) => lead.id);
    const [due, requirements] = await Promise.all([
      scopedNextFollowUp(ctx.tenantId, ids, access),
      prisma.clientRequirement.findMany({
        where: { tenantId: ctx.tenantId, leadId: { in: ids }, deletedAt: null, status: { in: ['OPEN', 'MATCHED'] } },
        orderBy: { updatedAt: 'asc' },
        select: { leadId: true, budgetMin: true, budgetMax: true },
      }),
    ]);
    // The newest open requirement wins: later rows overwrite earlier ones.
    const budget = new Map(requirements.map((r) => [r.leadId, r]));
    const masked = !seesField(ctx, 'LEAD', rules, 'phone', LEAD_SENSITIVE_FIELDS);

    const rows = leads.map((lead) => {
      const shown = applyFieldSecurity(
        ctx,
        'LEAD',
        rules,
        { fullName: lead.fullName, phone: lead.phone, email: lead.email, tags: lead.tags },
        LEAD_SENSITIVE_FIELDS,
      );
      const requirement = budget.get(lead.id);
      return {
        id: lead.id,
        reference: lead.reference,
        fullName: shown.fullName ?? '',
        phone: shown.phone ?? '',
        email: shown.email ?? '',
        statusName: lead.stage.name,
        statusColor: lead.stage.color,
        subStatusName: lead.stageReason,
        sourceName: lead.leadSource?.name ?? null,
        ownerName: lead.owner?.fullName ?? null,
        budgetMin: requirement?.budgetMin?.toString() ?? null,
        budgetMax: requirement?.budgetMax?.toString() ?? null,
        tags: shown.tags ?? [],
        nextFollowUpAt: due.get(lead.id)?.toISOString() ?? null,
        lastActivityAt: lead.lastActivityAt?.toISOString() ?? null,
        updatedAt: lead.updatedAt.toISOString(),
        masked,
      };
    });
    return { rows, nextCursor: found.length > query.take ? (leads.at(-1)?.id ?? null) : null };
  },
);
