import { requirePageAccess } from '@/lib/workspace-page';
import { mergeWhere } from '@/lib/api/where';
import { visibilityWhere } from '@/lib/security/visibility';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import MetricCard from '@/components/ui/MetricCard';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import Pager from '@/components/workspace/Pager';
import { columnsFor } from '@/lib/grid/resolve';
import { can } from '@/lib/security/rbac';

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
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['calls', 'VIEW'] });
  const page = Math.max(1, Number(params.page) || 1);

  // Role scope, not just own calls: a manager sees the team's history here the
  // same way the audits page already does.
  const scope = await visibilityWhere(ctx, 'calls', 'VIEW', { ownerField: 'callerId' });
  const tab = TABS.find(([, key]) => key === (params.tab ?? '')) ?? TABS[0];
  const where = mergeWhere(scope, tab[2], { deletedAt: null });

  const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
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
        durationSecs: true,
        startedAt: true,
        createdAt: true,
        leadId: true,
        notes: true,
        campaignId: true,
        caller: { select: { fullName: true } },
      },
    }),
    prisma.call.count({ where: { ...scope, deletedAt: null } }),
    prisma.call.groupBy({
      by: ['outcome'],
      where: { ...scope, deletedAt: null, status: 'COMPLETED', createdAt: { gte: todayStart } },
      _count: true,
    }),
  ]);

  const hasMore = rows.length > PAGE_SIZE;
  const calls = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

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
  const gridRows = calls.map((call) => ({
    ...call,
    lead: call.leadId ? (leadById.get(call.leadId) ?? null) : null,
  }));

  const todayTotal = stats.reduce((s, r) => s + r._count, 0);
  const todayConnected = stats
    .filter((r) => r.outcome && CONNECTED_OUTCOMES.includes(r.outcome))
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
            <SalesLink href="/calls/new" className="lf-btn" style={{ textDecoration: 'none' }}>
              New Call
            </SalesLink>
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
