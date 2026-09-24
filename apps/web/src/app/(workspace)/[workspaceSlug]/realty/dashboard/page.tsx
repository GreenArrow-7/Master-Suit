import { requirePageAccess } from '@/lib/workspace-page';
import { realtyDashboard } from '@/services/realty/dashboard';
import ListHeader from '@/components/workspace/ListHeader';
import MetricCard from '@/components/ui/MetricCard';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';

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
 * brief asked to avoid.
 */
const CARD_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 'var(--lf-space-3)',
  marginBottom: 'var(--lf-space-5)',
} as const;

const money = (amount: number) => `AED ${amount.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;

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

export default async function RealtyDashboardPage() {
  const ctx = await requirePageAccess({ module: 'REAL_ESTATE', permission: ['leads', 'VIEW'] });
  const board = await realtyDashboard(ctx);

  return (
    <>
      <ListHeader title="Real Estate" description="Your brokerage day, and where it stands." />

      <section aria-labelledby="realty-today">
        <h2 id="realty-today" className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-2)' }}>
          Today
        </h2>
        <div style={CARD_GRID}>
          <MetricCard label="New Leads" value={board.today.newLeads} href="/leads" tone="viridian" />
          <MetricCard label="Callbacks" value={board.today.callbacks} href="/follow-ups" tone="brass" />
          <MetricCard label="Follow-ups Due" value={board.today.followUps} href="/follow-ups" />
          <Tile label="Site Visits" value={board.today.siteVisits} href="/site-visits" />
        </div>
      </section>

      <section aria-labelledby="realty-pipeline">
        <h2 id="realty-pipeline" className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-2)' }}>
          Pipeline
        </h2>
        <div style={CARD_GRID}>
          <MetricCard label="Total Leads" value={board.pipeline.totalLeads} href="/leads" />
          <Tile label="Visits Approved" value={board.pipeline.visitsApproved} href="/site-visits" />
          <Tile label="Visits Completed" value={board.pipeline.visitsCompleted} href="/site-visits" />
          <Tile label="Bookings" value={board.pipeline.bookings} href="/deals" />
          <Tile label="Confirmed Bookings" value={board.pipeline.confirmedBookings} href="/deals" tone="viridian" />
        </div>
      </section>

      <section aria-labelledby="realty-business">
        <h2 id="realty-business" className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-2)' }}>
          Business
        </h2>
        <div style={CARD_GRID}>
          <Tile label="Revenue Today" value={board.business.revenueToday} href="/deals" tone="wine" format={money} />
          <Tile label="Revenue 7 Days" value={board.business.revenue7Days} href="/deals" tone="wine" format={money} />
          <Tile label="Available Inventory" value={board.business.availableInventory} href="/properties" />
        </div>
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--lf-space-4)',
        }}
      >
        {board.business.topAgents !== null && (
          <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
            <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
              Top Agents
            </div>
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
          </section>
        )}

        <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
            Leads by Source
          </div>
          {board.business.leadsBySource.length === 0 ? (
            <EmptyState title="No leads yet" description="Sources appear here as leads arrive." />
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--lf-space-2)' }}>
              {board.business.leadsBySource.map((row) => (
                <li key={row.source} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <SalesLink href={`/leads?source=${encodeURIComponent(row.source)}`}>
                    {row.source.toLowerCase().replace(/_/g, ' ')}
                  </SalesLink>
                  <span className="lf-num" style={{ fontWeight: 600 }}>
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
