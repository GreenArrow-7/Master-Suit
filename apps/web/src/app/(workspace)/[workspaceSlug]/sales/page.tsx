import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { visibilityWhere } from '@/lib/security/visibility';
import { can, SCOPE_RANK, scopeFor } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import MetricCard from '@/components/ui/MetricCard';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Home' };

export default async function HomePage() {
  const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());
  const isManager = SCOPE_RANK[scopeFor(ctx, 'leads', 'ASSIGN')] >= SCOPE_RANK.TEAM;

  if (isManager) return <ManagerHome ctx={ctx} />;
  return <EmployeeHome ctx={ctx} />;
}

async function EmployeeHome({ ctx }: { ctx: any }) {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const [targets, assignedLeads, overdueFollowUps, todayFollowUps, recentLeads] = await Promise.all([
    prisma.employeeTarget.findMany({
      where: { tenantId: ctx.tenantId, userId: ctx.actor.id, periodStart: { lte: now }, periodEnd: { gte: now } },
      include: { progress: { where: { dateKey: todayKey } } },
      orderBy: { metric: 'asc' },
    }),
    prisma.lead.count({
      where: { tenantId: ctx.tenantId, ownerId: ctx.actor.id, deletedAt: null, stage: { category: 'OPEN' } },
    }),
    prisma.followUpTask.count({
      where: { tenantId: ctx.tenantId, ownerId: ctx.actor.id, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lt: now }, deletedAt: null },
    }),
    prisma.followUpTask.count({
      where: { tenantId: ctx.tenantId, ownerId: ctx.actor.id, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { gte: now, lte: todayEnd }, deletedAt: null },
    }),
    prisma.lead.findMany({
      where: { tenantId: ctx.tenantId, ownerId: ctx.actor.id, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: { id: true, reference: true, fullName: true, company: true, score: true, slaState: true, stage: { select: { name: true, key: true } } },
    }),
  ]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--lf-space-5)' }}>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>My Dashboard</h1>
        <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
          {todayKey}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))', gap: 'var(--lf-space-4)' }}>
        <MetricCard label="Assigned leads" value={assignedLeads} href="/leads?filter=mine" />
        <MetricCard label="Overdue follow-ups" value={overdueFollowUps} tone={overdueFollowUps ? 'vermillion' : 'viridian'} href="/follow-ups?due=overdue" />
        <MetricCard label="Due today" value={todayFollowUps} tone={todayFollowUps ? 'brass' : 'slate'} href="/follow-ups?due=today" />
      </div>

      {targets.length > 0 && (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)', marginTop: 'var(--lf-space-4)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>Daily targets</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {targets.map((t) => {
              const achieved = t.progress[0]?.achieved ?? 0;
              const pct = Math.min(100, Math.round((achieved / t.targetValue) * 100));
              return (
                <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 80px', alignItems: 'center', gap: 'var(--lf-space-3)' }}>
                  <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
                    {t.metric.replace(/_/g, ' ').toLowerCase()}
                  </span>
                  <div style={{ height: 18, background: 'var(--lf-surface-2)', borderRadius: 'var(--lf-radius-sm)', overflow: 'hidden' }}>
                    <div style={{
                      width: `${pct}%`, height: '100%',
                      background: pct >= 100 ? 'var(--lf-viridian)' : pct >= 50 ? 'var(--lf-brass-edge)' : 'var(--lf-wine-700)',
                      borderRadius: 'var(--lf-radius-sm)', transition: 'width 400ms ease',
                    }} />
                  </div>
                  <span className="lf-num" style={{ fontSize: 'var(--lf-text-sm)', textAlign: 'right', color: 'var(--lf-ink-2)' }}>
                    {achieved}/{t.targetValue} ({pct}%)
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="lf-card" style={{ padding: 'var(--lf-space-5)', marginTop: 'var(--lf-space-4)' }}>
        <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>My leads</div>
        {recentLeads.length === 0 ? (
          <EmptyState title="No leads assigned" description="Your manager will assign leads to you." />
        ) : (
          <div style={{ display: 'grid' }}>
            {recentLeads.map((lead) => (
              <SalesLink key={lead.id} href={`/leads/${lead.id}`} style={{
                display: 'flex', alignItems: 'center', gap: 'var(--lf-space-3)',
                padding: '9px 0', borderBottom: '1px solid var(--lf-line)',
                textDecoration: 'none', color: 'inherit',
              }}>
                <span className="lf-avatar">{lead.fullName.split(' ').slice(0, 2).map((p) => p[0]).join('')}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 'var(--lf-text-sm)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {lead.fullName}
                  </span>
                  <span className="lf-num" style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>
                    {lead.reference}{lead.company ? ` · ${lead.company}` : ''}
                  </span>
                </span>
                <Badge value={lead.stage.key} />
              </SalesLink>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

async function ManagerHome({ ctx }: { ctx: any }) {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const where = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });

  const [total, unassigned, overdue, breached, teamTargets, byStage, recent] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { ...where, ownerId: null } }),
    prisma.lead.count({ where: { ...where, nextFollowUpAt: { lt: now } } }),
    prisma.lead.count({ where: { ...where, slaState: 'BREACHED' } }),
    prisma.employeeTarget.findMany({
      where: { tenantId: ctx.tenantId, periodStart: { lte: now }, periodEnd: { gte: now } },
      include: {
        progress: { where: { dateKey: todayKey } },
        user: { select: { id: true, fullName: true } },
      },
      orderBy: [{ userId: 'asc' }, { metric: 'asc' }],
    }),
    prisma.lead.groupBy({ by: ['stageId'], where, _count: { _all: true } }),
    prisma.lead.findMany({
      where, orderBy: { updatedAt: 'desc' }, take: 8,
      select: { id: true, reference: true, fullName: true, company: true, score: true, slaState: true, stage: { select: { name: true, key: true } } },
    }),
  ]);

  const stages = await prisma.leadStage.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { position: 'asc' } });
  const counts = new Map(byStage.map((s) => [s.stageId, s._count._all]));
  const funnel = stages.filter((s) => s.category === 'OPEN').map((s) => ({ name: s.name, count: counts.get(s.id) ?? 0 }));
  const peak = Math.max(1, ...funnel.map((f) => f.count));

  // group targets by user
  const byUser = new Map<string, { name: string; targets: typeof teamTargets }>();
  for (const t of teamTargets) {
    const entry = byUser.get(t.userId) ?? { name: t.user.fullName, targets: [] };
    entry.targets.push(t);
    byUser.set(t.userId, entry);
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--lf-space-5)' }}>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>Manager Dashboard</h1>
        <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
          Scoped to your {ctx.actor.roleKey.replace(/_/g, ' ')} visibility
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))', gap: 'var(--lf-space-4)' }}>
        <MetricCard label="Leads in scope" value={total} href="/leads" />
        <MetricCard label="Unassigned" value={unassigned} tone={unassigned ? 'wine' : 'slate'} href="/leads?filter=unassigned" />
        <MetricCard label="Overdue follow-up" value={overdue} tone={overdue ? 'brass' : 'slate'} href="/leads?filter=overdue" />
        <MetricCard label="SLA breached" value={breached} tone={breached ? 'vermillion' : 'viridian'} href="/leads?filter=breached" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', gap: 'var(--lf-space-4)', marginTop: 'var(--lf-space-4)' }}>
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>Pipeline by stage</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {funnel.map((row, i) => (
              <div key={row.name} style={{ display: 'grid', gridTemplateColumns: '132px 1fr 48px', alignItems: 'center', gap: 'var(--lf-space-3)' }}>
                <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.name}
                </span>
                <div style={{ height: 18, background: 'var(--lf-surface-2)', borderRadius: 'var(--lf-radius-sm)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${(row.count / peak) * 100}%`, height: '100%',
                    background: `color-mix(in oklab, var(--lf-wine-700) ${28 + (i / Math.max(funnel.length - 1, 1)) * 60}%, var(--lf-wine-050))`,
                    borderRadius: 'var(--lf-radius-sm)', transition: 'width 400ms ease',
                  }} />
                </div>
                <span className="lf-num" style={{ fontSize: 'var(--lf-text-sm)', textAlign: 'right', color: 'var(--lf-ink-2)' }}>
                  {row.count}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>Recently updated</div>
          <div style={{ display: 'grid' }}>
            {recent.map((lead) => (
              <SalesLink key={lead.id} href={`/leads/${lead.id}`} style={{
                display: 'flex', alignItems: 'center', gap: 'var(--lf-space-3)',
                padding: '9px 0', borderBottom: '1px solid var(--lf-line)',
                textDecoration: 'none', color: 'inherit',
              }}>
                <span className="lf-avatar">{lead.fullName.split(' ').slice(0, 2).map((p) => p[0]).join('')}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 'var(--lf-text-sm)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {lead.fullName}
                  </span>
                  <span className="lf-num" style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>
                    {lead.reference}{lead.company ? ` · ${lead.company}` : ''}
                  </span>
                </span>
                <Badge value={lead.stage.key} />
              </SalesLink>
            ))}
          </div>
        </section>
      </div>

      {byUser.size > 0 && (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)', marginTop: 'var(--lf-space-4)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>Team target progress — {todayKey}</div>
          <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
            <table className="lf-grid">
              <thead>
                <tr><th>Employee</th><th>Metric</th><th>Target</th><th>Done</th><th>%</th></tr>
              </thead>
              <tbody>
                {[...byUser.entries()].map(([uid, { name, targets: ts }]) =>
                  ts.map((t, i) => {
                    const achieved = t.progress[0]?.achieved ?? 0;
                    const pct = Math.min(100, Math.round((achieved / t.targetValue) * 100));
                    return (
                      <tr key={t.id}>
                        {i === 0 && <td rowSpan={ts.length} style={{ fontWeight: 500 }}>{name}</td>}
                        <td>{t.metric.replace(/_/g, ' ').toLowerCase()}</td>
                        <td className="lf-num">{t.targetValue}</td>
                        <td className="lf-num">{achieved}</td>
                        <td>
                          <Badge tone={pct >= 100 ? 'viridian' : pct >= 50 ? 'brass' : 'vermillion'}>
                            {pct}%
                          </Badge>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
