import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { dailyCalls } from '@/services/targets/dailyBoard';
import SalesLink from '@/components/workspace/SalesLink';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import PageIntro from '@/components/workspace/PageIntro';
import LiveRefresh from '../../LiveRefresh';
import { BOARD_COLUMNS, rowTone, targetStatus } from '../../DailyBoardView';

export const metadata = { title: 'Daily target' };

const KIND_LABEL = {
  notAnswered: ['No answer', 'slate'],
  cold: ['Cold', 'vermillion'],
  warm: ['Warm', 'brass'],
  interested: ['Interested', 'viridian'],
  unknown: ['—', 'slate'],
} as const;

const fmt = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(d);
const dur = (secs: number | null) =>
  secs === null ? '—' : `${Math.floor(secs / 60)}m ${(secs % 60).toString().padStart(2, '0')}s`;

/**
 * One seller's day behind the board's numbers: which leads were called and
 * what happened on each call. Same scope rules as the board: a seller the
 * viewer cannot see is a 404.
 */
export default async function DailyTargetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; userId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { userId } = await params;
  const { date } = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['leads', 'VIEW'] });
  const { board, calls } = await dailyCalls(ctx, userId, /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : undefined);
  const row = board.rows[0];
  if (!row) notFound();

  return (
    <div className="lf-page-stack">
      <LiveRefresh />
      <PageIntro
        eyebrow="Daily target"
        title={row.name ?? 'Seller'}
        summary={`${board.date} · ${row.leadsCalled} of ${row.target ?? '—'} leads called${
          row.completion !== null ? ` · ${row.completion}% · ${targetStatus(row).label}` : ''
        }`}
        actions={
          <SalesLink href={`/leadership?view=daily&date=${board.date}`} className="lf-btn lf-btn--secondary lf-btn--sm">
            Back to the board
          </SalesLink>
        }
      />
      <div className="lf-kpi-grid">
        {BOARD_COLUMNS.map(([label, key]) => (
          <div key={label} className="lf-kpi" data-tone={key === 'pending' ? rowTone(row) : undefined}>
            <span className="lf-kpi__label">{label}</span>
            <strong className="lf-kpi__value lf-num">{row[key] === null ? '—' : String(row[key])}</strong>
          </div>
        ))}
        <div className="lf-kpi">
          <span className="lf-kpi__label">Talk time</span>
          <strong className="lf-kpi__value lf-num">{dur(row.totalDurationSecs)}</strong>
        </div>
        <div className="lf-kpi">
          <span className="lf-kpi__label">Check-in</span>
          <strong className="lf-kpi__value">{row.checkInAt ? fmt(row.checkInAt, board.timeZone) : '—'}</strong>
        </div>
      </div>

      {calls.length === 0 ? (
        <div className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <EmptyState title="No calls yet today" description="Calls appear here as they are completed." />
        </div>
      ) : (
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th data-priority="primary">Lead</th>
                <th data-priority="secondary">Outcome</th>
                <th>Time</th>
                <th style={{ textAlign: 'right' }}>Duration</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => {
                const [label, tone] = KIND_LABEL[c.kind];
                return (
                  <tr key={c.id}>
                    <td data-label="Lead" data-priority="primary">
                      {c.leadId ? (
                        <SalesLink href={`/leads/${c.leadId}`}>{c.leadName ?? c.recipientNumber ?? c.leadId}</SalesLink>
                      ) : (
                        (c.recipientNumber ?? '—')
                      )}
                    </td>
                    <td data-label="Outcome" data-priority="secondary">
                      <Badge tone={tone}>{label}</Badge>{' '}
                      <span className="lf-muted">{(c.outcome ?? c.status).toLowerCase().replace(/_/g, ' ')}</span>
                    </td>
                    <td data-label="Time" data-priority="detail">
                      {fmt(c.at, board.timeZone)}
                    </td>
                    <td data-label="Duration" data-priority="detail" style={{ textAlign: 'right' }} className="lf-num">
                      {dur(c.durationSecs)}
                    </td>
                    <td data-label="Notes" data-priority="detail">
                      {c.notes ? (
                        <SalesLink href={`/calls/${c.id}`}>{c.notes.slice(0, 80)}</SalesLink>
                      ) : (
                        <SalesLink href={`/calls/${c.id}`}>Open call</SalesLink>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
