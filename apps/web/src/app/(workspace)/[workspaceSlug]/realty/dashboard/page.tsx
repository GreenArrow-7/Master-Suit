import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { boardFilterOptions, rememberedBoardFilter } from '@/lib/leads/boardFilter';
import { realtyDashboard, type RealtyDashboard, type Tile as Linked } from '@/services/realty/dashboard';
import { onDay } from '@/lib/leads/followUpDue';
import ListHeader from '@/components/workspace/ListHeader';
import MetricCard from '@/components/ui/MetricCard';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import BoardFilterBar from '@/components/workspace/BoardFilterBar';

export const metadata = { title: 'Real Estate' };

/**
 * The brokerage board.
 *
 * `module: 'REAL_ESTATE'` is asserted here as well as in the layout: the layout
 * is chrome, this is the page, and a page that trusts its parent to have checked
 * is one refactor away from being reachable. `permission: ['leads','VIEW']`
 * because every figure on the screen is ultimately about leads and what came of
 * them — a viewer who cannot see leads has no dashboard to be shown.
 *
 * Role-awareness needs no code here. `realtyDashboard` scopes through
 * `visibilityWhere`, so an agent sees their own numbers, a team leader their
 * team's and a manager the workspace's, from one query path.
 *
 * Every tile links somewhere it can be acted on. A figure with no destination is
 * a number to worry about rather than work to do, which is the failure mode the
 * brief asked to avoid. The service hands each figure its link, so the list a
 * tile opens shows what the tile counted.
 */
// Two tiles a row at 390 px.
const CARD_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 'var(--lf-space-3)',
  marginBottom: 'var(--lf-space-5)',
} as const;

const money = (amount: number) => `AED ${amount.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;

/** 0:01:30 */
const talkTime = (seconds: number) =>
  [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((part, i) => (i === 0 ? String(part) : String(part).padStart(2, '0')))
    .join(':');

/**
 * A tile for a figure the viewer may not be authorised to know.
 *
 * `null` from the service means "not authorised", and the answer to that is to
 * render nothing — not a zero, and not a greyed-out card saying the number is
 * hidden. Either of those confirms the register exists and invites a guess about
 * its contents. The board simply has fewer tiles for a viewer with narrower
 * permission, which is what degrading by capability looks like.
 */
function Tile({
  label,
  value,
  href,
  tone,
  format,
}: {
  label: string;
  value: number | null;
  href?: string;
  tone?: 'slate' | 'wine' | 'brass' | 'viridian' | 'vermillion';
  format?: (n: number) => string;
}) {
  if (value === null) return null;
  return <MetricCard label={label} value={format ? format(value) : value} href={href} tone={tone} />;
}

/** A figure that carries the link to its own list. */
function LinkedTile({
  label,
  tile,
  tone,
}: {
  label: string;
  tile: Linked | null;
  tone?: 'brass' | 'viridian' | 'wine';
}) {
  return tile && <MetricCard label={label} value={tile.value} href={tile.href} tone={tone} />;
}

/** A leaderboard cell that opens what it counted. */
function Cell({ value, href }: { value: number; href: string }) {
  return (
    <td className="lf-num">
      <SalesLink href={href}>{value}</SalesLink>
    </td>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="lf-panel">
      <div className="lf-panel__head">
        <h2>{title}</h2>
        {note && <span className="lf-hint">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** Horizontal bars, each opening its list: the funnel and the sources. */
function Bars({ rows }: { rows: { key: string; label: string; count: number; href: string | null }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <ul className="lf-bars">
      {rows.map((row) => {
        const body = (
          <>
            <span className="lf-bars__label">{row.label}</span>
            <span className="lf-bars__track" aria-hidden="true">
              <span className="lf-bars__fill" style={{ width: `${(row.count / max) * 100}%` }} />
            </span>
            <span className="lf-num">{row.count}</span>
          </>
        );
        return (
          <li key={row.key}>
            {row.href ? (
              <SalesLink className="lf-bars__row" href={row.href}>
                {body}
              </SalesLink>
            ) : (
              <span className="lf-bars__row">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Two bars a day for 14 days: leads received, and leads first contacted; each bar opens its day's list. */
function ReceivedVsWorked({ trend }: { trend: RealtyDashboard['trend'] }) {
  const max = Math.max(1, ...trend.flatMap((day) => [day.received, day.worked]));
  const total = (key: 'received' | 'worked') => trend.reduce((sum, day) => sum + day[key], 0);
  const bar = (date: string, series: 'received' | 'worked', count: number, href: string) => {
    const words = `${onDay(date)}: ${count} ${series}`;
    return (
      <SalesLink className="lf-pairs__bar" href={href} aria-label={words} title={words}>
        <span data-series={series} style={{ height: `${(count / max) * 100}%` }} />
      </SalesLink>
    );
  };
  return (
    <>
      <p className="lf-legend">
        <span>
          <span className="lf-legend__key" data-series="received" /> Received {total('received')}
        </span>
        <span>
          <span className="lf-legend__key" data-series="worked" /> Worked {total('worked')}
        </span>
      </p>
      <div className="lf-pairs">
        {trend.map((day) => (
          <div key={day.date} className="lf-pairs__day">
            <span className="lf-pairs__bars">
              {bar(day.date, 'received', day.received, day.href)}
              {bar(day.date, 'worked', day.worked, day.workedHref)}
            </span>
            <span className="lf-pairs__date" aria-hidden="true">
              {Number(day.date.slice(8))}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

export default async function RealtyDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The same board for Lead Eagle (`lead-eagle/dashboard` re-exports this page),
  // without bookings and revenue: Lead Eagle is the lead-management product.
  const pathname = (await headers()).get('x-pathname') ?? '';
  const leadEagle = pathname.includes('/lead-eagle/');
  const ctx = await requirePageAccess({
    module: leadEagle ? 'LEAD_EAGLE' : 'REAL_ESTATE',
    permission: ['leads', 'VIEW'],
  });
  // The filters in the URL, or this person's remembered ones put back in it.
  const remembered = await rememberedBoardFilter(ctx, (await searchParams) ?? {});
  if (remembered.redirectTo !== null) redirect(`${pathname}${remembered.redirectTo}`);
  const board = await realtyDashboard(ctx, new Date(), remembered.filter);
  const options = await boardFilterOptions(ctx);
  const { conversion } = board.pipeline;
  const week = { day: '2-digit', month: 'short' } as const;
  const lastWeek = `${onDay(board.period.from, week)} – ${onDay(board.period.to, week)}`;
  const leaders = board.leaderboard;

  return (
    <>
      <ListHeader
        title={leadEagle ? 'Lead Eagle' : 'Real Estate'}
        description={leadEagle ? 'Your leads today, and where they stand.' : 'Your brokerage day, and where it stands.'}
      />

      <BoardFilterBar filter={board.filter} options={options} />

      <section aria-labelledby="realty-today">
        <h2 id="realty-today" className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-2)' }}>
          Today
        </h2>
        <div style={CARD_GRID}>
          <LinkedTile label="New Leads" tile={board.today.newLeads} tone="viridian" />
          <LinkedTile label="Overdue" tile={board.today.overdue} tone="wine" />
          <LinkedTile label="Due Today" tile={board.today.dueToday} />
          <LinkedTile label="Callbacks" tile={board.today.callbacks} tone="brass" />
          <LinkedTile label="Site Visits" tile={board.today.siteVisits} />
        </div>
      </section>

      <section aria-labelledby="realty-pipeline">
        <h2 id="realty-pipeline" className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-2)' }}>
          Pipeline
        </h2>
        <div style={CARD_GRID}>
          <LinkedTile label="Total Leads" tile={board.pipeline.totalLeads} />
          <LinkedTile label="Unassigned" tile={board.pipeline.unassigned} tone="brass" />
          <LinkedTile label="Untouched" tile={board.pipeline.untouched} tone="wine" />
          <LinkedTile label="Meetings Scheduled" tile={board.pipeline.meetingsScheduled} />
          <LinkedTile label="Meetings Done" tile={board.pipeline.meetingsDone} />
          <MetricCard
            label="Conversion"
            value={conversion.percent === null ? '—' : `${conversion.percent}%`}
            href={conversion.href}
            tone="viridian"
          />
          <LinkedTile label="Visits Approved" tile={board.pipeline.visitsApproved} />
          <LinkedTile label="Visits Completed" tile={board.pipeline.visitsCompleted} />
          {!leadEagle && (
            <>
              <Tile label="Bookings" value={board.pipeline.bookings} href="/collections" />
              <Tile
                label="Confirmed Bookings"
                value={board.pipeline.confirmedBookings}
                href="/collections"
                tone="viridian"
              />
            </>
          )}
        </div>
      </section>

      {(!leadEagle || board.business.availableInventory !== null) && (
        <section aria-labelledby="realty-business">
          <h2 id="realty-business" className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-2)' }}>
            Business
          </h2>
          <div style={CARD_GRID}>
            {!leadEagle && (
              <>
                <Tile
                  label="Revenue Today"
                  value={board.business.revenueToday}
                  href="/collections"
                  tone="wine"
                  format={money}
                />
                <Tile
                  label="Revenue 7 Days"
                  value={board.business.revenue7Days}
                  href="/collections"
                  tone="wine"
                  format={money}
                />
              </>
            )}
            <Tile label="Available Inventory" value={board.business.availableInventory} href="/properties" />
          </div>
        </section>
      )}

      <div className="lf-panels">
        <Panel title="Leads by Stage">
          {board.funnel.length === 0 ? (
            <EmptyState title="No stages yet" description="Lead stages are set under Admin." />
          ) : (
            <Bars rows={board.funnel.map((stage) => ({ key: stage.stageId, label: stage.name, ...stage }))} />
          )}
        </Panel>

        <Panel title="Leads by Source">
          {board.business.leadsBySource.length === 0 ? (
            <EmptyState title="No leads yet" description="Sources appear here as leads arrive." />
          ) : (
            <Bars rows={board.business.leadsBySource.map((row) => ({ key: row.label, ...row }))} />
          )}
        </Panel>

        <Panel title="Received vs Worked" note="Last 14 days">
          <ReceivedVsWorked trend={board.trend} />
        </Panel>

        <Panel title="Follow-ups This Week">
          <ul className="lf-strip">
            <li>
              <SalesLink className="lf-strip__day" data-tone="overdue" href={board.today.overdue.href}>
                <span>Overdue</span>
                <strong className="lf-num">{board.today.overdue.value}</strong>
              </SalesLink>
            </li>
            {board.followUpDays.map((day, i) => (
              <li key={day.date}>
                <SalesLink className="lf-strip__day" href={day.href} aria-current={i === 0 ? 'date' : undefined}>
                  <span>{i === 0 ? 'Today' : onDay(day.date, { weekday: 'short', day: 'numeric' })}</span>
                  <strong className="lf-num">{day.count}</strong>
                </SalesLink>
              </li>
            ))}
          </ul>
        </Panel>

        {board.calls && (
          <Panel title="Calls" note={lastWeek}>
            <div className="lf-callfigures">
              <SalesLink href={board.calls.href}>
                <strong className="lf-num">{board.calls.made}</strong> made
              </SalesLink>
              <SalesLink href={board.calls.connectedHref}>
                <strong className="lf-num">{board.calls.connected}</strong> connected
              </SalesLink>
              <SalesLink href={board.calls.href}>
                <strong className="lf-num">{talkTime(board.calls.seconds)}</strong> talk time
              </SalesLink>
            </div>
          </Panel>
        )}

        {leaders && (
          <Panel title="Leaderboard" note={lastWeek}>
            {leaders.length === 0 ? (
              <EmptyState title="Nothing logged yet" description="Agents appear here as they call and visit." />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="lf-leaderboard">
                  <thead>
                    <tr>
                      <th scope="col">Agent</th>
                      {leaders[0]!.calls !== null && <th scope="col">Calls</th>}
                      {leaders[0]!.meetings !== null && <th scope="col">Meetings</th>}
                      {leaders[0]!.visits !== null && <th scope="col">Visits</th>}
                      <th scope="col">Booked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaders.map((row) => (
                      <tr key={row.userId}>
                        <th scope="row">
                          <SalesLink href={row.href}>{row.name}</SalesLink>
                        </th>
                        {row.calls !== null && <Cell value={row.calls} href={row.links.calls} />}
                        {row.meetings !== null && <Cell value={row.meetings} href={row.links.meetings} />}
                        {row.visits !== null && <Cell value={row.visits} href={row.links.visits} />}
                        <Cell value={row.booked} href={row.links.booked} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}

        {board.business.topAgents !== null && !leadEagle && (
          <Panel title="Top Agents">
            {board.business.topAgents.length === 0 ? (
              <EmptyState
                title="No confirmed deals yet"
                description="Agents appear here once a booking is confirmed."
              />
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--lf-space-2)' }}>
                {board.business.topAgents.map((agent) => (
                  <li key={agent.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{agent.name}</span>
                    <span className="lf-num" style={{ fontWeight: 600 }}>
                      {agent.bookings}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
