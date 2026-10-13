import { requirePageAccess } from '@/lib/workspace-page';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { mergeWhere } from '@/lib/api/where';
import { assignableUsers, leadReach } from '@/lib/security/record-scope';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import { workspaceTimezone } from '@/services/hr/attendance';
import { bookableProjects } from '@/services/leads/updateLead';
import { mayMoveToData } from '@/services/leads/coldData';
import { listLeadSources } from '@/services/leads/leadSources';
import {
  cleanLeadListParams,
  LEAD_LIST_VIEW,
  leadListHref,
  leadListQuery,
  leadPage,
  savedViewHref,
  type LeadListParams,
} from '@/services/leads/leadList';
import LeadGrid, { type GridSort } from './LeadGrid';
import LeadBoard, { type BoardColumn } from './LeadBoard';
import LeadFilters from './LeadFilters';
import LeadViews from './LeadViews';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import LeadImport from './LeadImport';
import Pager from '@/components/workspace/Pager';
import { GRID_COLUMNS, resolveColumns, storedColumnsFor } from '@/lib/grid/columns';
import { customCells, customColumns } from '@/services/leads/customFields';
import { emptyFollowUpLabel, obligationAccess, scopedNextFollowUp } from '@/services/leads/nextFollowUp';

export const metadata = { title: 'Leads' };

const PAGE_SIZE = 50;
/** Cards a board column shows; the rest are a link to the list of that stage. */
const BOARD_PAGE = 20;

/** The grid's starting column sort for the server's order; `created` is a sort no column shows. */
const GRID_SORT: Record<NonNullable<LeadListParams['sort']>, GridSort> = {
  updated: { key: 'updatedAt', dir: 'desc' },
  created: null,
  score: { key: 'score', dir: 'desc' },
  name: { key: 'fullName', dir: 'asc' },
};

/**
 * The lead list, as a grid or as a board by stage (M4-21), in every lead
 * module. The URL carries the whole question — named filter, search, the
 * filter chips (M4-19), sort, a saved view's columns, the layout — and
 * `leadListQuery` answers it for the grid, the board and the CSV export alike.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = cleanLeadListParams(raw);
  const savedId = [raw.saved].flat()[0];
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['leads', 'VIEW'] });
  const page = Math.max(1, Number([raw.page].flat()[0]) || 1);
  const board = params.layout === 'board';
  const sort = params.sort ?? 'updated';

  const rules = await loadFieldRules(ctx, 'LEAD');
  const { where, access, view, orderBy } = await leadListQuery(ctx, params, rules);
  // Keyset pages (M4-20): Next carries `after`, Previous `before`, a lead's id; a bare
  // `?page=N`, as older links have it, or a lead no longer in the list, still skips.
  const after = [raw.after].flat()[0];
  const keyset = board
    ? null
    : after
      ? await leadPage(sort, after, false, where)
      : await leadPage(sort, [raw.before].flat()[0], true, where);
  const back = !!keyset && !after;

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

  const select = {
    id: true,
    reference: true,
    fullName: true,
    email: true,
    phone: true,
    company: true,
    score: true,
    grade: true,
    tags: true,
    customData: true,
    priority: true,
    slaState: true,
    nextFollowUpAt: true,
    updatedAt: true,
    ownerId: true,
    secondaryOwnerId: true,
    stageId: true,
    stage: { select: { key: true, name: true, color: true } },
    owner: { select: { fullName: true } },
  } as const;

  const [rows, stages, users, owners, sources, taskTypes, setting, views, timeZone] = await Promise.all([
    board
      ? Promise.resolve([])
      : prisma.lead.findMany({
          where: keyset ? mergeWhere(where, keyset.where) : where,
          orderBy: keyset?.orderBy ?? orderBy,
          skip: keyset ? 0 : (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE + 1,
          select,
        }),
    prisma.leadStage.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        key: true,
        name: true,
        category: true,
        requiresReason: true,
        reasons: true,
        requiredFields: true,
      },
    }),
    // Bulk assign offers whom the API accepts.
    assignableUsers(ctx, 'leads', 'ASSIGN'),
    // The owner chip offers the people whose leads the viewer reads.
    assignableUsers(ctx, 'leads', 'VIEW'),
    listLeadSources(prisma, ctx.tenantId),
    prisma.taskType.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.organizationSetting.findUnique({
      where: { tenantId: ctx.tenantId },
      select: { gridColumns: true },
    }),
    // The viewer's own saved views, and nobody else's.
    prisma.smartView.findMany({
      where: { tenantId: ctx.tenantId, objectType: LEAD_LIST_VIEW, ownerId: ctx.actor.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, filterTree: true, sortSpec: true, columns: true },
    }),
    workspaceTimezone(ctx),
  ]);
  const projects = await bookableProjects(ctx, stages);

  // The workspace's custom fields can be columns too (M4-13), in a saved view as well.
  const customColumnDefs = await customColumns(ctx.tenantId);
  const stored = storedColumnsFor(setting?.gridColumns, 'LEAD');
  const columns = resolveColumns('LEAD', params.cols?.split(',') ?? stored, customColumnDefs);
  const activeView = views.find((v) => v.id === savedId) ?? null;

  /**
   * The board: a column per stage in the pipeline's order, the exits (lost,
   * junk) after the ladder, each a page of the same query and its whole count.
   */
  const columnsOfBoard: BoardColumn[] = [];
  if (board) {
    const [counts, cards] = await Promise.all([
      prisma.lead.groupBy({ by: ['stageId'], where, _count: { _all: true } }),
      Promise.all(
        stages.map((stage) =>
          prisma.lead.findMany({
            where: mergeWhere(where, { stageId: stage.id }),
            orderBy,
            take: BOARD_PAGE,
            select: { id: true, reference: true, fullName: true, owner: { select: { fullName: true } } },
          }),
        ),
      ),
    ]);
    const count = new Map(counts.map((row) => [row.stageId, row._count._all]));
    const exit = (category: string) => category.startsWith('TERMINAL');
    for (const [index, stage] of stages.entries()) {
      const total = count.get(stage.id) ?? 0;
      columnsOfBoard.push({
        stage,
        exit: exit(stage.category),
        count: total,
        rows: cards[index]!.map((card) => ({
          id: card.id,
          reference: card.reference,
          fullName: card.fullName,
          owner: card.owner?.fullName ?? null,
        })),
        moreHref: total > BOARD_PAGE ? leadListHref({ ...params, layout: undefined, stage: stage.id }) : null,
      });
    }
    columnsOfBoard.sort((a, b) => Number(a.exit) - Number(b.exit));
  }

  // Read backwards from a `before` cursor, the page comes in reverse, and the one it came from follows it.
  const hasMore = back || rows.length > PAGE_SIZE;
  const pageRows = back ? rows.slice(0, PAGE_SIZE).reverse() : rows.slice(0, PAGE_SIZE);
  const cursors = pageRows.length ? { before: pageRows[0]!.id, after: pageRows.at(-1)!.id } : undefined;

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
  // Log call where its route takes the lead.
  const logs = await leadReach(ctx, 'EDIT');
  // Only the custom columns' values leave the server, never the rest of customData.
  const withFollowUp = pageRows.map(({ customData, secondaryOwnerId, ...r }) => ({
    ...r,
    custom: customCells(columns, customData),
    nextFollowUpAt: due.get(r.id) ?? null,
    canLog: logs({ ownerId: r.ownerId, secondaryOwnerId }),
  }));

  const data = withFollowUp.map((r) => applyFieldSecurity(ctx, 'LEAD', rules, r, LEAD_SENSITIVE_FIELDS));
  const shown = new Set(columns.map((column) => column.key));
  const { layout: _layout, ...listParams } = params;
  const total = columnsOfBoard.reduce((sum, column) => sum + column.count, 0);

  return (
    <>
      <ListHeader
        title="Leads"
        count={board ? total : pageRows.length}
        noun="lead"
        capped={!board && hasMore}
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
                href={leadListHref(listParams, '/api/v1/leads/export')}
              >
                Export
              </a>
            )}
            {can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
              <ColumnEditor
                object="LEAD"
                current={resolveColumns('LEAD', stored, customColumnDefs).map((column) => column.key)}
                extra={customColumnDefs}
              />
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

      {/* One toolbar: search, the named filters as chips, and a way back to
          the unfiltered list. Search, filters and chips compose — each link
          carries the rest of the query and the form carries the rest too. */}
      <div className="lf-toolbar">
        <form className="lf-toolbar__search" method="get" role="search">
          {Object.entries(params).map(
            ([key, value]) => key !== 'q' && <input key={key} type="hidden" name={key} value={value} />,
          )}
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
          ].map(([label, key]) => (
            <SalesLink
              key={label}
              className="lf-chip"
              href={leadListHref({ ...params, filter: key })}
              aria-current={(params.filter ?? '') === key ? 'page' : undefined}
            >
              {label}
            </SalesLink>
          ))}
        </nav>
        {Object.keys(listParams).length > 0 && (
          <SalesLink className="lf-btn lf-btn--ghost lf-btn--sm" href={leadListHref({ layout: params.layout })}>
            Clear all
          </SalesLink>
        )}
      </div>

      <div className="lf-lead-bar">
        <LeadFilters params={params} stages={stages} owners={owners} sources={sources} />
        <nav className="lf-chips lf-layout-switch" aria-label="Layout">
          <SalesLink
            className="lf-chip"
            href={leadListHref({ ...params, layout: undefined })}
            aria-current={board ? undefined : 'page'}
          >
            List
          </SalesLink>
          <SalesLink
            className="lf-chip"
            href={leadListHref({ ...params, layout: 'board' })}
            aria-current={board ? 'page' : undefined}
          >
            Board
          </SalesLink>
        </nav>
      </div>

      <LeadViews
        views={views.map((v) => ({ id: v.id, name: v.name, href: savedViewHref(v) }))}
        activeId={activeView?.id ?? null}
        params={params}
        columns={[...GRID_COLUMNS.LEAD, ...customColumnDefs]
          .filter((column) => !column.fixed)
          .map((column) => ({
            key: column.key,
            label: column.label,
            shown: shown.has(column.key),
          }))}
        listHref={leadListHref(params)}
      />

      {board ? (
        <LeadBoard columns={columnsOfBoard} projects={projects} canEdit={can(ctx, 'leads', 'EDIT')} />
      ) : (
        // Mounted with no rows too: a delete that empties the page keeps its Undo.
        <>
          {data.length === 0 && (
            <div className="lf-card">
              <EmptyState
                title="Nothing matches this view"
                description="Adjust the filter, or add a lead to start building this list."
                actionLabel={can(ctx, 'leads', 'CREATE') ? 'Add lead' : undefined}
                actionHref="/leads/new"
              />
            </div>
          )}
          <LeadGrid
            key={params.sort ?? 'updated'}
            rows={data as any}
            columns={columns}
            stages={stages}
            projects={projects}
            users={users}
            taskTypes={taskTypes}
            canAssign={can(ctx, 'leads', 'ASSIGN')}
            canEdit={can(ctx, 'leads', 'EDIT')}
            canDelete={can(ctx, 'leads', 'DELETE')}
            canMoveToData={mayMoveToData(ctx, rules)}
            emptyLabel={emptyFollowUpLabel(access, view, ctx.actor.id)}
            sort={GRID_SORT[params.sort ?? 'updated']}
            timeZone={timeZone}
          />
        </>
      )}

      {!board && (
        <Pager
          page={page}
          hasMore={hasMore}
          basePath="/leads"
          params={{ ...params, saved: activeView?.id }}
          cursors={cursors}
        />
      )}
    </>
  );
}
