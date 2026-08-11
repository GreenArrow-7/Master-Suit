'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * People — joining and leaving, per the reference: the KPI row, the two mutually
 * exclusive Start onboarding / Start offboarding modes, then the joining and
 * leaving list, the selected employee's checklist, and expiring documents.
 *
 * Creating a joining checklist is idempotent server-side, which is why the
 * helper says so plainly: running it twice adds nothing.
 */
export interface Person {
  employeeId: string;
  name: string;
  employeeNumber: string;
}
export interface JourneyRow {
  employeeId: string;
  name: string;
  employeeNumber: string;
  when: string | null;
  openBlockers: number;
  phase: 'Joining' | 'Leaving';
}
export interface ChecklistTask {
  id: string;
  title: string;
  owner: string;
  dueOn: string | null;
  status: string;
}
export interface ExpiringDoc {
  employeeName: string;
  kind: string;
  expiresAt: string;
  daysRemaining: number;
}

type Mode = null | 'onboarding' | 'offboarding';

export default function LifecycleScreen({
  actionsBase,
  people,
  journeys,
  expiring,
  checklist,
  selected,
  canManage,
  initialMode = null,
}: {
  actionsBase: string;
  people: Person[];
  journeys: JourneyRow[];
  expiring: ExpiringDoc[];
  checklist: ChecklistTask[];
  selected: string | null;
  canManage: boolean;
  /** Opened straight into a mode by the Onboarding / Offboarding nav items. */
  initialMode?: Mode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  const [onboardEmployee, setOnboardEmployee] = useState(people[0]?.employeeId ?? '');
  const [off, setOff] = useState({
    employeeId: people[0]?.employeeId ?? '',
    noticeGivenOn: new Date().toISOString().slice(0, 10),
    noticePeriodDays: '30',
    lastWorkingOn: '',
    separationType: 'RESIGNATION',
    reason: '',
  });

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

  async function createChecklist(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      await call('onboarding-start', { employeeId: onboardEmployee });
      setNote({ text: 'Joining checklist created.' });
      setMode(null);
      router.refresh();
    } catch (error) {
      setNote({ text: (error as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function startOffboarding(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      await call('offboarding-start', {
        employeeId: off.employeeId,
        noticeGivenOn: off.noticeGivenOn,
        noticePeriodDays: Number(off.noticePeriodDays) || 30,
        ...(off.lastWorkingOn ? { lastWorkingOn: off.lastWorkingOn } : {}),
        separationType: off.separationType,
        reason: off.reason || 'Offboarding started from the People screen.',
      });
      setNote({ text: 'Offboarding started. The exit checklist has been built.' });
      setMode(null);
      router.refresh();
    } catch (error) {
      setNote({ text: (error as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function setTask(taskId: string, done: boolean) {
    setBusy(true);
    try {
      await call(done ? 'checklist-complete' : 'checklist-reopen', { taskId });
      router.refresh();
    } catch (error) {
      setNote({ text: (error as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {canManage && (
        <div className="lf-life__modes">
          <button
            type="button"
            className={`lf-btn${mode === 'onboarding' ? '' : ' lf-btn--secondary'}`}
            onClick={() => setMode(mode === 'onboarding' ? null : 'onboarding')}
          >
            Start onboarding
          </button>
          <button
            type="button"
            className={`lf-btn${mode === 'offboarding' ? '' : ' lf-btn--secondary'}`}
            onClick={() => setMode(mode === 'offboarding' ? null : 'offboarding')}
          >
            Start offboarding
          </button>
        </div>
      )}

      {note && (
        <p className="lf-security__note" data-bad={note.bad} role="status">
          {note.text}
        </p>
      )}

      {mode === 'onboarding' && (
        <form className="lf-card lf-life__form" onSubmit={createChecklist}>
          <h2>Start onboarding</h2>
          <div className="lf-field">
            <label className="lf-label" htmlFor="ob-emp">
              Employee
            </label>
            <select id="ob-emp" className="lf-input" value={onboardEmployee} onChange={(e) => setOnboardEmployee(e.target.value)} required>
              {people.map((person) => (
                <option key={person.employeeId} value={person.employeeId}>
                  {person.name} · {person.employeeNumber}
                </option>
              ))}
            </select>
          </div>
          <p className="lf-life__helper">
            Builds the joining checklist from the employee&rsquo;s joining date. Running it twice will not duplicate
            tasks.
          </p>
          <div className="lf-life__actions">
            <button className="lf-btn" type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create checklist'}
            </button>
            <button type="button" className="lf-btn lf-btn--secondary" onClick={() => setMode(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === 'offboarding' && (
        <form className="lf-card lf-life__form" onSubmit={startOffboarding}>
          <h2>Start offboarding</h2>
          <div className="lf-life__grid">
            <div className="lf-field">
              <label className="lf-label" htmlFor="of-emp">
                Employee
              </label>
              <select id="of-emp" className="lf-input" value={off.employeeId} onChange={(e) => setOff((f) => ({ ...f, employeeId: e.target.value }))} required>
                {people.map((person) => (
                  <option key={person.employeeId} value={person.employeeId}>
                    {person.name} · {person.employeeNumber}
                  </option>
                ))}
              </select>
            </div>
            <div className="lf-field">
              <label className="lf-label" htmlFor="of-notice">
                Notice given on
              </label>
              <input id="of-notice" className="lf-input" type="date" value={off.noticeGivenOn} onChange={(e) => setOff((f) => ({ ...f, noticeGivenOn: e.target.value }))} required />
            </div>
            <div className="lf-field">
              <label className="lf-label" htmlFor="of-period">
                Notice period (days)
              </label>
              <input id="of-period" className="lf-input" type="number" min={0} max={180} value={off.noticePeriodDays} onChange={(e) => setOff((f) => ({ ...f, noticePeriodDays: e.target.value }))} />
            </div>
            <div className="lf-field">
              <label className="lf-label" htmlFor="of-last">
                Last working day (optional)
              </label>
              <input id="of-last" className="lf-input" type="date" value={off.lastWorkingOn} onChange={(e) => setOff((f) => ({ ...f, lastWorkingOn: e.target.value }))} />
            </div>
            <div className="lf-field">
              <label className="lf-label" htmlFor="of-type">
                Type
              </label>
              <select id="of-type" className="lf-input" value={off.separationType} onChange={(e) => setOff((f) => ({ ...f, separationType: e.target.value }))}>
                <option value="RESIGNATION">Resignation</option>
                <option value="TERMINATION">Termination</option>
              </select>
            </div>
            <div className="lf-field">
              <label className="lf-label" htmlFor="of-reason">
                Reason
              </label>
              <input id="of-reason" className="lf-input" value={off.reason} onChange={(e) => setOff((f) => ({ ...f, reason: e.target.value }))} />
            </div>
          </div>
          <p className="lf-life__helper">
            Leave the last working day blank to derive it from the notice period. This moves the employee to notice
            status and builds the exit checklist.
          </p>
          <div className="lf-life__actions">
            <button className="lf-btn" type="submit" disabled={busy}>
              {busy ? 'Starting…' : 'Start offboarding'}
            </button>
            <button type="button" className="lf-btn lf-btn--secondary" onClick={() => setMode(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <h2 className="lf-leave__section">Joining and leaving</h2>
      <div className="lf-life__split">
        <div className="lf-card" style={{ padding: 0, overflow: 'hidden' }}>
          {journeys.length === 0 ? (
            <p className="lf-leave__empty" style={{ margin: 0 }}>
              Nobody joining or leaving.
            </p>
          ) : (
            <table className="lf-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Phase</th>
                  <th>When</th>
                  <th>Blocked</th>
                </tr>
              </thead>
              <tbody>
                {journeys.map((row) => (
                  <tr key={`${row.phase}-${row.employeeId}`}>
                    <td data-label="Employee">
                      <a href={`?employee=${row.employeeId}`}>{row.name}</a>
                      <div style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-2xs)' }}>{row.employeeNumber}</div>
                    </td>
                    <td data-label="Phase">{row.phase}</td>
                    <td data-label="When">{row.when ?? '—'}</td>
                    <td data-label="Blocked">{row.openBlockers > 0 ? `${row.openBlockers} open` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="lf-card" style={{ padding: 0, overflow: 'hidden' }}>
          {!selected ? (
            <p className="lf-leave__empty" style={{ margin: 0 }}>
              Pick someone to see their checklist.
            </p>
          ) : checklist.length === 0 ? (
            <p className="lf-leave__empty" style={{ margin: 0 }}>
              No checklist tasks for this person.
            </p>
          ) : (
            <table className="lf-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Owner</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {checklist.map((task) => (
                  <tr key={task.id}>
                    <td data-label="Task">{task.title}</td>
                    <td data-label="Owner">{task.owner}</td>
                    <td data-label="Due">{task.dueOn ?? '—'}</td>
                    <td data-label="Status">
                      <span className="lf-badge">{task.status.toLowerCase()}</span>
                    </td>
                    <td data-label="">
                      {canManage && (
                        <button
                          type="button"
                          className="lf-btn lf-btn--secondary lf-btn--sm"
                          disabled={busy}
                          onClick={() => void setTask(task.id, task.status !== 'DONE')}
                        >
                          {task.status === 'DONE' ? 'Reopen' : 'Complete'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <h2 className="lf-leave__section">Documents expiring</h2>
      {expiring.length === 0 ? (
        <div className="lf-card lf-leave__empty">Nothing expiring in the next 90 days.</div>
      ) : (
        <div className="lf-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="lf-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Document</th>
                <th>Expires</th>
                <th>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {expiring.map((row, i) => (
                <tr key={i}>
                  <td data-label="Employee">{row.employeeName}</td>
                  <td data-label="Document">{row.kind}</td>
                  <td data-label="Expires">{row.expiresAt}</td>
                  <td data-label="Remaining">{row.daysRemaining}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
