'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Create and publish lead-capture forms. Creation uses the standard contact
 * field set (name, WhatsApp phone, email, message) — the 90% case; bespoke
 * field sets go through the API.
 */
export function FormComposer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', successMessage: '', publish: true });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/forms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          publish: form.publish,
          ...(form.successMessage ? { successMessage: form.successMessage } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? 'Could not create this form.');
        return;
      }
      setForm({ name: '', successMessage: '', publish: true });
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
        New form
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
        <h2 style={{ margin: 0, fontSize: 'var(--lf-text-lg)' }}>New lead-capture form</h2>
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
        <label className="lf-label" htmlFor="f-name">
          Form name
        </label>
        <input id="f-name" className="lf-input" value={form.name} autoFocus required
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <p className="lf-hint" style={{ margin: '4px 0 0' }}>
          Comes with name, WhatsApp phone, email and message fields. Every submission becomes a lead.
        </p>
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="f-success">
          Thank-you message
        </label>
        <input id="f-success" className="lf-input" value={form.successMessage}
          placeholder="Thank you — we will be in touch shortly."
          onChange={(e) => setForm((f) => ({ ...f, successMessage: e.target.value }))} />
      </div>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
        <input type="checkbox" checked={form.publish}
          onChange={(e) => setForm((f) => ({ ...f, publish: e.target.checked }))} />
        Publish immediately (makes the public link live)
      </label>

      <div>
        <button className="lf-btn" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create form'}
        </button>
      </div>
    </form>
  );
}

/** Publish / pause, and copy the public link once it is live. */
export function FormRowActions({
  id,
  formKey,
  state,
  workspaceSlug,
}: {
  id: string;
  formKey: string;
  state: string;
  workspaceSlug: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function setState(next: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/forms/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: next }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(`${window.location.origin}/f/${workspaceSlug}/${formKey}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div style={{ display: 'flex', gap: 'var(--lf-space-2)', justifyContent: 'flex-end' }}>
      {state === 'PUBLISHED' ? (
        <>
          <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={copy}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" disabled={busy} onClick={() => setState('PAUSED')}>
            Pause
          </button>
        </>
      ) : (
        <button type="button" className="lf-btn lf-btn--sm" disabled={busy} onClick={() => setState('PUBLISHED')}>
          Publish
        </button>
      )}
    </div>
  );
}
