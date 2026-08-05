import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import SignOff from './SignOff';
import ListHeader from '@/components/workspace/ListHeader';

export const metadata = { title: 'My Targets' };

export default async function TargetsPage() {
  const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);

  const targets = await prisma.employeeTarget.findMany({
    where: { tenantId: ctx.tenantId, userId: ctx.actor.id, periodStart: { lte: now }, periodEnd: { gte: now } },
    include: { progress: { where: { dateKey: todayKey } } },
    orderBy: [{ period: 'asc' }, { metric: 'asc' }],
  });

  const outstanding = targets.reduce(
    (sum, t) => sum + Math.max(0, t.targetValue - (t.progress[0]?.achieved ?? 0)),
    0,
  );

  return (
    <>
      <ListHeader title="My targets" count={targets.length} noun="active target" />

      {targets.length === 0 ? (
        <div className="lf-card">
          <EmptyState title="No active targets" description="Your manager has not assigned any targets yet." />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--lf-space-4)', marginTop: 'var(--lf-space-4)' }}>
          {targets.map((t) => {
            const achieved = t.progress[0]?.achieved ?? 0;
            const pct = Math.min(100, Math.round((achieved / t.targetValue) * 100));
            const remaining = Math.max(0, t.targetValue - achieved);
            return (
              <div key={t.id} className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--lf-space-3)' }}>
                  <div>
                    <div style={{ fontSize: 'var(--lf-text-sm)', fontWeight: 600, textTransform: 'capitalize' }}>
                      {t.metric.replace(/_/g, ' ').toLowerCase()}
                    </div>
                    <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>
                      {t.period.toLowerCase()} target
                    </div>
                  </div>
                  <Badge tone={pct >= 100 ? 'viridian' : pct >= 50 ? 'brass' : 'slate'}>
                    {pct}%
                  </Badge>
                </div>
                <div style={{ height: 8, background: 'var(--lf-surface-2)', borderRadius: 4, overflow: 'hidden', marginBottom: 'var(--lf-space-3)' }}>
                  <div style={{
                    width: `${pct}%`, height: '100%',
                    background: pct >= 100 ? 'var(--lf-viridian)' : 'var(--lf-wine-700)',
                    borderRadius: 4, transition: 'width 400ms ease',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
                  <span>{achieved} done</span>
                  <span>{remaining} remaining</span>
                  <span className="lf-num">{t.targetValue} target</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {targets.length > 0 && <SignOff complete={outstanding === 0} remaining={outstanding} />}
    </>
  );
}
