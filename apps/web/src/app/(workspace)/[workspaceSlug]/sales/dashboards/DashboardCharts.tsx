import MetricCard from '@/components/ui/MetricCard';

/**
 * The chart ramp. Brand blue leads, cyan follows, then the widest-separated hues
 * that still sit in one family. No rainbow. Mid-tone on purpose: a series is a
 * fill, so it needs 3:1 against both white and midnight.
 */
const BLUE = '#3B82F6';
const CYAN = '#06B6D4';
const GREEN = '#10B981';
const AMBER = '#F59E0B';
const VIOLET = '#8B5CF6';
const SLATE = '#64748B';
const PIPELINE_COLORS = [BLUE, CYAN, GREEN, AMBER, VIOLET, SLATE, '#2455E6', '#0E7490'];
/** SLA is a status, not a category: breached is red and met is green everywhere. */
const SLA_COLORS: Record<string, string> = {
  ON_TRACK: BLUE,
  AT_RISK: AMBER,
  BREACHED: '#EF4444',
  MET: GREEN,
  PAUSED: SLATE,
};

interface Row {
  name: string;
  count: number;
  color: string;
}

interface Props {
  totalLeads: number;
  newThisMonth: number;
  // null when the viewer lacks the grant behind the tile — it is dropped, not zeroed.
  openTasks: number | null;
  overdueTasks: number | null;
  activitiesThisMonth: number | null;
  leadsByStage: { name: string; count: number }[];
  leadsBySource: { name: string; count: number }[];
  slaStats: { name: string; key: string; count: number }[];
}

const ramp = (rows: { name: string; count: number }[]): Row[] =>
  rows.map((row, i) => ({ ...row, color: PIPELINE_COLORS[i % PIPELINE_COLORS.length]! }));

/**
 * One horizontal bar per row, scaled to the largest, with the count beside it.
 * Flex rather than an inline grid: the phone stylesheet turns every inline
 * grid-template-columns into one column, which would stack label, bar and count.
 */
function Bars({ rows }: { rows: Row[] }) {
  const peak = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((row) => (
        <div
          key={row.name}
          style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 'var(--lf-space-3)' }}
        >
          <span
            style={{
              flex: '0 0 clamp(70px, 25%, 130px)',
              fontSize: 'var(--lf-text-sm)',
              color: 'var(--lf-ink-2)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.name}
          </span>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              height: 24,
              background: 'var(--lf-surface-2)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div style={{ width: `${(row.count / peak) * 100}%`, height: '100%', background: row.color }} />
          </div>
          <span className="lf-num" style={{ flex: '0 0 32px', fontSize: 'var(--lf-text-sm)', textAlign: 'right' }}>
            {row.count}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A conic-gradient donut; the legend beside it is the readable data. */
function Donut({ rows }: { rows: Row[] }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  let at = 0;
  const stops = rows.map((row) => {
    const from = at;
    at += (row.count / Math.max(total, 1)) * 100;
    return `${row.color} ${from}% ${at}%`;
  });
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--lf-space-5)' }}>
      <div
        aria-hidden
        style={{
          width: 150,
          height: 150,
          flex: 'none',
          borderRadius: '50%',
          background: `conic-gradient(${stops.join(', ')})`,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <span
          className="lf-num"
          style={{
            width: '58%',
            height: '58%',
            borderRadius: '50%',
            background: 'var(--lf-surface)',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 650,
          }}
        >
          {total}
        </span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, flex: '1 1 150px' }}>
        {rows.map((row) => (
          <li key={row.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--lf-text-sm)' }}>
            <span
              aria-hidden
              style={{ width: 10, height: 10, flex: 'none', borderRadius: '50%', background: row.color }}
            />
            <span style={{ color: 'var(--lf-ink-2)' }}>{row.name}</span>
            <span className="lf-num" style={{ marginLeft: 'auto' }}>
              {row.count} · {Math.round((row.count / Math.max(total, 1)) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export default function DashboardCharts({
  totalLeads,
  newThisMonth,
  openTasks,
  overdueTasks,
  activitiesThisMonth,
  leadsByStage,
  leadsBySource,
  slaStats,
}: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--lf-space-4)' }}>
      {/* KPI tiles */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--lf-space-4)',
        }}
      >
        <MetricCard label="Total leads" value={totalLeads} />
        <MetricCard label="New this month" value={newThisMonth} />
        {openTasks !== null && <MetricCard label="Open tasks" value={openTasks} tone="slate" />}
        {overdueTasks !== null && (
          <MetricCard label="Overdue tasks" value={overdueTasks} tone={overdueTasks > 0 ? 'vermillion' : 'viridian'} />
        )}
        {activitiesThisMonth !== null && (
          <MetricCard label="Activities this month" value={activitiesThisMonth} tone="slate" />
        )}
      </div>

      {leadsByStage.length > 0 && (
        <ChartCard title="Pipeline by stage">
          <Bars rows={ramp(leadsByStage)} />
        </ChartCard>
      )}

      {/* Every lead has a source and an SLA state, so the two cards come as a pair:
          side by side, and one per row on a phone (no repeat(), see Bars). */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 'var(--lf-space-4)',
        }}
      >
        {leadsBySource.length > 0 && (
          <ChartCard title="Leads by source">
            <Donut rows={ramp(leadsBySource)} />
          </ChartCard>
        )}
        {slaStats.length > 0 && (
          <ChartCard title="SLA health">
            <Donut rows={slaStats.map((row) => ({ ...row, color: SLA_COLORS[row.key] ?? SLATE }))} />
          </ChartCard>
        )}
      </div>
    </div>
  );
}
