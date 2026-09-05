'use client';

import MetricCard from '@/components/ui/MetricCard';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

/**
 * The chart ramp, repeated as literals.
 *
 * Recharts sets these as SVG presentation attributes (`fill`, `stroke`), and a
 * presentation attribute cannot resolve `var()` — this is the one place in the
 * product allowed to hold colour values rather than token names. They are the
 * same six as `--lf-chart-1…6` in tokens.css: brand blue leads, cyan follows,
 * then the widest-separated hues that still sit in one family. No rainbow.
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

      {/* Pipeline funnel */}
      {leadsByStage.length > 0 && (
        <div className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
            Pipeline by stage
          </div>
          <ResponsiveContainer width="100%" height={Math.max(200, leadsByStage.length * 40)}>
            <BarChart data={leadsByStage} layout="vertical" margin={{ left: 20, right: 20 }}>
              <XAxis type="number" hide />
              {/* No `fill` here: recharts writes it as an SVG presentation
                  attribute, which cannot resolve var(), so the label fell back
                  to black. The colour comes from the `.recharts-*` rules in
                  globals.css, where `fill` is a CSS property and tokens work. */}
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  background: 'var(--lf-surface)',
                  border: '1px solid var(--lf-line)',
                  borderRadius: 8,
                  color: 'var(--lf-ink)',
                }}
                itemStyle={{ color: 'var(--lf-ink)' }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {leadsByStage.map((_, i) => (
                  <Cell key={i} fill={PIPELINE_COLORS[i % PIPELINE_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Two pie charts side by side */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 'var(--lf-space-4)',
        }}
      >
        {leadsBySource.length > 0 && (
          <div className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
            <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
              Leads by source
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={leadsBySource} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                  {leadsBySource.map((_, i) => (
                    <Cell key={i} fill={PIPELINE_COLORS[i % PIPELINE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--lf-surface)',
                    border: '1px solid var(--lf-line)',
                    borderRadius: 8,
                    color: 'var(--lf-ink)',
                  }}
                  itemStyle={{ color: 'var(--lf-ink)' }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {slaStats.length > 0 && (
          <div className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
            <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
              SLA health
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={slaStats} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                  {slaStats.map((entry) => (
                    <Cell key={entry.key} fill={SLA_COLORS[entry.key] ?? SLATE} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--lf-surface)',
                    border: '1px solid var(--lf-line)',
                    borderRadius: 8,
                    color: 'var(--lf-ink)',
                  }}
                  itemStyle={{ color: 'var(--lf-ink)' }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
