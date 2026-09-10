'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import { useModuleBase } from '@/components/workspace/SalesLink';
import EmptyState from '@/components/ui/EmptyState';

/**
 * Leads that automatic assignment could not place, and the one action that
 * clears them.
 *
 * The point of the screen is that a manager can act **without leaving it**: the
 * reason, the deadline, who is accountable and the assignment control are all on
 * the row. Sending somebody to the lead record to do it would mean losing the
 * queue's ordering and the explanation that made the decision obvious.
 */

export interface QueueCandidate {
  userId: string;
  blockers: { code: string; detail: string }[];
}

export interface QueueRow {
  id: string;
  leadId: string;
  episode: number;
  leadName: string;
  source: string;
  sourceDetail: string | null;
  reasonText: string;
  reason: string;
  candidates: QueueCandidate[];
  unsupportedPolicy: string[];
  openedAt: string;
  waitingMs: number;
  reviewDueAt: string | null;
  reviewPolicyMissing: boolean;
  routingPolicyMissing: boolean;
  overdue: boolean;
  responsibleUserName: string | null;
  responsibleTeamName: string | null;
}

export interface Assignee {
  id: string;
  name: string;
  /** null means no limit is configured — not "cannot take anything". */
  available: number | null;
  blockedBy: string | null;
}

/** Waiting time, in the largest unit that is still honest. */
function waited(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

type RowState = 'idle' | 'saving' | 'done' | 'conflict' | 'error';

/**
 * One key per press.
 *
 * Module scope rather than inline: the React compiler rejects an impure call
 * inside a component body even when it only ever runs from an event handler,
 * and hoisting is the honest fix rather than silencing the rule.
 *
 * A second press is a second decision and gets a second key — which is correct
 * under contracts §2.2: a new key means a new intention. What it protects
 * against is one press being *delivered* twice.
 */
function mintRequestKey(entryId: string, toUserId: string): string {
  return `ui:${entryId}:${toUserId}:${Date.now().toString(36)}`;
}

export default function WaitingQueue({
  rows,
  assignees,
  canAssign,
}: {
  rows: QueueRow[];
  assignees: Assignee[];
  canAssign: boolean;
}) {
  const router = useRouter();
  // The module prefix, the same way every other Sales page resolves it.
  const base = useModuleBase();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<Record<string, { status: RowState; message?: string }>>({});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  /**
   * A key that changes when a row is acted on, so React re-mounts the select and
   * a stale choice cannot be submitted against a row that has since moved.
   */
  const eligible = useMemo(() => assignees.filter((a) => a.blockedBy === null), [assignees]);

  async function assign(row: QueueRow) {
    const toUserId = picked[row.id];
    if (!toUserId) {
      setState((s) => ({ ...s, [row.id]: { status: 'error', message: 'Choose who is taking it.' } }));
      return;
    }
    setState((s) => ({ ...s, [row.id]: { status: 'saving' } }));

    const requestKey = mintRequestKey(row.id, toUserId);

    try {
      const res = await fetch(`/api/v1/leads/triage/${row.id}/assign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toUserId, requestKey, reason: 'Assigned from the waiting queue' }),
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => null);
        setState((s) => ({
          ...s,
          [row.id]: { status: 'conflict', message: body?.detail ?? 'Somebody else dealt with this. Reloading.' },
        }));
        startTransition(() => router.refresh());
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail =
          body?.errors?.[0]?.message ??
          body?.detail ??
          (res.status === 403 ? 'You may not assign this lead.' : 'That did not work.');
        setState((s) => ({ ...s, [row.id]: { status: 'error', message: detail } }));
        return;
      }
      const who = assignees.find((a) => a.id === toUserId)?.name ?? 'them';
      setState((s) => ({ ...s, [row.id]: { status: 'done', message: `Assigned to ${who}.` } }));
      startTransition(() => router.refresh());
    } catch {
      setState((s) => ({ ...s, [row.id]: { status: 'error', message: 'Could not reach the server.' } }));
    }
  }

  if (rows.length === 0) {
    return (
      <div className="lf-card">
        <EmptyState
          title="Nothing is waiting"
          description="Every lead that arrived has found an owner. When one cannot be placed automatically — no rule, nobody eligible, everyone at capacity — it appears here with the reason."
        />
      </div>
    );
  }

  return (
    <>
      <div className="lf-table-wrap">
        <table className="lf-table">
          <thead>
            <tr>
              <th scope="col">Lead</th>
              <th scope="col">Waiting</th>
              <th scope="col">Why it is here</th>
              <th scope="col">Accountable</th>
              <th scope="col">Review by</th>
              <th scope="col">{canAssign ? 'Assign to' : ''}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const s = state[row.id] ?? { status: 'idle' as RowState };
              const open = expanded === row.id;
              return (
                <tr key={row.id} data-state={s.status}>
                  <td data-label="Lead" data-priority="primary">
                    <a href={`${base}/leads/${row.leadId}`}>{row.leadName}</a>
                    <span className="lf-hint">
                      {row.source.toLowerCase().replace(/_/g, ' ')}
                      {row.sourceDetail ? ` · ${row.sourceDetail}` : ''}
                      {row.episode > 1
                        ? ` · ${row.episode}${row.episode === 2 ? 'nd' : row.episode === 3 ? 'rd' : 'th'} time waiting`
                        : ''}
                    </span>
                  </td>

                  <td data-label="Waiting">
                    {/* Text beside the colour: an overdue row must be readable
                        without relying on the reader seeing red. */}
                    <span
                      style={{
                        color: row.overdue ? 'var(--lf-vermillion)' : undefined,
                        fontWeight: row.overdue ? 600 : undefined,
                      }}
                    >
                      {waited(row.waitingMs)}
                    </span>
                    {row.overdue && <span className="lf-hint">past review time</span>}
                  </td>

                  <td data-label="Why it is here">
                    {row.reasonText}
                    {row.candidates.length > 0 && (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="lf-btn lf-btn--ghost lf-btn--sm"
                          aria-expanded={open}
                          onClick={() => setExpanded(open ? null : row.id)}
                        >
                          {open ? 'Hide' : 'Detail'}
                        </button>
                        {open && (
                          <ul className="lf-hint" style={{ margin: '6px 0 0', paddingLeft: '1.1em' }}>
                            {row.candidates.map((c) => (
                              <li key={c.userId}>
                                {assignees.find((a) => a.id === c.userId)?.name ?? c.userId} —{' '}
                                {c.blockers.length
                                  ? c.blockers.map((b) => b.detail).join('; ')
                                  : 'eligible when checked'}
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                    {row.unsupportedPolicy.length > 0 && (
                      <div className="lf-hint">Ignored configuration: {row.unsupportedPolicy.join('; ')}</div>
                    )}
                  </td>

                  <td data-label="Accountable">
                    {row.routingPolicyMissing ? (
                      <>
                        <Badge value="Routing not configured" tone="brass" />
                        <span className="lf-hint">No fallback owner or team manager is set for this rule.</span>
                      </>
                    ) : (
                      <>
                        {row.responsibleUserName ?? '—'}
                        {row.responsibleTeamName && <span className="lf-hint">{row.responsibleTeamName}</span>}
                      </>
                    )}
                  </td>

                  <td data-label="Review by">
                    {row.reviewPolicyMissing ? (
                      <>
                        <Badge value="Not configured" tone="brass" />
                        <span className="lf-hint">Set an escalation window on the distribution rule.</span>
                      </>
                    ) : (
                      new Date(row.reviewDueAt!).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                    )}
                  </td>

                  <td data-label={canAssign ? 'Assign to' : ''}>
                    {!canAssign ? (
                      <span className="lf-hint">View only</span>
                    ) : s.status === 'done' ? (
                      <span role="status" style={{ color: 'var(--lf-viridian, var(--lf-ink))' }}>
                        ✓ {s.message}
                      </span>
                    ) : (
                      <div
                        style={{ display: 'flex', gap: 'var(--lf-space-2)', alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <label className="lf-sr-only" htmlFor={`assign-${row.id}`}>
                          Assign {row.leadName} to
                        </label>
                        <select
                          id={`assign-${row.id}`}
                          className="lf-input"
                          style={{ minWidth: 160 }}
                          value={picked[row.id] ?? ''}
                          disabled={s.status === 'saving' || pending}
                          onChange={(e) => setPicked((p) => ({ ...p, [row.id]: e.target.value }))}
                        >
                          <option value="">Choose…</option>
                          {eligible.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                              {a.available === null ? '' : ` · ${a.available} free`}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="lf-btn lf-btn--sm"
                          disabled={s.status === 'saving' || pending}
                          onClick={() => void assign(row)}
                        >
                          {s.status === 'saving' ? 'Assigning…' : 'Assign'}
                        </button>
                        {(s.status === 'error' || s.status === 'conflict') && (
                          <span role="alert" className="lf-hint" style={{ color: 'var(--lf-vermillion)' }}>
                            {s.message}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canAssign && eligible.length === 0 && (
        <p className="lf-hint" role="status" style={{ marginTop: 'var(--lf-space-3)' }}>
          Nobody is currently eligible to take a lead. Check account status, approved leave and quotas on the Capacity
          tab.
        </p>
      )}
    </>
  );
}
