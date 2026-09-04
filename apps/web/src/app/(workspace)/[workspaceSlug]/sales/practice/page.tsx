import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/ui/PageHeader';
import { practiceRecommendation } from '@/services/shared/practiceRecommendation';
import PracticeWorkspace from './PracticeWorkspace';

export const metadata = { title: 'Practice' };

export default async function PracticePage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['calls', 'VIEW'] });

  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const [objections, history, settings, usedToday, recommendation] = await Promise.all([
    prisma.objection.findMany({
      where: { tenantId: ctx.tenantId, isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
      take: 100,
    }),
    prisma.practiceSession.findMany({
      where: { tenantId: ctx.tenantId, userId: ctx.actor.id },
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        scenario: true,
        status: true,
        startedAt: true,
        score: { select: { status: true, overallScore: true, maxScore: true } },
      },
    }),
    prisma.organizationSetting.findFirst({
      where: { tenantId: ctx.tenantId },
      select: { practiceDailyCap: true },
    }),
    prisma.practiceSession.count({
      where: { tenantId: ctx.tenantId, userId: ctx.actor.id, startedAt: { gte: since } },
    }),
    // Advisory, from the rep's own audits — a failure must not take the page down.
    practiceRecommendation(ctx.tenantId, ctx.actor.id).catch(() => null),
  ]);

  const cap = settings?.practiceDailyCap ?? 10;

  return (
    <>
      <PageHeader
        title="Practice"
        description="Rehearse against an AI prospect — openers, discovery, objections and closes — and get scored on the same things call audits look for."
      />

      <PracticeWorkspace
        objections={objections}
        remainingToday={Math.max(0, cap - usedToday)}
        capEnabled={cap > 0}
        recommendation={recommendation}
      />

      {history.length > 0 && (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)', marginTop: 'var(--lf-space-4)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
            Your recent sessions
          </div>
          {/* Wrapped for the same reason the coaching tables are: lf-grid cells
              are nowrap, and a bare table inside a card clips instead of
              scrolling. The wrapper also carries the mobile card treatment. */}
          <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
            <table className="lf-grid">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>When</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {history.map((session) => {
                  const pct =
                    session.score?.maxScore != null && session.score.maxScore > 0
                      ? Math.round(((session.score.overallScore ?? 0) / session.score.maxScore) * 100)
                      : null;
                  return (
                    <tr key={session.id}>
                      <td data-label="Scenario" style={{ textTransform: 'capitalize' }}>
                        {session.scenario.toLowerCase()}
                      </td>
                      <td data-label="When" style={{ color: 'var(--lf-ink-2)' }}>
                        {session.startedAt.toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td data-label="Status">
                        <Badge tone={session.status === 'COMPLETED' ? 'viridian' : 'slate'}>
                          {session.status.toLowerCase().replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td data-label="Score" style={{ textAlign: 'right' }}>
                        {pct != null ? (
                          <span className="lf-num" style={{ fontWeight: 600 }}>
                            {pct}%
                          </span>
                        ) : session.score?.status === 'PROCESSING' || session.score?.status === 'PENDING' ? (
                          <span className="lf-hint">scoring…</span>
                        ) : (
                          <span style={{ color: 'var(--lf-ink-3)' }}>—</span>
                        )}
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
