'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Create a task from the standalone Tasks page — the button the page was
 * missing. The POST route already existed; this wires to it.
 *
 * An inline expanding card, matching the lead-detail Tasks tab rather than
 * inventing a modal the design system has no styles for. A task can be personal
 * (no lead) or handed to a teammate; the server decides whether the current
 * user may assign to others.
 */
export interface TaskType {
  id: string;
  name: string;
}
export interface Assignee {
  id: string;
  fullName: string;
}

const EMPTY = (typeId: string) => ({
  typeId,
  title: '',
  dueAt: '',
  priority: 'MEDIUM',
  ownerId: '',
  description: '',
});

export default function TaskComposer({
  taskTypes,
  assignees,
  canAssignOthers,
}: {
  taskTypes: TaskType[];
  assignees: Assignee[];
  canAssignOthers: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => EMPTY(taskTypes[0]?.id ?? ''));

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.typeId || !form.dueAt) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          typeId: form.typeId,
          title: form.title,
          dueAt: new Date(form.dueAt).toISOString(),
          priority: form.priority,
          ...(form.ownerId ? { ownerId: form.ownerId } : {}),
          ...(form.description ? { description: form.description } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? 'Could not create this task.');
        return;
      }
      setForm(EMPTY(taskTypes[0]?.id ?? ''));
      setOpen(false);
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (taskTypes.length === 0) {
    return (
      <span className="lf-hint" title="An administrator configures task types in settings.">
        No task types configured
      </span>
    );
  }

  if (!open) {
    return (
      <button type="button" className="lf-btn lf-btn--sm" onClick={() => setOpen(true)}>
        New task
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="lf-card"
      style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 'var(--lf-space-4)', marginBottom: 'var(--lf-space-4)' }}
      noValidate
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--lf-text-lg)' }}>New task</h2>
        <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>

      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}

      <div className="lf-field">
        <label className="lf-label" htmlFor="t-title">
          Title
        </label>
        <input id="t-title" className="lf-input" value={form.title} onChange={set('title')} required autoFocus />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--lf-space-4)' }}>
        <div className="lf-field">
          <label className="lf-label" htmlFor="t-type">
            Type
          </label>
          <select id="t-type" className="lf-input" value={form.typeId} onChange={set('typeId')} required>
            {taskTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="lf-field">
          <label className="lf-label" htmlFor="t-due">
            Due
          </label>
          <input id="t-due" className="lf-input" type="datetime-local" value={form.dueAt} onChange={set('dueAt')} required />
        </div>

        <div className="lf-field">
          <label className="lf-label" htmlFor="t-priority">
            Priority
          </label>
          <select id="t-priority" className="lf-input" value={form.priority} onChange={set('priority')}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </div>

        {canAssignOthers && (
          <div className="lf-field">
            <label className="lf-label" htmlFor="t-owner">
              Assign to
            </label>
            <select id="t-owner" className="lf-input" value={form.ownerId} onChange={set('ownerId')}>
              <option value="">Myself</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="t-desc">
          Notes
        </label>
        <textarea id="t-desc" className="lf-input" rows={3} value={form.description} onChange={set('description')} />
      </div>

      <div>
        <button className="lf-btn" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create task'}
        </button>
      </div>
    </form>
  );
}
