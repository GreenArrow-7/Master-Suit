import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import {
  activityCompliance,
  chasingQueue,
  conversion,
  funnel,
  interactionFeed,
  performerBoard,
  subtree,
} from '@/services/leadership/rollups';
import { profitAndLoss } from '@/services/leadership/pl';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Leadership' };

const TABS = [
  ['Overview', ''],
  ['Compliance', 'compliance'],
  ['Chasing', 'chasing'],
  ['Feed', 'feed'],
  ['P&L', 'pl'],
] as const;

const pct = (n: number | null) => (n === null ? '—' : `${n}%`);

const money = (amount: { toString(): string } | null, currency: string) =>
  amount === null
    ? '—'
    : `${currency} ${Number(amount.toString()).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The leader's page.
 *
 * The scope is decided once, by `subtree`, and handed to every panel, so two
 * panels cannot end up describing different teams. Likewise the date range:
 * this month so far, computed here and passed down, rather than each panel
 * picking its own idea of "recent".
 */
export default async function LeadershipPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['reports', 'VIEW'] });
  const view = TABS.some(([, k]) => k === params.view) ? (params.view ?? '') : '';

  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(1);
  from.setUTCHours(0, 0, 0, 0);
  const range = { from, to };

  const userIds = await subtree(ctx);

  const [stages, rates, board, chasing, compliance, feed, pl] = await Promise.all([
    funnel(ctx.tenantId, userIds, range),
    conversion(ctx.tenantId, userIds, range),
    performerBoard(ctx.tenantId, userIds, range, 'revenue'),
    chasingQueue(ctx.tenantId, userIds, new Date(), 50),
    view === 'compliance' ? activityCompliance(ctx.tenantId, userIds, range) : [],
    view === 'feed' ? interactionFeed(ctx.tenantId, userIds, range, 50) : [],
    view === 'pl' ? profitAndLoss(ctx.tenantId, userIds, from, to, 'team') : null,
  ]);

  const names = await prisma.user.findMany({
    where: { tenantId: ctx.tenantId, id: { in: [...new Set(compliance.map((c) => c.userId))] } },
    select: { id: true, fullName: true },
  });
  const nameBy = new Map(names.map((u) => [u.id, u.fullName]));

  return (
    <>
      <ListHeader
        title="Leadership"
        description={
          <>
            {userIds.length === 0 ? 'Whole workspace' : `${userIds.length} people`} ·{' '}
            {from.toLocaleDateString('en-GB', { dateStyle: 'medium' })} to today
            {chasing.length > 0 && (
              <>
                {' · '}
                <SalesLink href="/leadership?view=chasing" style={{ color: 'var(--lf-brass)' }}>
                  {chasing.length} to chase
                </SalesLink>
              </>
            )}
          </>
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="View">
        {TABS.map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/leadership?view=${key}` : '/leadership'}
            aria-selected={view === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {view === '' && (
        <>
          <div
            className="lf-card"
            style={{ display: 'flex', gap: 'var(--lf-space-5)', flexWrap: 'wrap', marginBottom: 'var(--lf-space-4)' }}
          >
            {(
              [
                ['Leads in', String(rates.leads)],
                ['Converted', pct(rates.leadToConverted)],
                ['To opportunity', pct(rates.leadToOpportunity)],
                ['Opportunity to sale', pct(rates.opportunityToBooking)],
                ['Lead to sale', pct(rates.leadToBooking)],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <div className="lf-hint">{label}</div>
                <div style={{ fontSize: 'var(--lf-text-lg)', fontWeight: 600 }}>{value}</div>
              </div>
            ))}
          </div>

          <div className="lf-card" style={{ marginBottom: 'var(--lf-space-4)' }}>
            <strong>Funnel</strong>
            <table className="lf-grid" style={{ marginTop: 'var(--lf-space-2)' }}>
              <thead>
                <tr>
                  <th>Stage</th>
                  <th style={{ textAlign: 'right' }}>Sitting there</th>
                  <th style={{ textAlign: 'right' }}>Arrived this period</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((s) => (
                  <tr key={s.stageId}>
                    <td>
                      {s.name} <Badge value={s.category} tone={s.category === 'CONVERSION' ? 'viridian' : 'slate'} />
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {s.open}
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {/* Open without arrivals is a stalled pipeline, which the
                          snapshot alone would show as a healthy one. */}
                      {s.entered}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            style={{
              display: 'grid',
              gap: 'var(--lf-space-4)',
              gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))',
            }}
          >
            {(
              [
                ['Top by revenue', board.top],
                ['Bottom by revenue', board.bottom],
              ] as const
            ).map(([label, rows]) => (
              <div className="lf-card" key={label}>
                <strong>{label}</strong>
                {rows.length === 0 ? (
                  <p className="lf-hint">Nothing sold this period.</p>
                ) : (
                  <ol style={{ margin: 'var(--lf-space-2) 0 0', paddingLeft: '1.3em' }}>
                    {rows.map((r) => (
                      <li key={`${label}-${r.userId}`}>
                        {r.name ?? r.userId} — {r.value.toLocaleString('en-GB')}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {view === 'compliance' &&
        (compliance.length === 0 ? (
          <div className="lf-card">
            <EmptyState title="No targets set" description="Set targets and attainment against them appears here." />
          </div>
        ) : (
          <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
            <table className="lf-grid">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Metric</th>
                  <th style={{ textAlign: 'right' }}>Target</th>
                  <th style={{ textAlign: 'right' }}>Achieved</th>
                  <th style={{ textAlign: 'right' }}>Attainment</th>
                </tr>
              </thead>
              <tbody>
                {compliance.map((c, i) => (
                  <tr key={`${c.userId}-${c.metric}-${i}`}>
                    <td>{nameBy.get(c.userId) ?? c.userId}</td>
                    <td>{c.metric.replace(/_/g, ' ').toLowerCase()}</td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {c.target}
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {c.achieved}
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      <span style={{ color: (c.attainment ?? 100) < 60 ? 'var(--lf-vermillion)' : undefined }}>
                        {pct(c.attainment)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {view === 'chasing' &&
        (chasing.length === 0 ? (
          <div className="lf-card">
            <EmptyState title="Nobody is waiting" description="Every open lead has a follow-up still in the future." />
          </div>
        ) : (
          <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
            <table className="lf-grid">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Due</th>
                  <th>Last touched</th>
                  <th>SLA</th>
                  <th style={{ textAlign: 'right' }}>Overdue</th>
                </tr>
              </thead>
              <tbody>
                {chasing.map((r) => (
                  <tr key={r.leadId}>
                    <td style={{ fontWeight: 500 }}>
                      <SalesLink href={`/leads/${r.leadId}`}>{r.fullName}</SalesLink>
                    </td>
                    <td>{r.nextFollowUpAt?.toLocaleDateString('en-GB', { dateStyle: 'medium' }) ?? '—'}</td>
                    <td>{r.lastActivityAt?.toLocaleDateString('en-GB', { dateStyle: 'medium' }) ?? 'never'}</td>
                    <td>
                      <Badge value={r.slaState} tone={r.slaState === 'BREACHED' ? 'vermillion' : 'slate'} />
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {r.overdueDays} d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {view === 'feed' &&
        (feed.length === 0 ? (
          <div className="lf-card">
            <EmptyState title="Nothing logged" description="Calls, meetings and notes from the team appear here." />
          </div>
        ) : (
          <div className="lf-card">
            <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
              {feed.map((a) => (
                <li key={a.id}>
                  <strong>{a.type.name}</strong>
                  {a.lead && (
                    <>
                      {' with '}
                      <SalesLink href={`/leads/${a.lead.id}`}>{a.lead.fullName}</SalesLink>
                    </>
                  )}
                  {a.outcome && ` — ${a.outcome}`}
                  <span className="lf-hint">
                    {' '}
                    {a.occurredAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}

      {view === 'pl' && pl && (
        <>
          {pl.caveats.length > 0 && (
            <div className="lf-card" style={{ marginBottom: 'var(--lf-space-4)' }}>
              {/* An unexplained margin is worse than a missing one. */}
              <strong>What this report cannot see</strong>
              <ul style={{ margin: 'var(--lf-space-2) 0 0', paddingLeft: '1.2em' }}>
                {pl.caveats.map((c) => (
                  <li key={c} className="lf-hint">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pl.rows.length === 0 ? (
            <div className="lf-card">
              <EmptyState title="No sales this period" description="Confirmed bookings roll up here by team." />
            </div>
          ) : (
            <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
              <table className="lf-grid">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th style={{ textAlign: 'right' }}>Sales</th>
                    <th style={{ textAlign: 'right' }}>Value</th>
                    <th style={{ textAlign: 'right' }}>Agency fee</th>
                    <th style={{ textAlign: 'right' }}>Commission</th>
                    <th style={{ textAlign: 'right' }}>Payroll</th>
                    <th style={{ textAlign: 'right' }}>Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {pl.rows.map((r) => (
                    <tr key={r.key ?? 'unassigned'}>
                      <td style={{ fontWeight: 500 }}>{r.name}</td>
                      <td style={{ textAlign: 'right' }} className="lf-num">
                        {r.bookings}
                      </td>
                      <td style={{ textAlign: 'right' }} className="lf-num">
                        {money(r.saleValue, pl.currency)}
                      </td>
                      <td style={{ textAlign: 'right' }} className="lf-num">
                        {money(r.agencyFee, pl.currency)}
                      </td>
                      <td style={{ textAlign: 'right' }} className="lf-num">
                        {money(r.commissionCost, pl.currency)}
                      </td>
                      <td style={{ textAlign: 'right' }} className="lf-num">
                        {money(r.payrollCost, pl.currency)}
                      </td>
                      <td style={{ textAlign: 'right' }} className="lf-num">
                        {money(r.margin, pl.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Total</td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {pl.totals.bookings}
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {money(pl.totals.saleValue, pl.currency)}
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {money(pl.totals.agencyFee, pl.currency)}
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {money(pl.totals.commissionCost, pl.currency)}
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {money(pl.totals.payrollCost, pl.currency)}
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {money(pl.totals.margin, pl.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
