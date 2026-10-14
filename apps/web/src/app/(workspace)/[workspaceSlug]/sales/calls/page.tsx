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
import { asLeadPhone, maskCallNumbers } from '@/services/leads/createLead';
import { workspaceTimezone } from '@/services/hr/attendance';
import { dayBounds, todayKey } from '@/services/targets/dailyBoard';

export const metadata = { title: 'Calls' };

const PAGE_SIZE = 50;

const CONNECTED_OUTCOMES = ['CONNECTED', 'CALLBACK_REQUESTED', 'INTERESTED', 'QUALIFIED', 'CONVERTED'];

const TABS: [string, string, Record<string, unknown>][] = [
  ['All', '', {}],
  ['Connected', 'connected', { status: 'COMPLETED', outcome: { in: CONNECTED_OUTCOMES } }],
  ['Missed', 'missed', { status: 'MISSED' }],
  ['Voicemail', 'voicemail', { outcome: 'VOICEMAIL' }],
  ['Failed', 'failed', { status: 'FAILED' }],
  ['Scheduled', 'scheduled', { status: 'SCHEDULED' }],
];

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['calls', 'VIEW'] });
  const page = Math.max(1, Number(params.page) || 1);

  // Role scope, not just own calls: a manager sees the team's history here the
  // same way the audits page already does.
  const scope = await visibilityWhere(ctx, 'calls', 'VIEW', { ownerField: 'callerId' });
  const tab = TABS.find(([, key]) => key === (params.tab ?? '')) ?? TABS[0];
  const where = mergeWhere(scope, tab[2], { deletedAt: null });

  // Today is the workspace's day, and a call made is one that rang, answered or
  // not, as the daily board counts it: a missed call is a call, a booked one is not.
  const timeZone = await workspaceTimezone(ctx);
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
        {TABS.map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/calls?tab=${key}` : '/calls'}
            aria-selected={(params.tab ?? '') === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {calls.length === 0 ? (
        <div className="lf-card">
          <EmptyState title="No calls yet" description="Start making calls to see your history here." />
        </div>
      ) : (
        <ConfigurableGrid object="CALL" columns={columns} rows={gridRows as any} />
      )}

      <Pager page={page} hasMore={hasMore} basePath="/calls" params={{ tab: params.tab }} />
    </>
  );
}
