import { requirePageAccess, SELF_SERVICE } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import SignOff from './SignOff';
import ListHeader from '@/components/workspace/ListHeader';
import { can, scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import TargetAdmin, { TargetDelete } from './TargetAdmin';
import { METRICS } from './metrics';

export const metadata = { title: 'My Targets' };

const METRIC_LABEL = Object.fromEntries(METRICS);

// One copy in services/targets/progress.ts, shared with the sales overview:
// two screens computing "achieved" differently is how the same target read
// 38% here and 0% there.
import { achievedWithin as achievedFor, type ProgressRow } from '@/services/targets/progress';

function TargetCard({
  target,
}: {
  target: {
    id: string;
    metric: string;
    period: string;
    targetValue: number;
    periodStart: Date;
    periodEnd: Date;
    progress: ProgressRow[];
  };
}) {
  const achieved = achievedFor(target);
  const pct = Math.min(100, Math.round((achieved / target.targetValue) * 100));
  const remaining = Math.max(0, target.targetValue - achieved);
  return (
    <div className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 'var(--lf-space-3)',
        }}
      >
        <div>
          <div style={{ fontSize: 'var(--lf-text-sm)', fontWeight: 600 }}>
            {METRIC_LABEL[target.metric] ?? target.metric.replace(/_/g, ' ').toLowerCase()}
          </div>
          <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>
            {target.period.toLowerCase()} target
          </div>
        </div>
        <Badge tone={pct >= 100 ? 'viridian' : pct >= 50 ? 'brass' : 'slate'}>{pct}%</Badge>
      </div>
      <div
        style={{
          height: 8,
          background: 'var(--lf-surface-2)',
          borderRadius: 4,
          overflow: 'hidden',
          marginBottom: 'var(--lf-space-3)',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: pct >= 100 ? 'var(--lf-viridian)' : 'var(--lf-wine-700)',
            borderRadius: 4,
            transition: 'width 400ms ease',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 'var(--lf-text-sm)',
          color: 'var(--lf-ink-2)',
        }}
      >
        <span>{achieved} done</span>
        <span>{remaining} remaining</span>
        <span className="lf-num">{target.targetValue} target</span>
      </div>
    </div>
  );
}

export default async function TargetsPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: SELF_SERVICE });
  const now = new Date();

  const managesTargets = can(ctx, 'leads', 'ASSIGN') && SCOPE_RANK[scopeFor(ctx, 'leads', 'ASSIGN')] >= SCOPE_RANK.TEAM;

  const [mine, teamTargets, users] = await Promise.all([
    prisma.employeeTarget.findMany({
      where: { tenantId: ctx.tenantId, userId: ctx.actor.id, periodStart: { lte: now }, periodEnd: { gte: now } },
      include: { progress: true },
      orderBy: [{ period: 'asc' }, { metric: 'asc' }],
    }),
    managesTargets
      ? prisma.employeeTarget.findMany({
          where: { tenantId: ctx.tenantId, periodEnd: { gte: now } },
          include: { progress: true, user: { select: { id: true, fullName: true } } },
          orderBy: [{ periodStart: 'desc' }],
          take: 100,
        })
      : Promise.resolve([]),
    managesTargets
      ? prisma.user.findMany({
          where: { tenantId: ctx.tenantId, status: 'ACTIVE', deletedAt: null },
          orderBy: { fullName: 'asc' },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
  ]);

  const outstanding = mine.reduce((sum, t) => sum + Math.max(0, t.targetValue - achievedFor(t)), 0);
  const dateFmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

  return (
    <>
      <ListHeader title="My targets" count={mine.length} noun="active target" />

      {mine.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="No active targets"
            description={
              managesTargets
                ? 'Assign yourself or a teammate a target below.'
                : 'Your manager has not assigned any targets yet.'
            }
          />
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 'var(--lf-space-4)',
            marginTop: 'var(--lf-space-4)',
          }}
        >
          {mine.map((t) => (
            <TargetCard key={t.id} target={t} />
          ))}
        </div>
      )}

      {mine.length > 0 && <SignOff complete={outstanding === 0} remaining={outstanding} />}

      {managesTargets && (
        <section style={{ marginTop: 'var(--lf-space-6)', display: 'grid', gap: 'var(--lf-space-4)' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 'var(--lf-space-4)',
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 'var(--lf-text-lg)' }}>Team targets</h2>
              <p style={{ margin: '4px 0 0', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
                Current and upcoming targets across your scope. Progress counts automatically as calls, follow-ups and
                conversions are logged.
              </p>
            </div>
          </div>

          <TargetAdmin users={users} />

          {teamTargets.length > 0 && (
            <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
              <table className="lf-grid">
                <thead>
                  <tr>
                    <th>Teammate</th>
                    <th>Target</th>
                    <th>Cadence</th>
                    <th>Window</th>
                    <th>Progress</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {teamTargets.map((t) => {
                    const achieved = achievedFor(t);
                    const pct = Math.min(100, Math.round((achieved / t.targetValue) * 100));
                    return (
                      <tr key={t.id}>
                        <td data-label="Teammate" style={{ fontWeight: 500 }}>
                          {t.user?.fullName ?? '—'}
                        </td>
                        <td data-label="Target">
                          {t.targetValue} × {METRIC_LABEL[t.metric] ?? t.metric.replace(/_/g, ' ').toLowerCase()}
                        </td>
                        <td data-label="Cadence">{t.period.toLowerCase()}</td>
                        <td data-label="Window" style={{ whiteSpace: 'nowrap' }}>
                          {dateFmt(t.periodStart)} – {dateFmt(t.periodEnd)}
                        </td>
                        <td data-label="Progress" style={{ minWidth: 140 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--lf-space-2)' }}>
                            <Badge tone={pct >= 100 ? 'viridian' : pct >= 50 ? 'brass' : 'slate'}>{pct}%</Badge>
                            <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
                              {achieved} / {t.targetValue}
                            </span>
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <TargetDelete id={t.id} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
