'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Field from '@/components/forms/Field';
import { DateTimeInput } from '@/components/forms/DateInput';

/** Create a follow-up from the Follow-ups page, against POST /api/v1/follow-ups. */
const EMPTY = { title: '', dueAt: '', priority: 'MEDIUM', description: '' };

export default function FollowUpComposer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);

  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.dueAt) {
      setError(!form.title ? 'Enter a title.' : 'Enter a due date and time.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/follow-ups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          dueAt: new Date(form.dueAt).toISOString(),
          priority: form.priority,
          ...(form.description ? { description: form.description } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? 'Could not create this follow-up.');
        return;
      }
      setForm(EMPTY);
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
        New follow-up
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
        <h2 style={{ margin: 0, fontSize: 'var(--lf-text-lg)' }}>New follow-up</h2>
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

      <Field label="Title" htmlFor="f-title">
        <input id="f-title" className="lf-input" value={form.title} onChange={set('title')} required autoFocus />
      </Field>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--lf-space-4)',
        }}
      >
        <Field label="Due" htmlFor="f-due" required>
          <DateTimeInput
            id="f-due"
            value={form.dueAt}
            onChange={(dueAt) => setForm((f) => ({ ...f, dueAt }))}
            required
          />
        </Field>

        <Field label="Priority" htmlFor="f-priority">
          <select id="f-priority" className="lf-input" value={form.priority} onChange={set('priority')}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </Field>
      </div>

      <Field label="Notes" htmlFor="f-desc">
        <textarea id="f-desc" className="lf-input" rows={3} value={form.description} onChange={set('description')} />
      </Field>

      <div>
        <button className="lf-btn" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create follow-up'}
        </button>
      </div>
    </form>
  );
}
