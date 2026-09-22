import { requirePageAccess } from '@/lib/workspace-page';
import { mergeWhere } from '@/lib/api/where';
import { visibilityWhere } from '@/lib/security/visibility';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import { SIMPLE_NAMED_LEAD_FILTERS } from '@/lib/leads/namedFilters';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import { OPEN_LEADS_WHERE } from '@/services/leads/closeOut';
import LeadGrid from './LeadGrid';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import LeadImport from './LeadImport';
import Pager from '@/components/workspace/Pager';
import { resolveColumns, storedColumnsFor } from '@/lib/grid/columns';
import {
  emptyFollowUpLabel,
  obligationAccess,
  obligationWhere,
  scopedNextFollowUp,
  type ObligationAccess,
} from '@/services/leads/nextFollowUp';

export const metadata = { title: 'Leads' };

const PAGE_SIZE = 50;

/**
 * Filters that depend only on the lead row.
 *
 * The follow-up filters are not here: they are questions about obligations, and
 * the answer depends on which obligations the viewer may see. They are built
 * below from the same predicate that produces the dates in the grid, so the
 * chip, the rows and the dates cannot disagree.
 */
// The named views, shared with the CSV export and the v1 list API so the three
// cannot answer the same question differently. See lib/leads/namedFilters.ts.
const FILTERS = SIMPLE_NAMED_LEAD_FILTERS;

/**
 * The follow-up chips, and the view each one asks about.
 *
 * `overdue` asks about everything the viewer's role reaches; `overdue_mine`
 * asks only about their own obligations. For a rep the two are the same set —
 * their reach *is* themselves — so the second chip is offered only to someone
 * whose reach is wider, which is the whole reason it exists.
 */
const FOLLOW_UP_FILTERS = {
  overdue: { state: 'overdue', view: 'scope' },
  overdue_mine: { state: 'overdue', view: 'personal' },
  no_next_action: { state: 'unscheduled', view: 'scope' },
} as const;

type FollowUpFilterKey = keyof typeof FOLLOW_UP_FILTERS;

function isFollowUpFilter(key: string | undefined): key is FollowUpFilterKey {
  return !!key && key in FOLLOW_UP_FILTERS;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['leads', 'VIEW'] });
  const page = Math.max(1, Number(params.page) || 1);

  const scope = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
  const now = new Date();

  /**
   * Which obligations this viewer may see, for the view the chosen chip asks
   * about. The same `access` drives the row filter and the dates rendered into
   * the grid, so a row can never appear under "Overdue" showing a date that is
   * not.
   */
  const followUp = isFollowUpFilter(params.filter) ? FOLLOW_UP_FILTERS[params.filter] : null;
  const view = followUp?.view ?? 'scope';
  const access: ObligationAccess = await obligationAccess(ctx, view);

  /**
   * Does this viewer's reach extend past their own obligations?
   *
   * A rep's team view and personal view return the same rows, so offering both
   * chips would be two names for one list. Derived from the resolved owner sets
   * rather than from the role name, so a bespoke role gets the right answer.
   */
  const reach = await obligationAccess(ctx, 'scope');
  const onlySelf = (set: (typeof reach)['task']) =>
    set.kind === 'none' || (set.kind === 'ids' && set.ids.length === 1 && set.ids[0] === ctx.actor.id);
  const personalIsEveryone = onlySelf(reach.task) && onlySelf(reach.followUp);

  const extra: Record<string, unknown> = followUp
    ? (obligationWhere(access, followUp.state, now) as Record<string, unknown>)
    : params.filter && FILTERS[params.filter]
      ? FILTERS[params.filter]!(now, ctx.actor.id)
      : {};
  const search = params.q
    ? {
        OR: [
          { fullName: { contains: params.q, mode: 'insensitive' as const } },
          { company: { contains: params.q, mode: 'insensitive' as const } },
          { email: { contains: params.q, mode: 'insensitive' as const } },
          { phone: { contains: params.q } },
          { reference: { contains: params.q, mode: 'insensitive' as const } },
        ],
      }
    : {};
  // Closed-out leads (invalid, duplicate, archived) leave every working list and
  // are reached only through their own chip.
  const where = mergeWhere(scope, extra, search, params.filter === 'closed_out' ? null : OPEN_LEADS_WHERE);

  const rules = await loadFieldRules(ctx, 'LEAD');

  const [rows, stages, users, taskTypes, setting] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      select: {
        id: true,
        reference: true,
        fullName: true,
        email: true,
        phone: true,
        company: true,
        score: true,
        grade: true,
        priority: true,
        slaState: true,
        nextFollowUpAt: true,
        updatedAt: true,
        ownerId: true,
        stage: { select: { key: true, name: true, color: true } },
        owner: { select: { fullName: true } },
      },
    }),
    prisma.leadStage.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { position: 'asc' },
      select: { id: true, key: true, name: true },
    }),
    prisma.user.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE', deletedAt: null },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true },
    }),
    prisma.taskType.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.organizationSetting.findUnique({
      where: { tenantId: ctx.tenantId },
      select: { gridColumns: true },
    }),
  ]);

  const columns = resolveColumns('LEAD', storedColumnsFor(setting?.gridColumns, 'LEAD'));

  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  // Masking happens here, in the serialiser, so it covers the grid, exports and
  // every other egress path identically.
  /**
   * The dates the grid renders, derived per viewer — never the stored column.
   *
   * The stored value selected above is replaced outright rather than consulted.
   * An earlier revision kept it as a boolean to tell "nobody scheduled
   * anything" from "somebody else is handling this"; that answered, for every
   * lead on screen, whether a colleague had work on it, from a cache the viewer
   * is not entitled to read. The empty cell now says something about the
   * viewer instead — see `emptyFollowUpLabel`.
   */
  const due = await scopedNextFollowUp(
    ctx.tenantId,
    pageRows.map((r) => r.id),
    access,
  );
  const withFollowUp = pageRows.map((r) => ({ ...r, nextFollowUpAt: due.get(r.id) ?? null }));

  const data = withFollowUp.map((r) => applyFieldSecurity(ctx, 'LEAD', rules, r, LEAD_SENSITIVE_FIELDS));

  return (
    <>
      <ListHeader
        title="Leads"
        count={pageRows.length}
        noun="lead"
        capped={hasMore}
        // Adding a lead is what someone came here to do; export and column
        // choice are housekeeping and fold behind the disclosure. Import sits
        // beside "Add lead": it is how most leads arrive, and its panel cannot
        // live inside the disclosure — the top bar closes a <details> on any
        // click within it, which dismissed the import panel as it opened.
        secondaryActions={
          <>
            {can(ctx, 'leads', 'EXPORT') && (
              <a
                className="lf-btn lf-btn--secondary lf-btn--sm"
                href={`/api/v1/leads/export?${new URLSearchParams({ ...(params.filter ? { filter: params.filter } : {}), ...(params.q ? { q: params.q } : {}) })}`}
              >
                Export
              </a>
            )}
            {can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
              <ColumnEditor object="LEAD" current={columns.map((column) => column.key)} />
            )}
          </>
        }
        actions={
          <>
            {can(ctx, 'leads', 'IMPORT') && (
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <LeadImport />
              </span>
            )}
            {can(ctx, 'leads', 'CREATE') && (
              <SalesLink className="lf-btn lf-btn--sm" href="/leads/new">
                Add lead
              </SalesLink>
            )}
          </>
        }
      />

      {/* One toolbar: search, the saved views as chips, and a way back to
          the unfiltered list. Search and view compose — the chips carry the
          current query and the form carries the current view. */}
      <div className="lf-toolbar">
        <form className="lf-toolbar__search" method="get" role="search">
          {params.filter && <input type="hidden" name="filter" value={params.filter} />}
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3" />
          </svg>
          <input
            name="q"
            type="search"
            className="lf-input"
            defaultValue={params.q ?? ''}
            placeholder="Search leads"
            aria-label="Search leads"
          />
        </form>
        <nav className="lf-chips" aria-label="Saved views">
          {[
            // All, Mine and Unassigned are the area tabs above; repeating them
            // here was the same three choices twice on one screen.
            // Labelled, because for a manager these are two different questions
            // and an unlabelled "Overdue" would silently answer whichever one
            // the implementation happened to pick.
            [personalIsEveryone ? 'Overdue' : 'Overdue · team', 'overdue'],
            ...(personalIsEveryone ? [] : [['Overdue · mine', 'overdue_mine']]),
            ['No next action', 'no_next_action'],
            ['SLA breached', 'breached'],
            ['High score', 'high_score'],
            ['Closed out', 'closed_out'],
          ].map(([label, key]) => {
            const query = new URLSearchParams({
              ...(key ? { filter: key } : {}),
              ...(params.q ? { q: params.q } : {}),
            });
            const suffix = query.toString();
            return (
              <SalesLink
                key={label}
                className="lf-chip"
                href={suffix ? `/leads?${suffix}` : '/leads'}
                aria-current={(params.filter ?? '') === key ? 'page' : undefined}
              >
                {label}
              </SalesLink>
            );
          })}
        </nav>
        {(params.q || params.filter) && (
          <SalesLink className="lf-btn lf-btn--ghost lf-btn--sm" href="/leads">
            Clear all
          </SalesLink>
        )}
      </div>

      {data.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="Nothing matches this view"
            description="Adjust the filter, or add a lead to start building this list."
            actionLabel={can(ctx, 'leads', 'CREATE') ? 'Add lead' : undefined}
            actionHref="/leads/new"
          />
        </div>
      ) : (
        <LeadGrid
          rows={data as any}
          columns={columns}
          stages={stages}
          users={users}
          taskTypes={taskTypes}
          canAssign={can(ctx, 'leads', 'ASSIGN')}
          canEdit={can(ctx, 'leads', 'EDIT')}
          canDelete={can(ctx, 'leads', 'DELETE')}
          emptyLabel={emptyFollowUpLabel(access, view, ctx.actor.id)}
        />
      )}

      <Pager page={page} hasMore={hasMore} basePath="/leads" params={{ filter: params.filter, q: params.q }} />
    </>
  );
}
