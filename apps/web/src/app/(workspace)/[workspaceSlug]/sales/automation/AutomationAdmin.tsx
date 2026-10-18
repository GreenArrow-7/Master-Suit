'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Field from '@/components/forms/Field';

/**
 * Compose a working automation: when <event> on <object> [and field matches],
 * do <action>. Wires to POST /api/v1/automations, which builds the graph the
 * engine (services/automation) already executes.
 */
const OBJECTS = ['LEAD', 'OPPORTUNITY', 'ACCOUNT', 'CONTACT'] as const;
const ACTIONS = [
  ['create_task', 'Create a follow-up task'],
  ['notify_owner', 'Notify the record owner'],
  ['notify_manager', 'Notify the owner’s manager'],
  ['add_tag', 'Add a tag'],
  ['assign', 'Assign it'],
  ['send_template', 'Send a template'],
  ['webhook', 'Call a webhook'],
] as const;
/** What only a lead can take (audit M7-11, M7-12). */
const LEAD_ONLY = new Set(['assign', 'send_template']);

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
  afterHours: '2',
  uncontacted: true,
  assignTo: '',
  templateRef: '',
  url: '',
  activate: true,
};

export function AutomationComposer({
  taskTypeKeys,
  assignees,
  templates,
}: {
  taskTypeKeys: string[];
  assignees: { id: string; fullName: string }[];
  templates: { key: string; name: string; channel: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A webhook's signing secret, shown once after it is created.
  const [secret, setSecret] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY, taskTypeKey: taskTypeKeys[0] ?? '' });
  const isLead = form.objectType === 'LEAD';

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
      case 'assign':
        return { action: 'assign', ...(form.assignTo ? { userId: form.assignTo } : {}) };
      case 'send_template': {
        const [channel, ...key] = form.templateRef.split(':');
        return { action: 'send_template', channel, templateKey: key.join(':') };
      }
      case 'webhook':
        return { action: 'webhook', url: form.url };
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
          ...(form.event === 'time'
            ? {
                afterMinutes: Math.round((Number(form.afterHours) || 1) * 60),
                ...(form.uncontacted ? { condition: { field: 'firstContactedAt', cmp: 'is_null' } } : {}),
              }
            : {}),
          actionSpec: actionSpec(),
          activate: form.activate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? data.errors?.[0]?.message ?? 'Could not create this automation.');
        return;
      }
      setForm({ ...EMPTY, taskTypeKey: taskTypeKeys[0] ?? '' });
      if (data.webhookSecret) setSecret(data.webhookSecret);
      else setOpen(false);
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (secret) {
    return (
      <div className="lf-card" role="status" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 10 }}>
        <strong>Signing secret — copy it now, it is not shown again</strong>
        <code style={{ overflowWrap: 'anywhere', fontSize: 'var(--lf-text-sm)' }}>{secret}</code>
        <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
          Each call carries X-Youhan-Signature: sha256= the HMAC-SHA256 of its body under this secret.
        </span>
        <div>
          <button
            type="button"
            className="lf-btn lf-btn--sm"
            onClick={() => {
              setSecret(null);
              setOpen(false);
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
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

      <Field label="Name" htmlFor="a-name">
        <input id="a-name" className="lf-input" value={form.name} onChange={set('name')} required autoFocus />
      </Field>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 'var(--lf-space-4)',
        }}
      >
        <Field label="When a…" htmlFor="a-object">
          <select id="a-object" className="lf-input" value={form.objectType} onChange={set('objectType')}>
            {OBJECTS.map((o) => (
              <option key={o} value={o}>
                {o.charAt(0) + o.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </Field>

        <Field label="…is" htmlFor="a-event">
          <select id="a-event" className="lf-input" value={form.event} onChange={set('event')}>
            <option value="created">Created</option>
            <option value="updated">Updated</option>
            {isLead && <option value="time">Some time after it arrives</option>}
          </select>
        </Field>

        <Field label="Then" htmlFor="a-action">
          <select id="a-action" className="lf-input" value={form.action} onChange={set('action')}>
            {ACTIONS.filter(([value]) => isLead || !LEAD_ONLY.has(value)).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {form.event === 'time' && isLead && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 'var(--lf-space-4)',
            alignItems: 'end',
          }}
        >
          <Field label="After (hours)" htmlFor="a-after">
            <input
              id="a-after"
              className="lf-input"
              type="number"
              min={0.25}
              step={0.25}
              value={form.afterHours}
              onChange={set('afterHours')}
            />
          </Field>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
            <input type="checkbox" checked={form.uncontacted} onChange={set('uncontacted')} />
            Only if nobody has contacted it yet
          </label>
        </div>
      )}

      {form.action === 'assign' && (
        <Field label="Assign to" htmlFor="a-assign">
          <select id="a-assign" className="lf-input" value={form.assignTo} onChange={set('assignTo')}>
            <option value="">Next in turn (assignment rules), if nobody holds it</option>
            {assignees.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </select>
        </Field>
      )}

      {form.action === 'send_template' && (
        <Field label="Template" htmlFor="a-template-key">
          <select id="a-template-key" className="lf-input" value={form.templateRef} onChange={set('templateRef')}>
            <option value="">Choose a template…</option>
            {templates.map((template) => (
              <option key={`${template.channel}:${template.key}`} value={`${template.channel}:${template.key}`}>
                {template.channel === 'EMAIL' ? 'Email' : 'WhatsApp'} · {template.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {form.action === 'webhook' && (
        <Field label="Webhook URL (https)" htmlFor="a-url">
          <input
            id="a-url"
            className="lf-input"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={form.url}
            onChange={set('url')}
          />
        </Field>
      )}

      {form.action === 'create_task' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 'var(--lf-space-4)',
          }}
        >
          <Field label="Task title" htmlFor="a-tasktitle">
            <input id="a-tasktitle" className="lf-input" value={form.taskTitle} onChange={set('taskTitle')} />
          </Field>
          <Field label="Task type" htmlFor="a-tasktype">
            <select id="a-tasktype" className="lf-input" value={form.taskTypeKey} onChange={set('taskTypeKey')}>
              {taskTypeKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due in (minutes)" htmlFor="a-due">
            <input
              id="a-due"
              className="lf-input"
              type="number"
              min={1}
              value={form.dueInMinutes}
              onChange={set('dueInMinutes')}
            />
          </Field>
        </div>
      )}

      {form.action === 'add_tag' && (
        <Field label="Tag" htmlFor="a-tag">
          <input id="a-tag" className="lf-input" value={form.tag} onChange={set('tag')} />
        </Field>
      )}

      {(form.action === 'notify_owner' || form.action === 'notify_manager') && (
        <Field label="Notification text" htmlFor="a-template">
          <input id="a-template" className="lf-input" value={form.template} onChange={set('template')} />
        </Field>
      )}

      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
        <input type="checkbox" checked={form.activate} onChange={set('activate')} />
        Activate immediately
      </label>

      <div>
        <button
          className="lf-btn"
          type="submit"
          disabled={
            busy ||
            (form.action === 'create_task' && !form.taskTypeKey) ||
            (form.action === 'send_template' && !form.templateRef) ||
            (form.action === 'webhook' && !form.url) ||
            (!isLead && (LEAD_ONLY.has(form.action) || form.event === 'time'))
          }
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
