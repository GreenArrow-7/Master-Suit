import { requirePageAccess } from '@/lib/workspace-page';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { mergeWhere } from '@/lib/api/where';
import { visibilityWhere } from '@/lib/security/visibility';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import { hasSensitiveAccess } from '@/lib/auth/sensitive-access';
import MetricCard from '@/components/ui/MetricCard';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import Pager from '@/components/workspace/Pager';
import { columnsFor } from '@/lib/grid/resolve';
import { can } from '@/lib/security/rbac';
import { loadFieldRules } from '@/lib/security/fieldSecurity';
import { leadsInScope } from '@/lib/security/record-scope';
import { asLeadPhone, maskCallNumbers } from '@/services/leads/createLead';
import { workspaceTimezone } from '@/services/hr/attendance';
import { dayBounds, todayKey } from '@/services/targets/dailyBoard';
// Shared with the Lead Eagle board's Calls figures.
import { CONNECTED_CALL_OUTCOMES as CONNECTED_OUTCOMES } from '@/lib/leads/callLog';
import { CALL_TABS, LOGGED_CALL, boardListWhere, callTab } from '@/lib/leads/boardFilter';
import { onDay } from '@/lib/leads/followUpDue';

export const metadata = { title: 'Calls' };

const PAGE_SIZE = 50;

/** The tabs on the bar; Placed and Completed are reached from the Lead Eagle board. */
const SHOWN_TABS = CALL_TABS.filter((tab) => !['placed', 'completed'].includes(tab.key));
/** The board's filters a tab keeps. */
const KEPT = ['logged', 'from', 'to', 'owner', 'team', 'source', 'project'] as const;

type CallParams = { tab?: string; page?: string; logged?: string } & Record<string, string | undefined>;

export default async function CallsPage({ searchParams }: { searchParams: Promise<CallParams> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['calls', 'VIEW'] });
  const page = Math.max(1, Number(params.page) || 1);

  // Role scope, not just own calls: a manager sees the team's history here the
  // same way the audits page already does.
  const scope = await visibilityWhere(ctx, 'calls', 'VIEW', { ownerField: 'callerId' });
  const tab = callTab(params.tab);
  // The Lead Eagle board's calls: a period, person, team, source and project,
  // and (`logged=1`) the calls logged by hand beside the provider's (M3-18).
  const timeZone = await workspaceTimezone(ctx);
  const where = mergeWhere(scope, tab.where, { deletedAt: null }, await boardListWhere(ctx, params, 'call', timeZone));
  const loggedWhere =
    params.logged === '1' && tab.logged
      ? mergeWhere(
          await visibilityWhere(ctx, 'calls', 'VIEW', { ownerField: 'ownerId' }),
          LOGGED_CALL,
          tab.logged,
          await boardListWhere(ctx, params, 'log', timeZone),
        )
      : null;
  const kept = new URLSearchParams(KEPT.filter((key) => params[key]).map((key) => [key, params[key]!]));
  const tabHref = (key: string) => {
    const query = new URLSearchParams(kept);
    if (key) query.set('tab', key);
    return query.size ? `/calls?${query}` : '/calls';
  };

  // Today is the workspace's day, and a call made is one that rang, answered or
  // not, as the daily board counts it: a missed call is a call, a booked one is not.
  const today = dayBounds(todayKey(timeZone), timeZone);
  const [rows, total, stats] = await Promise.all([
    prisma.call.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      select: {
        id: true,
        status: true,
        outcome: true,
        direction: true,
        recipientNumber: true,
        callerNumber: true,
        durationSecs: true,
        startedAt: true,
        createdAt: true,
        leadId: true,
        contactId: true,
        notes: true,
        campaignId: true,
        caller: { select: { fullName: true } },
      },
    }),
    prisma.call.count({ where: { ...scope, deletedAt: null } }),
    prisma.call.groupBy({
      by: ['status', 'outcome'],
      where: {
        ...scope,
        deletedAt: null,
        status: { in: ['COMPLETED', 'MISSED', 'FAILED'] },
        createdAt: { gte: today.from, lte: today.to },
      },
      _count: true,
    }),
  ]);

  const [logged, placedCount, loggedCount] = loggedWhere
    ? await Promise.all([
        prisma.activity.findMany({
          where: loggedWhere,
          orderBy: { occurredAt: 'desc' },
          take: 100,
          select: {
            id: true,
            occurredAt: true,
            outcome: true,
            durationSecs: true,
            owner: { select: { fullName: true } },
            leadId: true,
          },
        }),
        prisma.call.count({ where }),
        prisma.activity.count({ where: loggedWhere }),
      ])
    : [null, null, null];
  const loggedLeads = await leadsInScope(ctx, logged?.map((row) => row.leadId) ?? []);

  const hasMore = rows.length > PAGE_SIZE;
  // A call to a lead or contact holds their number (the one dialled, or an
  // inbound caller's), which reads as their phone does for this role: masked
  // without leads:VIEW_SENSITIVE_FIELDS or by a field rule, and then the row's
  // Call button has nothing to dial.
  const calls = await maskCallNumbers(ctx, hasMore ? rows.slice(0, PAGE_SIZE) : rows);

  // Resolve lead names so the grid can show who was called, not a bare id.
  const leadIds = [...new Set(calls.map((c) => c.leadId).filter((id): id is string => Boolean(id)))];
  const leads =
    leadIds.length > 0
      ? await prisma.lead.findMany({
          where: { tenantId: ctx.tenantId, id: { in: leadIds } },
          // `phone` is what the row's Call button falls back to when the call
          // itself recorded no number — a scheduled or failed call often has
          // none, and dialling the lead is still what the user came here to do.
          select: { id: true, fullName: true, phone: true },
        })
      : [];
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  // Notes are free text about the conversation; a monitoring grant without
  // sensitive scope gets the call without them (they are otherwise in the payload).
  const sensitive = await hasSensitiveAccess(ctx);
  // The lead's own number, the Call button's fallback, reads the same way.
  const leadRules = await loadFieldRules(ctx, 'LEAD');
  const gridRows = calls.map((call) => {
    const lead = call.leadId ? (leadById.get(call.leadId) ?? null) : null;
    return {
      ...call,
      notes: sensitive ? call.notes : null,
      lead: lead && { ...lead, phone: asLeadPhone(ctx, leadRules, lead.phone) },
    };
  });

  const todayTotal = stats.reduce((s, r) => s + r._count, 0);
  const todayConnected = stats
    .filter((r) => r.status === 'COMPLETED' && r.outcome && CONNECTED_OUTCOMES.includes(r.outcome))
    .reduce((s, r) => s + r._count, 0);

  const configured = await columnsFor(ctx.tenantId, 'CALL');
  /**
   * The Call button is present in every workspace, configured layout or not.
   *
   * `resolveColumns` returns the stored preference verbatim once a workspace has
   * saved one, so a new catalogue entry reaches only the workspaces that never
   * customised this grid — every established customer would have silently
   * missed it. Appended rather than made `fixed`, because fixed columns render
   * at the *start* of the row and an action belongs at the end.
   */
  const columns = configured.some((column) => column.key === 'call')
    ? configured
    : [...configured, { key: 'call', label: '', align: 'right' as const }];

  return (
    <>
      <ListHeader
        title="Calls"
        count={calls.length}
        capped={hasMore}
        actions={
          <>
            {can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
              <ColumnEditor object="CALL" current={columns.map((c) => c.key)} />
            )}
            {/* Where /calls/new opens: it asks for calls:CREATE. */}
            {can(ctx, 'calls', 'CREATE') && (
              <SalesLink href="/calls/new" className="lf-btn" style={{ textDecoration: 'none' }}>
                New Call
              </SalesLink>
            )}
          </>
        }
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 'var(--lf-space-4)',
          marginBottom: 'var(--lf-space-5)',
        }}
      >
        <MetricCard label="Today's Calls" value={todayTotal} />
        <MetricCard label="Connected" value={todayConnected} tone="viridian" />
        <MetricCard
          label="Connect Rate"
          value={todayTotal ? `${Math.round((todayConnected / todayTotal) * 100)}%` : '—'}
          tone="brass"
        />
        <MetricCard label="Total Calls" value={total} />
      </div>

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Call filter">
        {SHOWN_TABS.map(({ label, key }) => (
          <SalesLink key={label} className="lf-tab" href={tabHref(key)} aria-selected={tab.key === key} role="tab">
            {label}
          </SalesLink>
        ))}
      </nav>

      {logged && (
        <p className="lf-hint" style={{ marginBottom: 'var(--lf-space-3)' }}>
          {placedCount} placed and {loggedCount} logged
          {(loggedCount ?? 0) > logged.length && ` (the latest ${logged.length} listed)`}
          {params.from && params.to ? ` · ${onDay(params.from)} – ${onDay(params.to)}` : ''}
        </p>
      )}

      {calls.length === 0 ? (
        <div className="lf-card">
          <EmptyState title="No calls yet" description="Start making calls to see your history here." />
        </div>
      ) : (
        <ConfigurableGrid object="CALL" columns={columns} rows={gridRows as any} />
      )}

      <Pager
        page={page}
        hasMore={hasMore}
        basePath="/calls"
        params={{ tab: params.tab, ...Object.fromEntries(kept) }}
      />

      {logged && logged.length > 0 && (
        <section style={{ marginTop: 'var(--lf-space-5)' }} aria-labelledby="logged-calls">
          <h2 id="logged-calls" className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-2)' }}>
            Logged calls
          </h2>
          <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
            <table className="lf-grid">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Lead</th>
                  <th>By</th>
                  <th>Outcome</th>
                  <th style={{ textAlign: 'right' }}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {logged.map((row) => {
                  const lead = row.leadId ? loggedLeads.get(row.leadId) : undefined;
                  return (
                    <tr key={row.id} data-logged-call={row.id}>
                      <td>
                        {row.occurredAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone })}
                      </td>
                      <td>{lead ? <SalesLink href={`/leads/${lead.id}`}>{lead.fullName}</SalesLink> : '—'}</td>
                      <td>{row.owner?.fullName ?? '—'}</td>
                      <td>{row.outcome ?? '—'}</td>
                      <td className="lf-num" style={{ textAlign: 'right' }}>
                        {row.durationSecs == null ? '—' : `${row.durationSecs}s`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
