'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The Leave screen, built to the reference: the balance cards with their
 * progress rules and UNPAID badges, the Apply form, then Your requests and
 * Waiting on you.
 *
 * Applying and deciding both go through the leave engine, so overlap, balance,
 * holiday-aware day counting and approver routing all apply — this screen never
 * writes a request directly.
 */
export interface Balance {
  leaveTypeId: string;
  name: string;
  paid: boolean;
  entitledDays: number;
  takenDays: number;
  availableDays: number;
}
export interface RequestRow {
  id: string;
  employee: string;
  type: string;
  from: string;
  to: string;
  days: number;
  status: string;
  reason: string | null;
}

export default function LeaveScreen({
  actionsBase,
  balances,
  mine,
  waiting,
  canDecide,
}: {
  actionsBase: string;
  balances: Balance[];
  mine: RequestRow[];
  waiting: RequestRow[];
  canDecide: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    leaveTypeId: balances[0]?.leaveTypeId ?? '',
    startDate: '',
    endDate: '',
    halfDay: false,
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  async function call(action: string, body: Record<string, unknown>) {
    const res = await fetch(`${actionsBase}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'That did not work.');
    return data;
  }

  async function apply(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      await call('leave-apply', {
        leaveTypeId: form.leaveTypeId,
        startDate: form.startDate,
        endDate: form.endDate || form.startDate,
        halfDay: form.halfDay,
        ...(form.reason ? { reason: form.reason } : {}),
      });
      setForm((f) => ({ ...f, startDate: '', endDate: '', halfDay: false, reason: '' }));
      setNote({ text: 'Leave requested.' });
      router.refresh();
    } catch (error) {
      setNote({ text: (error as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, approve: boolean) {
    setBusy(true);
    try {
      await call(approve ? 'leave-approve' : 'leave-reject', { requestId: id });
      router.refresh();
    } catch (error) {
      setNote({ text: (error as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    try {
      await call('leave-cancel', { requestId: id });
      router.refresh();
    } catch (error) {
      setNote({ text: (error as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="lf-leave__section">Your balance</h2>
      <div className="lf-leave__balances">
        {balances.map((balance) => {
          const total = balance.entitledDays;
          const pct = total > 0 ? Math.min(100, Math.round((balance.availableDays / total) * 100)) : 0;
          return (
            <article className="lf-card lf-leave__balance" key={balance.leaveTypeId}>
              <div className="lf-leave__balance-head">
                <span className="lf-leave__balance-name">{balance.name}</span>
                {!balance.paid && <span className="lf-leave__unpaid">UNPAID</span>}
              </div>
              <div className="lf-leave__balance-value">{Math.round(balance.availableDays)}</div>
              <div className="lf-leave__balance-sub">
                of {total.toFixed(1)} days · {Math.round(balance.takenDays)} used
              </div>
              <div className="lf-leave__rule">
                <i style={{ width: `${pct}%` }} />
              </div>
            </article>
          );
        })}
      </div>

      <h2 className="lf-leave__section">Apply</h2>
      <form className="lf-card lf-leave__apply" onSubmit={apply}>
        <div className="lf-leave__fields">
          <div className="lf-field">
            <label className="lf-label" htmlFor="lv-type">
              Leave type
            </label>
            <select
              id="lv-type"
              className="lf-input"
              value={form.leaveTypeId}
              onChange={(e) => setForm((f) => ({ ...f, leaveTypeId: e.target.value }))}
              required
            >
              {balances.map((balance) => (
                <option key={balance.leaveTypeId} value={balance.leaveTypeId}>
                  {balance.name}
                </option>
              ))}
            </select>
          </div>
          <div className="lf-field">
            <label className="lf-label" htmlFor="lv-from">
              First day
            </label>
            <input
              id="lv-from"
              className="lf-input"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              required
            />
          </div>
          <div className="lf-field">
            <label className="lf-label" htmlFor="lv-to">
              Last day
            </label>
            <input
              id="lv-to"
              className="lf-input"
              type="date"
              value={form.endDate}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
            />
          </div>
        </div>
        <label className="lf-leave__half">
          <input
            type="checkbox"
            checked={form.halfDay}
            onChange={(e) => setForm((f) => ({ ...f, halfDay: e.target.checked }))}
          />
          Half day
        </label>
        <div className="lf-field">
          <label className="lf-label" htmlFor="lv-reason">
            Reason (optional)
          </label>
          <textarea
            id="lv-reason"
            className="lf-input"
            rows={3}
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          />
        </div>
        {note && (
          <p className="lf-security__note" data-bad={note.bad} role="status">
            {note.text}
          </p>
        )}
        <button className="lf-btn" type="submit" disabled={busy || !form.leaveTypeId}>
          {busy ? 'Applying…' : 'Apply for leave'}
        </button>
      </form>

      <h2 className="lf-leave__section">Your requests</h2>
      <RequestTable rows={mine} empty="Nothing here yet." onCancel={(id) => void cancel(id)} busy={busy} />

      <h2 className="lf-leave__section">Waiting on you</h2>
      <RequestTable
        rows={waiting}
        empty="Nothing here yet."
        showEmployee
        onDecide={canDecide ? (id, ok) => void decide(id, ok) : undefined}
        busy={busy}
      />
    </>
  );
}

function RequestTable({
  rows,
  empty,
  showEmployee,
  onDecide,
  onCancel,
  busy,
}: {
  rows: RequestRow[];
  empty: string;
  showEmployee?: boolean;
  onDecide?: (id: string, approve: boolean) => void;
  onCancel?: (id: string) => void;
  busy?: boolean;
}) {
  if (rows.length === 0) return <div className="lf-card lf-leave__empty">{empty}</div>;
  return (
    <div className="lf-card" style={{ padding: 0, overflow: 'hidden' }}>
      <table className="lf-table">
        <thead>
          <tr>
            {showEmployee && <th>Employee</th>}
            <th>Type</th>
            <th>From</th>
            <th>To</th>
            <th>Days</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {showEmployee && <td data-label="Employee">{row.employee}</td>}
              <td data-label="Type">{row.type}</td>
              <td data-label="From">{row.from}</td>
              <td data-label="To">{row.to}</td>
              <td data-label="Days">{row.days}</td>
              <td data-label="Status">
                <span className="lf-badge">{row.status.toLowerCase()}</span>
              </td>
              <td data-label="">
                {onDecide && row.status === 'PENDING' && (
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    <button type="button" className="lf-btn lf-btn--sm" disabled={busy} onClick={() => onDecide(row.id, true)}>
                      Approve
                    </button>
                    <button
                      type="button"
                      className="lf-btn lf-btn--secondary lf-btn--sm"
                      disabled={busy}
                      onClick={() => onDecide(row.id, false)}
                    >
                      Reject
                    </button>
                  </span>
                )}
                {onCancel && row.status === 'PENDING' && (
                  <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" disabled={busy} onClick={() => onCancel(row.id)}>
                    Cancel
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
