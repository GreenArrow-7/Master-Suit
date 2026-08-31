'use client';

import MetricCard from '@/components/ui/MetricCard';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

// Design system colors hardcoded for recharts (can't read CSS vars in SVG props)
const WINE = '#722F37';
const BRASS = '#B5A642';
const VIRIDIAN = '#40826D';
const VERMILLION = '#E34234';
const SLATE = '#64748B';
const PIPELINE_COLORS = [WINE, BRASS, VIRIDIAN, VERMILLION, SLATE, '#8B5CF6', '#0EA5E9', '#F59E0B'];
const SLA_COLORS: Record<string, string> = {
  ON_TRACK: SLATE,
  AT_RISK: BRASS,
  BREACHED: VERMILLION,
  MET: VIRIDIAN,
  PAUSED: '#94A3B8',
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
        <MetricCard label="Total Leads" value={totalLeads} tone="wine" />
        <MetricCard label="New This Month" value={newThisMonth} tone="brass" />
        {openTasks !== null && <MetricCard label="Open Tasks" value={openTasks} tone="slate" />}
        {overdueTasks !== null && (
          <MetricCard label="Overdue Tasks" value={overdueTasks} tone={overdueTasks > 0 ? 'vermillion' : 'viridian'} />
        )}
        {activitiesThisMonth !== null && (
          <MetricCard label="Activities This Month" value={activitiesThisMonth} tone="slate" />
        )}
      </div>

      {/* Pipeline funnel */}
      {leadsByStage.length > 0 && (
        <div className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
            Pipeline by Stage
          </div>
          <ResponsiveContainer width="100%" height={Math.max(200, leadsByStage.length * 40)}>
            <BarChart data={leadsByStage} layout="vertical" margin={{ left: 20, right: 20 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 13, fill: 'var(--lf-ink-2)' }} />
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
              Leads by Source
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
              SLA Health
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
