import SalesLink from '@/components/workspace/SalesLink';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import type { DailyBoard, DailyBoardRow } from '@/services/targets/dailyBoard';
import AssignDailyTarget from './AssignDailyTarget';

const fmtTime = (d: Date | null, timeZone: string) =>
  d ? new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(d) : '—';
const fmtDuration = (secs: number | null) => {
  if (secs === null) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
};

/** How far behind a row is, for the highlight: no target → no judgement. */
export function rowTone(r: DailyBoardRow): 'viridian' | 'brass' | 'vermillion' | 'slate' {
  if (r.completion === null) return 'slate';
  if (r.completion >= 100) return 'viridian';
  if (r.completion >= 50) return 'brass';
  return 'vermillion';
}

export const BOARD_COLUMNS: [label: string, key: keyof DailyBoardRow][] = [
  ['Target', 'target'],
  ['Assigned', 'leadsAssigned'],
  ['Called', 'leadsCalled'],
  ['Connected', 'connected'],
  ['No answer', 'notAnswered'],
  ['Cold', 'cold'],
  ['Warm', 'warm'],
  ['Interested', 'interested'],
  ['Follow-ups', 'followUpsCreated'],
  ['Meetings', 'meetingsScheduled'],
  ['Opportunities', 'opportunitiesCreated'],
  ['Deals', 'dealsWon'],
  ['Pending', 'pending'],
];

/**
 * The manager's daily board: one row per seller, every figure counted from the
 * day's work. Rows behind their target are highlighted; the name opens the
 * seller's calls for the day. Refreshes itself every 30 seconds.
 */
export default function DailyBoardView({
  board,
  canAssign,
  detailHref,
}: {
  board: DailyBoard;
  /** leads:ASSIGN at team scope or above. */
  canAssign: boolean;
  detailHref: (userId: string) => string;
}) {
  const totals = board.rows.reduce(
    (t, r) => ({
      target: t.target + (r.target ?? 0),
      called: t.called + r.leadsCalled,
      connected: t.connected + r.connected,
      interested: t.interested + r.interested,
      deals: t.deals + r.dealsWon,
      behind: t.behind + (r.completion !== null && r.completion < 100 ? 1 : 0),
    }),
    { target: 0, called: 0, connected: 0, interested: 0, deals: 0, behind: 0 },
  );
  return (
    <section className="lf-daily-board" data-date={board.date}>
      <form method="get" className="lf-daily-board__bar">
        <input type="hidden" name="view" value="daily" />
        <label className="lf-field lf-daily-board__date">
          <span className="lf-label">Day</span>
          <input type="date" name="date" className="lf-input" defaultValue={board.date} />
        </label>
        <button type="submit" className="lf-btn lf-btn--secondary lf-btn--sm">
          Show
        </button>
        <span className="lf-muted lf-daily-board__zone">{board.timeZone}</span>
      </form>

      <div className="lf-kpi-grid lf-daily-board__totals">
        <div className="lf-kpi">
          <span className="lf-kpi__label">Target today</span>
          <strong className="lf-kpi__value lf-num">{totals.target}</strong>
        </div>
        <div className="lf-kpi">
          <span className="lf-kpi__label">Leads called</span>
          <strong className="lf-kpi__value lf-num">{totals.called}</strong>
        </div>
        <div className="lf-kpi">
          <span className="lf-kpi__label">Connected</span>
          <strong className="lf-kpi__value lf-num">{totals.connected}</strong>
        </div>
        <div className="lf-kpi">
          <span className="lf-kpi__label">Interested</span>
          <strong className="lf-kpi__value lf-num">{totals.interested}</strong>
        </div>
        <div className="lf-kpi">
          <span className="lf-kpi__label">Deals</span>
          <strong className="lf-kpi__value lf-num">{totals.deals}</strong>
        </div>
        <div className="lf-kpi" data-tone={totals.behind ? 'vermillion' : 'viridian'}>
          <span className="lf-kpi__label">Behind target</span>
          <strong className="lf-kpi__value lf-num">{totals.behind}</strong>
        </div>
      </div>

      {board.rows.length === 0 ? (
        <div className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <EmptyState title="Nobody in scope" description="Sellers you manage appear here once they have an account." />
        </div>
      ) : (
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid lf-daily-board__table">
            <thead>
              <tr>
                <th data-priority="primary">Who</th>
                <th data-priority="secondary" style={{ textAlign: 'right' }}>
                  Done
                </th>
                {BOARD_COLUMNS.map(([label]) => (
                  <th key={label} style={{ textAlign: 'right' }}>
                    {label}
                  </th>
                ))}
                <th style={{ textAlign: 'right' }}>Talk time</th>
                <th style={{ textAlign: 'right' }}>Avg call</th>
                <th>Check-in</th>
                <th>Check-out</th>
                {canAssign && <th>Set target</th>}
              </tr>
            </thead>
            <tbody>
              {board.rows.map((r) => (
                <tr
                  key={r.userId}
                  data-tone={rowTone(r)}
                  data-behind={r.completion !== null && r.completion < 100 ? '' : undefined}
                >
                  <td data-label="Who" data-priority="primary">
                    <SalesLink href={detailHref(r.userId)}>{r.name ?? r.userId}</SalesLink>
                  </td>
                  <td data-label="Done" data-priority="secondary" style={{ textAlign: 'right' }}>
                    {r.completion === null ? (
                      <Badge tone="slate">no target</Badge>
                    ) : (
                      <Badge tone={rowTone(r)}>{r.completion}%</Badge>
                    )}
                  </td>
                  {BOARD_COLUMNS.map(([label, key]) => (
                    <td
                      key={label}
                      data-label={label}
                      data-priority={
                        key === 'leadsCalled' || key === 'pending' || key === 'target' ? 'secondary' : 'detail'
                      }
                      style={{ textAlign: 'right' }}
                      className="lf-num"
                    >
                      {r[key] === null ? '—' : String(r[key])}
                    </td>
                  ))}
                  <td data-label="Talk time" data-priority="detail" style={{ textAlign: 'right' }} className="lf-num">
                    {fmtDuration(r.totalDurationSecs)}
                  </td>
                  <td data-label="Avg call" data-priority="detail" style={{ textAlign: 'right' }} className="lf-num">
                    {fmtDuration(r.averageDurationSecs)}
                  </td>
                  <td data-label="Check-in" data-priority="detail">
                    {fmtTime(r.checkInAt, board.timeZone)}
                  </td>
                  <td data-label="Check-out" data-priority="detail">
                    {r.checkedOut ? (
                      <Badge tone="viridian">out</Badge>
                    ) : r.checkInAt ? (
                      <Badge tone="brass">working</Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                  {canAssign && (
                    <td data-label="Set target" data-priority="secondary">
                      <AssignDailyTarget userId={r.userId} date={board.date} current={r.target} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
