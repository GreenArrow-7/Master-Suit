import { requirePageAccess, SELF_SERVICE } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { SCOPE_RANK, scopeFor } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Home' };

/* ── The day brief ──────────────────────────────────────────────────────────
   The page's signature. Instead of a row of identical metric boxes, the
   morning's numbers are read out as one composed sentence on the deep wine
   chrome — in priority order, each figure a link into the queue it counts.
   Sentence order IS the priority order: what must be cleared first is said
   first. Everything below the brief stays pearl and quiet. */

function BriefFigure({
  href,
  n,
  label,
  tone,
}: {
  href: string;
  n: number;
  label: string;
  tone: 'vermillion' | 'brass' | 'viridian' | 'neutral';
}) {
  const decoration =
    tone === 'vermillion'
      ? 'var(--lf-vermillion)'
      : tone === 'brass'
        ? 'var(--lf-brass)'
        : tone === 'viridian'
          ? 'var(--lf-viridian)'
          : 'var(--lf-wine-300)';
  return (
    <SalesLink
      href={href}
      style={{
        color: 'inherit',
        textDecoration: 'underline',
        textDecorationColor: decoration,
        textDecorationThickness: 2,
        textUnderlineOffset: 5,
        whiteSpace: 'nowrap',
      }}
    >
      <span className="lf-num" style={{ fontWeight: 650 }}>
        {n}
      </span>{' '}
      {label}
    </SalesLink>
  );
}

function DayBrief({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <header
      style={{
        background: 'var(--lf-wine-900)',
        color: 'var(--lf-wine-050)',
        borderRadius: 'var(--lf-radius-lg, 12px)',
        padding: 'var(--lf-space-6) var(--lf-space-6)',
        marginBottom: 'var(--lf-space-5)',
      }}
    >
      <div
        className="lf-eyebrow"
        style={{ color: 'var(--lf-wine-300)', marginBottom: 'var(--lf-space-3)', letterSpacing: '0.08em' }}
      >
        {eyebrow}
      </div>
      <p
        style={{
          margin: 0,
          font: '400 var(--lf-text-xl)/1.6 var(--lf-font-ui)',
          maxWidth: '46ch',
        }}
      >
        {children}
      </p>
    </header>
  );
}

const briefDate = () =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

/** A priority row in the attention ledger: what to clear, and where to do it. */
function LedgerRow({
  href,
  tone,
  title,
  detail,
}: {
  href: string;
  tone: 'vermillion' | 'brass' | 'viridian' | 'wine';
  title: string;
  detail: string;
}) {
  const rule =
    tone === 'vermillion'
      ? 'var(--lf-vermillion)'
      : tone === 'brass'
        ? 'var(--lf-brass)'
        : tone === 'viridian'
          ? 'var(--lf-viridian)'
          : 'var(--lf-wine-700)';
  return (
    <SalesLink
      href={href}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 'var(--lf-space-3)',
        padding: '11px var(--lf-space-4)',
        borderLeft: `3px solid ${rule}`,
        background: 'var(--lf-surface)',
        borderRadius: 'var(--lf-radius-sm)',
        textDecoration: 'none',
        color: 'inherit',
        boxShadow: 'var(--lf-shadow-1, 0 1px 2px rgba(28,20,24,.06))',
      }}
    >
      <span style={{ fontSize: 'var(--lf-text-sm)', fontWeight: 600 }}>{title}</span>
      <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>{detail}</span>
      <span aria-hidden style={{ marginLeft: 'auto', color: 'var(--lf-ink-4)' }}>
        →
      </span>
    </SalesLink>
  );
}

export default async function HomePage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: SELF_SERVICE });
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
      where: {
        tenantId: ctx.tenantId,
        ownerId: ctx.actor.id,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        dueAt: { lt: now },
        deletedAt: null,
      },
    }),
    prisma.followUpTask.count({
      where: {
        tenantId: ctx.tenantId,
        ownerId: ctx.actor.id,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        dueAt: { gte: now, lte: todayEnd },
        deletedAt: null,
      },
    }),
    prisma.lead.findMany({
      where: { tenantId: ctx.tenantId, ownerId: ctx.actor.id, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        reference: true,
        fullName: true,
        company: true,
        score: true,
        slaState: true,
        stage: { select: { name: true, key: true } },
      },
    }),
  ]);

  return (
    <>
      <h1 className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        My day
      </h1>
      <DayBrief eyebrow={briefDate()}>
        {overdueFollowUps > 0 ? (
          <>
            Clear <BriefFigure href="/follow-ups?due=overdue" n={overdueFollowUps} label={overdueFollowUps === 1 ? 'overdue follow-up' : 'overdue follow-ups'} tone="vermillion" /> first.
            Then <BriefFigure href="/follow-ups?due=today" n={todayFollowUps} label="due today" tone="brass" />, across{' '}
            <BriefFigure href="/leads?filter=mine" n={assignedLeads} label={assignedLeads === 1 ? 'open lead' : 'open leads'} tone="neutral" />.
          </>
        ) : (
          <>
            Nothing overdue. <BriefFigure href="/follow-ups?due=today" n={todayFollowUps} label="due today" tone={todayFollowUps ? 'brass' : 'viridian'} />{' '}
            across <BriefFigure href="/leads?filter=mine" n={assignedLeads} label={assignedLeads === 1 ? 'open lead' : 'open leads'} tone="neutral" />.
          </>
        )}
      </DayBrief>

      {(overdueFollowUps > 0 || todayFollowUps > 0) && (
        <section aria-label="What to clear first" style={{ display: 'grid', gap: 'var(--lf-space-2)', marginBottom: 'var(--lf-space-4)' }}>
          {overdueFollowUps > 0 && (
            <LedgerRow
              href="/follow-ups?due=overdue"
              tone="vermillion"
              title={`${overdueFollowUps} overdue follow-up${overdueFollowUps === 1 ? '' : 's'}`}
              detail="promised and not yet done — these age worst"
            />
          )}
          {todayFollowUps > 0 && (
            <LedgerRow
              href="/follow-ups?due=today"
              tone="brass"
              title={`${todayFollowUps} due today`}
              detail="on time if done before the day ends"
            />
          )}
        </section>
      )}

      {targets.length > 0 && (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)', marginTop: 'var(--lf-space-4)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>
            Today&apos;s targets
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {targets.map((t) => {
              const achieved = t.progress[0]?.achieved ?? 0;
              const pct = Math.min(100, Math.round((achieved / t.targetValue) * 100));
              return (
                <div
                  key={t.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(100px, 190px) minmax(0, 1fr) 72px',
                    alignItems: 'center',
                    gap: 'var(--lf-space-3)',
                  }}
                >
                  <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
                    {t.metric.replace(/_/g, ' ').toLowerCase()}
                  </span>
                  <div
                    style={{
                      height: 8,
                      background: 'var(--lf-surface-2)',
                      borderRadius: 4,
                      overflow: 'hidden',
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
                  <span
                    className="lf-num"
                    style={{ fontSize: 'var(--lf-text-sm)', textAlign: 'right', color: pct >= 100 ? 'var(--lf-viridian)' : 'var(--lf-ink-2)' }}
                  >
                    {achieved}/{t.targetValue}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="lf-card" style={{ padding: 'var(--lf-space-5)', marginTop: 'var(--lf-space-4)' }}>
        <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
          My leads
        </div>
        {recentLeads.length === 0 ? (
          <EmptyState title="No leads assigned" description="Your manager will assign leads to you." />
        ) : (
          <div style={{ display: 'grid' }}>
            {recentLeads.map((lead) => (
              <SalesLink
                key={lead.id}
                href={`/leads/${lead.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--lf-space-3)',
                  padding: '9px 0',
                  borderBottom: '1px solid var(--lf-line)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <span className="lf-avatar">
                  {lead.fullName
                    .split(' ')
                    .slice(0, 2)
                    .map((p) => p[0])
                    .join('')}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 'var(--lf-text-sm)',
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {lead.fullName}
                  </span>
                  <span className="lf-num" style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>
                    {lead.reference}
                    {lead.company ? ` · ${lead.company}` : ''}
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
      where,
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        reference: true,
        fullName: true,
        company: true,
        score: true,
        slaState: true,
        stage: { select: { name: true, key: true } },
      },
    }),
  ]);

  const stages = await prisma.leadStage.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { position: 'asc' } });
  const counts = new Map(byStage.map((s) => [s.stageId, s._count._all]));
  const funnel = stages
    .filter((s) => s.category === 'OPEN')
    .map((s) => ({ name: s.name, count: counts.get(s.id) ?? 0 }));
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
      <h1 className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        The floor
      </h1>
      <DayBrief eyebrow={`${briefDate()} · scoped to your ${ctx.actor.roleKey.replace(/_/g, ' ')} visibility`}>
        <BriefFigure href="/leads" n={total} label="leads in scope" tone="neutral" />
        {breached > 0 && (
          <>
            {' — '}
            <BriefFigure href="/leads?filter=breached" n={breached} label={breached === 1 ? 'SLA breach' : 'SLA breaches'} tone="vermillion" />
          </>
        )}
        {overdue > 0 && (
          <>
            {breached > 0 ? ', ' : ' — '}
            <BriefFigure href="/leads?filter=overdue" n={overdue} label="overdue" tone="brass" />
          </>
        )}
        {unassigned > 0 && (
          <>
            {breached > 0 || overdue > 0 ? ' and ' : ' — '}
            <BriefFigure href="/leads?filter=unassigned" n={unassigned} label="waiting for an owner" tone="neutral" />
          </>
        )}
        {breached === 0 && overdue === 0 && unassigned === 0 && <>. Every lead is owned and on time.</>}
        {(breached > 0 || overdue > 0 || unassigned > 0) && <>.</>}
      </DayBrief>

      {(breached > 0 || unassigned > 0) && (
        <section aria-label="What to clear first" style={{ display: 'grid', gap: 'var(--lf-space-2)', marginBottom: 'var(--lf-space-4)' }}>
          {breached > 0 && (
            <LedgerRow
              href="/leads?filter=breached"
              tone="vermillion"
              title={`${breached} SLA breach${breached === 1 ? '' : 'es'}`}
              detail="a promised response time has already passed"
            />
          )}
          {unassigned > 0 && (
            <LedgerRow
              href="/leads?filter=unassigned"
              tone="wine"
              title={`${unassigned} unassigned lead${unassigned === 1 ? '' : 's'}`}
              detail="nobody is working these yet — hand them out"
            />
          )}
        </section>
      )}

      <div className="lf-cols-2" style={{ marginTop: 'var(--lf-space-4)' }}>
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>
            Pipeline by stage
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {funnel.map((row, i) => (
              <div
                key={row.name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(90px, 132px) minmax(0, 1fr) 48px',
                  alignItems: 'center',
                  gap: 'var(--lf-space-3)',
                }}
              >
                <span
                  style={{
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
                    height: 18,
                    background: 'var(--lf-surface-2)',
                    borderRadius: 'var(--lf-radius-sm)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${(row.count / peak) * 100}%`,
                      height: '100%',
                      background: `color-mix(in oklab, var(--lf-wine-700) ${28 + (i / Math.max(funnel.length - 1, 1)) * 60}%, var(--lf-wine-050))`,
                      borderRadius: 'var(--lf-radius-sm)',
                      transition: 'width 400ms ease',
                    }}
                  />
                </div>
                <span
                  className="lf-num"
                  style={{ fontSize: 'var(--lf-text-sm)', textAlign: 'right', color: 'var(--lf-ink-2)' }}
                >
                  {row.count}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
            Recently updated
          </div>
          <div style={{ display: 'grid' }}>
            {recent.map((lead) => (
              <SalesLink
                key={lead.id}
                href={`/leads/${lead.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--lf-space-3)',
                  padding: '9px 0',
                  borderBottom: '1px solid var(--lf-line)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <span className="lf-avatar">
                  {lead.fullName
                    .split(' ')
                    .slice(0, 2)
                    .map((p) => p[0])
                    .join('')}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 'var(--lf-text-sm)',
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {lead.fullName}
                  </span>
                  <span className="lf-num" style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>
                    {lead.reference}
                    {lead.company ? ` · ${lead.company}` : ''}
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
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-4)' }}>
            Team target progress — {todayKey}
          </div>
          <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
            <table className="lf-grid">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Metric</th>
                  <th>Target</th>
                  <th>Done</th>
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {[...byUser.values()].map(({ name, targets: ts }) =>
                  ts.map((t, i) => {
                    const achieved = t.progress[0]?.achieved ?? 0;
                    const pct = Math.min(100, Math.round((achieved / t.targetValue) * 100));
                    return (
                      <tr key={t.id}>
                        {i === 0 && (
                          <td rowSpan={ts.length} style={{ fontWeight: 500 }}>
                            {name}
                          </td>
                        )}
                        <td>{t.metric.replace(/_/g, ' ').toLowerCase()}</td>
                        <td className="lf-num">{t.targetValue}</td>
                        <td className="lf-num">{achieved}</td>
                        <td>
                          <Badge tone={pct >= 100 ? 'viridian' : pct >= 50 ? 'brass' : 'vermillion'}>{pct}%</Badge>
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
