'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Compose a working automation: when <event> on <object> [and field matches],
 * do <action>. Wires to POST /api/v1/automations, which builds the graph the
 * engine (services/automation) already executes.
 */
const OBJECTS = ['LEAD', 'OPPORTUNITY', 'ACCOUNT', 'CONTACT'] as const;
const ACTIONS = [
  ['create_task', 'Create a follow-up task'],
  ['notify_owner', 'Notify the record owner'],
  ['notify_manager', 'Notify the manager'],
  ['add_tag', 'Add a tag'],
] as const;

const EMPTY = {
  name: '',
  objectType: 'LEAD',
  event: 'created',
  action: 'create_task',
  taskTitle: 'Follow up with {name}',
  taskTypeKey: '',
  dueInMinutes: '30',
  template: 'New record needs your attention',
  tag: '',
  activate: true,
};

export function AutomationComposer({ taskTypeKeys }: { taskTypeKeys: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY, taskTypeKey: taskTypeKeys[0] ?? '' });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({
      ...f,
      [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value,
    }));

  function actionSpec() {
    switch (form.action) {
      case 'create_task':
        return {
          action: 'create_task',
          taskTypeKey: form.taskTypeKey,
          title: form.taskTitle,
          dueInMinutes: Number(form.dueInMinutes) || 30,
        };
      case 'add_tag':
        return { action: 'add_tag', tag: form.tag };
      default:
        return { action: form.action, template: form.template };
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/automations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          objectType: form.objectType,
          event: form.event,
          actionSpec: actionSpec(),
          activate: form.activate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? 'Could not create this automation.');
        return;
      }
      setForm({ ...EMPTY, taskTypeKey: taskTypeKeys[0] ?? '' });
      setOpen(false);
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="lf-btn lf-btn--sm" onClick={() => setOpen(true)}>
        New automation
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="lf-card"
      style={{
        padding: 'var(--lf-space-5)',
        display: 'grid',
        gap: 'var(--lf-space-4)',
        marginBottom: 'var(--lf-space-4)',
      }}
      noValidate
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--lf-text-lg)' }}>New automation</h2>
        <button
          type="button"
          className="lf-btn lf-btn--secondary lf-btn--sm"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>

      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}

      <div className="lf-field">
        <label className="lf-label" htmlFor="a-name">
          Name
        </label>
        <input id="a-name" className="lf-input" value={form.name} onChange={set('name')} required autoFocus />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 'var(--lf-space-4)',
        }}
      >
        <div className="lf-field">
          <label className="lf-label" htmlFor="a-object">
            When a…
          </label>
          <select id="a-object" className="lf-input" value={form.objectType} onChange={set('objectType')}>
            {OBJECTS.map((o) => (
              <option key={o} value={o}>
                {o.charAt(0) + o.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>

        <div className="lf-field">
          <label className="lf-label" htmlFor="a-event">
            …is
          </label>
          <select id="a-event" className="lf-input" value={form.event} onChange={set('event')}>
            <option value="created">Created</option>
            <option value="updated">Updated</option>
          </select>
        </div>

        <div className="lf-field">
          <label className="lf-label" htmlFor="a-action">
            Then
          </label>
          <select id="a-action" className="lf-input" value={form.action} onChange={set('action')}>
            {ACTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {form.action === 'create_task' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 'var(--lf-space-4)',
          }}
        >
          <div className="lf-field">
            <label className="lf-label" htmlFor="a-tasktitle">
              Task title
            </label>
            <input id="a-tasktitle" className="lf-input" value={form.taskTitle} onChange={set('taskTitle')} />
          </div>
          <div className="lf-field">
            <label className="lf-label" htmlFor="a-tasktype">
              Task type
            </label>
            <select id="a-tasktype" className="lf-input" value={form.taskTypeKey} onChange={set('taskTypeKey')}>
              {taskTypeKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </div>
          <div className="lf-field">
            <label className="lf-label" htmlFor="a-due">
              Due in (minutes)
            </label>
            <input
              id="a-due"
              className="lf-input"
              type="number"
              min={1}
              value={form.dueInMinutes}
              onChange={set('dueInMinutes')}
            />
          </div>
        </div>
      )}

      {form.action === 'add_tag' && (
        <div className="lf-field">
          <label className="lf-label" htmlFor="a-tag">
            Tag
          </label>
          <input id="a-tag" className="lf-input" value={form.tag} onChange={set('tag')} />
        </div>
      )}

      {(form.action === 'notify_owner' || form.action === 'notify_manager') && (
        <div className="lf-field">
          <label className="lf-label" htmlFor="a-template">
            Notification text
          </label>
          <input id="a-template" className="lf-input" value={form.template} onChange={set('template')} />
        </div>
      )}

      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
        <input type="checkbox" checked={form.activate} onChange={set('activate')} />
        Activate immediately
      </label>

      <div>
        <button
          className="lf-btn"
          type="submit"
          disabled={busy || (form.action === 'create_task' && !form.taskTypeKey)}
        >
          {busy ? 'Creating…' : 'Create automation'}
        </button>
      </div>
    </form>
  );
}

/** Pause / publish an automation in place. */
export function AutomationRowActions({ id, state }: { id: string; state: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function setState(next: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/automations/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: next }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (state === 'PUBLISHED') {
    return (
      <button
        type="button"
        className="lf-btn lf-btn--secondary lf-btn--sm"
        disabled={busy}
        onClick={() => setState('PAUSED')}
      >
        Pause
      </button>
    );
  }
  return (
    <button type="button" className="lf-btn lf-btn--sm" disabled={busy} onClick={() => setState('PUBLISHED')}>
      Activate
    </button>
  );
}
