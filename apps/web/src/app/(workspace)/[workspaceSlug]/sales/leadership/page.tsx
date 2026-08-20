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

/** Every card on this page needs it: `.lf-card` itself carries no padding. */
const CARD = { padding: 'var(--lf-space-5)' } as const;

const pct = (n: number | null) => (n === null ? '—' : `${n}%`);

/**
 * Range boundaries are computed in UTC, so they must be *displayed* in UTC.
 *
 * Rendered in the server's local zone instead, last month's inclusive end of
 * 31 Jul 23:59:59.999Z reads as "1 Aug" anywhere east of Greenwich — a report
 * header claiming a period a day longer than the one the figures cover.
 */
const rangeDate = (d: Date) => d.toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

const money = (amount: { toString(): string } | null, currency: string) =>
  amount === null
    ? '—'
    : `${currency} ${Number(amount.toString()).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PERIODS = [
  ['mtd', 'This month'],
  ['last-month', 'Last month'],
  ['30d', 'Last 30 days'],
  ['90d', 'Last 90 days'],
  ['ytd', 'Year to date'],
] as const;
type PeriodKey = (typeof PERIODS)[number][0];

/**
 * The reporting window.
 *
 * Was hardcoded to month-to-date with no way to change it, which made every
 * number on the page an assertion about a period the reader could not choose —
 * "no bookings" in the first days of a month says nothing, and there was no way
 * to look at the month that just closed. Explicit `from`/`to` win when supplied
 * so a link to a specific window stays valid.
 */
function resolveRange(period: PeriodKey, fromParam?: string, toParam?: string) {
  const to = toParam ? new Date(`${toParam}T23:59:59.999Z`) : new Date();
  if (fromParam) return { from: new Date(`${fromParam}T00:00:00.000Z`), to, label: 'Custom' };

  const from = new Date(to);
  from.setUTCHours(0, 0, 0, 0);
  switch (period) {
    case 'last-month': {
      const start = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 1, 1));
      // End of the previous month, not "a month ago": a month-on-month
      // comparison that slides with today's date compares different lengths.
      const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 0, 23, 59, 59, 999));
      return { from: start, to: end, label: 'Last month' };
    }
    case '30d':
      from.setUTCDate(from.getUTCDate() - 29);
      return { from, to, label: 'Last 30 days' };
    case '90d':
      from.setUTCDate(from.getUTCDate() - 89);
      return { from, to, label: 'Last 90 days' };
    case 'ytd':
      return { from: new Date(Date.UTC(to.getUTCFullYear(), 0, 1)), to, label: 'Year to date' };
    default:
      from.setUTCDate(1);
      return { from, to, label: 'This month' };
  }
}

/**
 * The leader's page.
 *
 * The scope is decided once, by `subtree`, and handed to every panel, so two
 * panels cannot end up describing different teams. Likewise the date range:
 * chosen here and passed down, rather than each panel picking its own idea of
 * "recent".
 */
export default async function LeadershipPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; period?: string; from?: string; to?: string; rep?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['reports', 'VIEW'] });
  const view = TABS.some(([, k]) => k === params.view) ? (params.view ?? '') : '';

  const period = (PERIODS.some(([k]) => k === params.period) ? params.period : 'mtd') as PeriodKey;
  const custom = Boolean(params.from);
  const range = resolveRange(period, params.from, params.to);

  const allowed = await subtree(ctx);

  /**
   * A single rep, when asked for and permitted.
   *
   * An empty subtree means "the whole workspace", so it cannot be used to
   * validate the request — the membership check is a real lookup instead.
   * Anything else silently falls back to the full scope rather than erroring:
   * a stale bookmark should show the team, not a 403.
   */
  let userIds = allowed;
  let repName: string | null = null;
  if (params.rep) {
    const permitted = allowed.length === 0 || allowed.includes(params.rep);
    const rep = permitted
      ? await prisma.user.findFirst({
          where: { id: params.rep, tenantId: ctx.tenantId, deletedAt: null },
          select: { id: true, fullName: true },
        })
      : null;
    if (rep) {
      userIds = [rep.id];
      repName = rep.fullName;
    }
  }

  const [stages, rates, board, chasing, compliance, feed, pl, reps] = await Promise.all([
    funnel(ctx.tenantId, userIds, range),
    conversion(ctx.tenantId, userIds, range),
    performerBoard(ctx.tenantId, userIds, range, 'revenue'),
    chasingQueue(ctx.tenantId, userIds, new Date(), 50),
    view === 'compliance' ? activityCompliance(ctx.tenantId, userIds, range) : [],
    view === 'feed' ? interactionFeed(ctx.tenantId, userIds, range, 50) : [],
    view === 'pl' ? profitAndLoss(ctx.tenantId, userIds, range.from, range.to, 'team') : null,
    prisma.user.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: 'ACTIVE',
        ...(allowed.length === 0 ? {} : { id: { in: allowed } }),
      },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
      take: 200,
    }),
  ]);

  // Only when there is something to name — an `in: []` lookup is a wasted round
  // trip on the four tabs that never render compliance.
  const complianceUserIds = [...new Set(compliance.map((c) => c.userId))];
  const names = complianceUserIds.length
    ? await prisma.user.findMany({
        where: { tenantId: ctx.tenantId, id: { in: complianceUserIds } },
        select: { id: true, fullName: true },
      })
    : [];
  const nameBy = new Map(names.map((u) => [u.id, u.fullName]));

  /** Filters travel with the tab, so switching view never silently resets them. */
  const filterQuery = (() => {
    const q = new URLSearchParams();
    if (params.rep && repName) q.set('rep', params.rep);
    if (custom) {
      if (params.from) q.set('from', params.from);
      if (params.to) q.set('to', params.to);
    } else if (period !== 'mtd') {
      q.set('period', period);
    }
    return q;
  })();
  const tabHref = (key: string) => {
    const q = new URLSearchParams(filterQuery);
    if (key) q.set('view', key);
    const s = q.toString();
    return s ? `/leadership?${s}` : '/leadership';
  };

  const scopeLabel = repName ?? (userIds.length === 0 ? 'Whole workspace' : `${userIds.length} people`);
  const filtered = Boolean(params.rep || params.period || params.from || params.to);

  return (
    <>
      <ListHeader
        title="Leadership"
        description={
          <>
            {scopeLabel} · {rangeDate(range.from)} to{' '}
            {custom || period === 'last-month' ? rangeDate(range.to) : 'today'}
            {chasing.length > 0 && (
              <>
                {' · '}
                <SalesLink href={tabHref('chasing')} style={{ color: 'var(--lf-brass)' }}>
                  {chasing.length} to chase
                </SalesLink>
              </>
            )}
          </>
        }
      />

      {/*
        Period as links, not a select inside the form below.

        As a select it shared a submit with the From/To inputs, and `from` wins —
        so picking "Last month" while a custom date sat in the box silently did
        nothing. A link carries only the period, which clears the custom range by
        construction, and the two controls can no longer contradict each other.
      */}
      <nav
        aria-label="Period"
        style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap', marginTop: 'var(--lf-space-4)' }}
      >
        {PERIODS.map(([key, label]) => {
          const q = new URLSearchParams();
          if (view) q.set('view', view);
          if (params.rep && repName) q.set('rep', params.rep);
          if (key !== 'mtd') q.set('period', key);
          const active = !custom && period === key;
          return (
            <SalesLink
              key={key}
              href={q.toString() ? `/leadership?${q}` : '/leadership'}
              className={`lf-btn lf-btn--sm ${active ? 'lf-btn--secondary' : 'lf-btn--ghost'}`}
              aria-current={active ? 'true' : undefined}
            >
              {label}
            </SalesLink>
          );
        })}
        {custom && (
          <span className="lf-btn lf-btn--sm lf-btn--secondary" aria-current="true">
            Custom
          </span>
        )}
      </nav>

      {/* Custom range and scope. A GET form, so the URL is the state and is shareable. */}
      <form
        method="get"
        style={{
          display: 'flex',
          gap: 'var(--lf-space-3)',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          margin: 'var(--lf-space-4) 0',
        }}
      >
        {view && <input type="hidden" name="view" value={view} />}
        {/*
          The chosen period rides along with the submit.

          Without it, changing the Person reset the window to this month — the
          chips write `?period=`, this form rewrites the whole query string, and
          a filter that silently changes a *different* filter is worse than one
          that does nothing. Omitted for a custom range, where From/To are the
          period and `resolveRange` gives them precedence anyway.
        */}
        {!custom && period !== 'mtd' && <input type="hidden" name="period" value={period} />}
        <label className="lf-field">
          <span className="lf-eyebrow">From</span>
          <input
            type="date"
            name="from"
            defaultValue={params.from ?? ''}
            className="lf-input"
            aria-describedby="lf-range-hint"
          />
        </label>
        <label className="lf-field">
          <span className="lf-eyebrow">To</span>
          <input type="date" name="to" defaultValue={params.to ?? ''} className="lf-input" />
        </label>
        <label className="lf-field">
          <span className="lf-eyebrow">Person</span>
          <select name="rep" defaultValue={params.rep ?? ''} className="lf-input">
            <option value="">{allowed.length === 0 ? 'Whole workspace' : 'Everyone in my scope'}</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.fullName}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="lf-btn lf-btn--secondary">
          Apply
        </button>
        {filtered && (
          <SalesLink href={view ? `/leadership?view=${view}` : '/leadership'} className="lf-btn lf-btn--ghost">
            Reset
          </SalesLink>
        )}
        <span id="lf-range-hint" className="lf-hint" style={{ flexBasis: '100%', margin: 0 }}>
          Setting a From date switches to a custom range. Dates are inclusive.
        </span>
      </form>

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="View">
        {TABS.map(([label, key]) => (
          <SalesLink key={label} className="lf-tab" href={tabHref(key)} aria-selected={view === key} role="tab">
            {label}
          </SalesLink>
        ))}
      </nav>

      {view === '' && (
        <>
          <div className="lf-card" style={{ ...CARD, marginBottom: 'var(--lf-space-4)' }}>
            <div className="lf-stat-strip lf-stat-strip--light">
              {(
                [
                  ['Leads in', String(rates.leads), 'Created in this period'],
                  ['Converted', pct(rates.leadToConverted), `${rates.converted} of ${rates.leads} reached a won stage`],
                  ['To opportunity', pct(rates.leadToOpportunity), `${rates.opportunities} opportunities created`],
                  [
                    'Opportunity to sale',
                    pct(rates.opportunityToBooking),
                    `${rates.bookings} of ${rates.opportunities} opportunities booked`,
                  ],
                  ['Lead to sale', pct(rates.leadToBooking), `${rates.bookings} of ${rates.leads} leads booked`],
                ] as const
              ).map(([label, value, hint]) => (
                <div key={label} title={hint}>
                  <span className="lf-figure lf-num" style={{ fontSize: '1.5rem' }}>
                    {value}
                  </span>
                  <span className="lf-eyebrow">{label}</span>
                </div>
              ))}
            </div>
            <p className="lf-hint" style={{ margin: 'var(--lf-space-3) 0 0' }}>
              Rates are of leads created in this period, so a lead that arrived earlier and converted now is not counted
              here.
            </p>
          </div>

          <div className="lf-card" style={{ ...CARD, marginBottom: 'var(--lf-space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <strong>Funnel</strong>
              <span className="lf-hint">
                &ldquo;Open now&rdquo; is a live snapshot; &ldquo;Entered&rdquo; counts moves within the period.
              </span>
            </div>
            {stages.length === 0 ? (
              <p className="lf-hint" style={{ marginBottom: 0 }}>
                No lead stages configured.
              </p>
            ) : (
              <div className="lf-grid-wrap" style={{ overflowX: 'auto', marginTop: 'var(--lf-space-3)' }}>
                <table className="lf-grid">
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th style={{ textAlign: 'right' }}>Open now</th>
                      <th style={{ textAlign: 'right' }}>Entered this period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stages.map((s) => (
                      <tr key={s.stageId}>
                        <td data-label="Stage">
                          {s.name}{' '}
                          <Badge value={s.category} tone={s.category === 'CONVERSION' ? 'viridian' : 'slate'} />
                        </td>
                        <td data-label="Open now" style={{ textAlign: 'right' }} className="lf-num">
                          {s.open}
                        </td>
                        <td data-label="Entered this period" style={{ textAlign: 'right' }} className="lf-num">
                          {/* Open without arrivals is a stalled pipeline, which the
                              snapshot alone would show as a healthy one. */}
                          {s.entered === 0 && s.open > 0 ? (
                            <span style={{ color: 'var(--lf-brass)' }} title="Nothing moved into this stage — stalled">
                              0
                            </span>
                          ) : (
                            s.entered
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gap: 'var(--lf-space-4)',
              gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))',
              alignItems: 'start',
            }}
          >
            {(
              [
                ['Top by revenue', board.top],
                // Hidden entirely when everyone already appears above: naming the
                // same person best and worst on one screen is worse than silence.
                ['Bottom by revenue', board.bottom],
              ] as const
            )
              .filter(([, rows]) => rows.length > 0)
              .map(([label, rows]) => (
                <div className="lf-card" style={CARD} key={label}>
                  <strong>{label}</strong>
                  <ol
                    style={{
                      margin: 'var(--lf-space-3) 0 0',
                      paddingLeft: '1.3em',
                      display: 'grid',
                      gap: 4,
                    }}
                  >
                    {rows.map((r) => (
                      <li key={`${label}-${r.userId}`}>
                        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                          <span>{r.name ?? r.userId}</span>
                          <span className="lf-num" style={{ color: 'var(--lf-ink-2)' }}>
                            {r.value.toLocaleString('en-GB')}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            {board.top.length === 0 && (
              <div className="lf-card" style={CARD}>
                <strong>Top by revenue</strong>
                <p className="lf-hint" style={{ marginBottom: 0 }}>
                  Nothing sold in this period.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {view === 'compliance' &&
        (compliance.length === 0 ? (
          <div className="lf-card" style={CARD}>
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
                    <td data-label="Who">{nameBy.get(c.userId) ?? c.userId}</td>
                    <td data-label="Metric" style={{ textTransform: 'capitalize' }}>
                      {c.metric.replace(/_/g, ' ').toLowerCase()}
                    </td>
                    <td data-label="Target" style={{ textAlign: 'right' }} className="lf-num">
                      {c.target}
                    </td>
                    <td data-label="Achieved" style={{ textAlign: 'right' }} className="lf-num">
                      {c.achieved}
                    </td>
                    <td data-label="Attainment" style={{ textAlign: 'right' }} className="lf-num">
                      <span
                        style={{
                          color:
                            c.attainment === null
                              ? undefined
                              : c.attainment < 60
                                ? 'var(--lf-vermillion)'
                                : c.attainment < 100
                                  ? 'var(--lf-brass)'
                                  : 'var(--lf-viridian)',
                          fontWeight: 600,
                        }}
                      >
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
          <div className="lf-card" style={CARD}>
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
                    <td data-label="Lead" style={{ fontWeight: 500 }}>
                      <SalesLink href={`/leads/${r.leadId}`}>{r.fullName}</SalesLink>
                    </td>
                    <td data-label="Due">
                      {r.nextFollowUpAt?.toLocaleDateString('en-GB', { dateStyle: 'medium' }) ?? '—'}
                    </td>
                    <td data-label="Last touched">
                      {r.lastActivityAt?.toLocaleDateString('en-GB', { dateStyle: 'medium' }) ?? 'never'}
                    </td>
                    <td data-label="SLA">
                      <Badge value={r.slaState} tone={r.slaState === 'BREACHED' ? 'vermillion' : 'slate'} />
                    </td>
                    <td data-label="Overdue" style={{ textAlign: 'right' }} className="lf-num">
                      <span style={{ color: r.overdueDays > 7 ? 'var(--lf-vermillion)' : undefined }}>
                        {r.overdueDays} d
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {view === 'feed' &&
        (feed.length === 0 ? (
          <div className="lf-card" style={CARD}>
            <EmptyState title="Nothing logged" description="Calls, meetings and notes from the team appear here." />
          </div>
        ) : (
          <div className="lf-card" style={CARD}>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--lf-space-3)' }}>
              {feed.map((a) => (
                <li
                  key={a.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 'var(--lf-space-3)',
                    flexWrap: 'wrap',
                    borderBottom: '1px solid var(--lf-line)',
                    paddingBottom: 'var(--lf-space-3)',
                  }}
                >
                  <span>
                    <strong>{a.type.name}</strong>
                    {a.lead && (
                      <>
                        {' with '}
                        <SalesLink href={`/leads/${a.lead.id}`}>{a.lead.fullName}</SalesLink>
                      </>
                    )}
                    {a.outcome && <span style={{ color: 'var(--lf-ink-2)' }}> — {a.outcome}</span>}
                  </span>
                  <span className="lf-hint" style={{ whiteSpace: 'nowrap' }}>
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
            <div className="lf-card" style={{ ...CARD, marginBottom: 'var(--lf-space-4)' }}>
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
            <div className="lf-card" style={CARD}>
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
                      <td data-label="Team" style={{ fontWeight: 500 }}>
                        {r.name}
                      </td>
                      <td data-label="Sales" style={{ textAlign: 'right' }} className="lf-num">
                        {r.bookings}
                      </td>
                      <td data-label="Value" style={{ textAlign: 'right' }} className="lf-num">
                        {money(r.saleValue, pl.currency)}
                      </td>
                      <td data-label="Agency fee" style={{ textAlign: 'right' }} className="lf-num">
                        {money(r.agencyFee, pl.currency)}
                      </td>
                      <td data-label="Commission" style={{ textAlign: 'right' }} className="lf-num">
                        {money(r.commissionCost, pl.currency)}
                      </td>
                      <td data-label="Payroll" style={{ textAlign: 'right' }} className="lf-num">
                        {money(r.payrollCost, pl.currency)}
                      </td>
                      <td data-label="Margin" style={{ textAlign: 'right' }} className="lf-num">
                        {money(r.margin, pl.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td data-label="" style={{ fontWeight: 600 }}>
                      Total
                    </td>
                    <td data-label="Sales" style={{ textAlign: 'right' }} className="lf-num">
                      {pl.totals.bookings}
                    </td>
                    <td data-label="Value" style={{ textAlign: 'right' }} className="lf-num">
                      {money(pl.totals.saleValue, pl.currency)}
                    </td>
                    <td data-label="Agency fee" style={{ textAlign: 'right' }} className="lf-num">
                      {money(pl.totals.agencyFee, pl.currency)}
                    </td>
                    <td data-label="Commission" style={{ textAlign: 'right' }} className="lf-num">
                      {money(pl.totals.commissionCost, pl.currency)}
                    </td>
                    <td data-label="Payroll" style={{ textAlign: 'right' }} className="lf-num">
                      {money(pl.totals.payrollCost, pl.currency)}
                    </td>
                    <td data-label="Margin" style={{ textAlign: 'right' }} className="lf-num">
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
