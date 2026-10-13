import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { mergeWhere } from '@/lib/api/where';
import { prisma } from '@/lib/db';
import { simpleNamedLeadFilterWhere, wantsClosedOut } from '@/lib/leads/namedFilters';
import type { FieldRule } from '@/lib/security/fieldSecurity';
import type { Ctx } from '@/lib/security/rbac';
import { leadScope } from '@/lib/security/record-scope';
import { workspaceTimezone } from '@/services/hr/attendance';
import { dayBounds } from '@/services/targets/dailyBoard';
import { OPEN_LEADS_WHERE } from './closeOut';
import { leadSearch } from './createLead';
import { obligationAccess, obligationWhere } from './nextFollowUp';

/** A real calendar day: not "2026-02-31", nor "2026-00-10", on which `dayBounds` throws. */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => v >= '1000' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v));

/**
 * What the lead grid, its board and its CSV export read from the URL (M4-19,
 * M4-21), in the order a link writes them: a named filter, the search, the
 * chips (stage, owner — a user id or `none` — source, and a created or
 * updated date range on the workspace's clock), the sort, a saved view's
 * columns (`cols`, comma-separated) and the layout.
 */
export const leadListParams = z
  .object({
    filter: z.string().max(40),
    q: z.string().max(200),
    stage: z.string().max(40),
    owner: z.string().max(40),
    source: z.string().max(40),
    date: z.enum(['created', 'updated']),
    from: day,
    to: day,
    sort: z.enum(['updated', 'created', 'score', 'name']),
    // As many as a saved view keeps: 30 keys of up to 60 characters (POST /api/v1/leads/views).
    cols: z.string().max(30 * 61),
    layout: z.enum(['list', 'board']),
  })
  .partial();

export type LeadListParams = z.infer<typeof leadListParams>;
const KEYS = Object.keys(leadListParams.shape) as (keyof LeadListParams)[];

/** What a param means when absent: the filter form sends these, and no link needs to repeat them. */
const DEFAULTS: Partial<LeadListParams> = { date: 'created', sort: 'updated', layout: 'list' };

/** The values that mean something, each checked alone: a bad one drops itself, not the rest. */
export function cleanLeadListParams(raw: Record<string, unknown>): LeadListParams {
  const out: Record<string, string> = {};
  for (const key of KEYS) {
    const value = [raw[key]].flat()[0];
    if (typeof value !== 'string' || !value.trim()) continue;
    const parsed = leadListParams.shape[key].safeParse(value.trim());
    if (parsed.success && parsed.data && parsed.data !== DEFAULTS[key]) out[key] = parsed.data;
  }
  return out;
}

/** `/leads?…` for these params, module-relative (SalesLink), keys always in one order. */
export function leadListHref(params: LeadListParams & { saved?: string }, path = '/leads') {
  const query = new URLSearchParams();
  for (const key of [...KEYS, 'saved'] as const) {
    const value = params[key];
    if (value) query.set(key, value);
  }
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

/** `SmartView.objectType` of a person's saved lead grid (M4-19); Smart Views' own are `LEAD`. */
export const LEAD_LIST_VIEW = 'LEAD_LIST';

/** A saved view's link: its filters, its sort and its columns, then its id. */
export function savedViewHref(view: { id: string; filterTree: unknown; sortSpec: unknown; columns: unknown }) {
  const columns = Array.isArray(view.columns) ? view.columns.join(',') : undefined;
  const stored = cleanLeadListParams({
    ...(view.filterTree && typeof view.filterTree === 'object' ? view.filterTree : {}),
    sort: [view.sortSpec].flat()[0],
    cols: columns,
  });
  return leadListHref({ ...stored, saved: view.id });
}

/**
 * The follow-up filters are questions about obligations, and the answer depends
 * on which obligations the viewer may see: `overdue` asks about everything the
 * role reaches, `overdue_mine` only about the viewer's own.
 */
const FOLLOW_UP_FILTERS = {
  overdue: { state: 'overdue', view: 'scope' },
  overdue_mine: { state: 'overdue', view: 'personal' },
  no_next_action: { state: 'unscheduled', view: 'scope' },
} as const;

const ORDER: Record<NonNullable<LeadListParams['sort']>, Prisma.LeadOrderByWithRelationInput[]> = {
  updated: [{ updatedAt: 'desc' }, { id: 'desc' }],
  created: [{ createdAt: 'desc' }, { id: 'desc' }],
  score: [{ score: 'desc' }, { id: 'desc' }],
  name: [{ fullName: 'asc' }, { id: 'asc' }],
};
type Sort = keyof typeof ORDER;
/** The column each sort orders by before `id`; `name` is the one ascending. */
const SORT_KEY = { updated: 'updatedAt', created: 'createdAt', score: 'score', name: 'fullName' } as const;

/**
 * The grid's pages are keyset pages (M4-20): Next starts after the last row,
 * Previous ends before the first, each named in the URL by its id alone (its
 * sort value there put a lead's name, or a score a role may not read, in
 * every link). OFFSET read every earlier row: an agent's page 200 of a
 * 100,000-lead workspace took 150 to 400 ms in Postgres alone, page 1 a few.
 *
 * The rows after (or, `back`, before) that lead in the list's order, and the
 * order to read them in. Its sort value is read in the list itself, so a lead
 * gone from it (deleted, out of scope, filtered off) or an id that is no lead
 * reads as no cursor: null. The bound on the sort column is what lets an index
 * seek to the page.
 */
export async function leadPage(sort: Sort, id: string | undefined, back: boolean, where: Record<string, unknown>) {
  const key = SORT_KEY[sort];
  const row = id
    ? await prisma.lead.findFirst({ where: mergeWhere(where, { id }), select: { id: true, [key]: true } })
    : null;
  if (!row) return null;
  const value = (row as Record<string, unknown>)[key];
  // Past the cursor in the list's direction: lower for a descending sort, higher for `name`.
  const op = (sort === 'name') === back ? 'lt' : 'gt';
  return {
    where: {
      [key]: { [`${op}e`]: value },
      OR: [{ [key]: { [op]: value } }, { [key]: value, id: { [op]: row.id } }],
    },
    // Going back reads the page nearest the cursor first, so in reverse.
    orderBy: back
      ? ORDER[sort].map((o) => Object.fromEntries(Object.entries(o).map(([k, d]) => [k, d === 'asc' ? 'desc' : 'asc'])))
      : ORDER[sort],
  };
}

/**
 * The one lead list query: the caller's lead scope, the named filter, the
 * search, the chips and the closed-out exclusion, merged under AND. The grid,
 * the board and the CSV export all read it, so the same URL never answers two
 * ways. `access` and `view` are the obligations the viewer may see, for the
 * follow-up dates drawn beside the rows.
 */
export async function leadListQuery(ctx: Ctx, params: LeadListParams, rules: Map<string, FieldRule>) {
  const now = new Date();
  const followUp =
    params.filter && Object.hasOwn(FOLLOW_UP_FILTERS, params.filter)
      ? FOLLOW_UP_FILTERS[params.filter as keyof typeof FOLLOW_UP_FILTERS]
      : undefined;
  const view = followUp?.view ?? 'scope';
  const access = await obligationAccess(ctx, view);
  const timeZone = params.from || params.to ? await workspaceTimezone(ctx) : null;
  const where = mergeWhere(
    await leadScope(ctx, 'VIEW', { includeUnassigned: true }),
    followUp
      ? (obligationWhere(access, followUp.state, now) as Record<string, unknown>)
      : simpleNamedLeadFilterWhere(params.filter, now, ctx.actor.id),
    params.q ? leadSearch(ctx, rules, params.q) : null,
    params.stage ? { stageId: params.stage } : null,
    params.owner ? { ownerId: params.owner === 'none' ? null : params.owner } : null,
    // A source takes its sub-sources with it.
    params.source ? { OR: [{ sourceId: params.source }, { leadSource: { is: { parentId: params.source } } }] } : null,
    timeZone
      ? {
          [params.date === 'updated' ? 'updatedAt' : 'createdAt']: {
            ...(params.from ? { gte: dayBounds(params.from, timeZone).from } : {}),
            ...(params.to ? { lte: dayBounds(params.to, timeZone).to } : {}),
          },
        }
      : null,
    // Closed-out leads (invalid, duplicate, archived) leave every working list
    // and are reached only through their own filter.
    wantsClosedOut(params.filter) ? null : OPEN_LEADS_WHERE,
  );
  return { where, access, view, orderBy: ORDER[params.sort ?? 'updated'] };
}
