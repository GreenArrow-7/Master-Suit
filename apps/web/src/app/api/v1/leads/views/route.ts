import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { GRID_COLUMNS } from '@/lib/grid/columns';
import { cleanLeadListParams, LEAD_LIST_VIEW, savedViewHref } from '@/services/leads/leadList';

const body = z.object({
  name: z.string().trim().min(1).max(60),
  /** The grid's URL as it stood: filter, search, chips, sort, layout. Anything else is dropped. */
  params: z.record(z.string(), z.unknown()).default({}),
  /** The columns the view shows, by key, in order; the record's link columns are always shown. */
  columns: z.array(z.string().max(40)).max(20).default([]),
});

const COLUMN_KEYS = new Set(GRID_COLUMNS.LEAD.filter((column) => !column.fixed).map((column) => column.key));

/**
 * Saves the lead grid as it stands as one of the caller's own views (M4-19):
 * its name, filters, sort and columns. A view is personal: only its owner lists
 * it, opens it as theirs or deletes it. Holding `leads:VIEW` is enough — a
 * view changes no lead, and every row it shows is read under the lead scope
 * when it is opened.
 */
export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'VIEW', body },
  async ({ ctx, body }) => {
    const { sort, cols: _cols, ...filterTree } = cleanLeadListParams(body.params);
    const columns = body.columns.filter((key, index) => COLUMN_KEYS.has(key) && body.columns.indexOf(key) === index);
    const view = await withTx(ctx.tenantId, async (tx) => {
      const created = await tx.smartView.create({
        data: {
          tenantId: ctx.tenantId,
          objectType: LEAD_LIST_VIEW,
          name: body.name,
          ownerId: ctx.actor.id,
          visibility: 'PERSONAL',
          filterTree,
          sortSpec: sort ? [sort] : [],
          columns,
          createdById: ctx.actor.id,
        },
      });
      await audit(ctx, { event: 'RECORD_CREATED', objectType: 'smart_views', recordId: created.id }, tx);
      return created;
    });
    return { id: view.id, name: view.name, href: savedViewHref(view) };
  },
);
