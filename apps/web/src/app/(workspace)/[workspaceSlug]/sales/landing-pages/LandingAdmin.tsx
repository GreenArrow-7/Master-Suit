'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Create and publish landing pages; embed a published form to capture leads. */
export function LandingComposer({ forms }: { forms: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', headline: '', body: '', formId: '', publish: true });

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.headline) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/landing-pages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          headline: form.headline,
          publish: form.publish,
          ...(form.body ? { body: form.body } : {}),
          ...(form.formId ? { formId: form.formId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? 'Could not create this page.');
        return;
      }
      setForm({ name: '', headline: '', body: '', formId: '', publish: true });
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
        New landing page
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
        <h2 style={{ margin: 0, fontSize: 'var(--lf-text-lg)' }}>New landing page</h2>
        <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>

      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--lf-space-4)' }}>
        <div className="lf-field">
          <label className="lf-label" htmlFor="lp-name">
            Internal name
          </label>
          <input id="lp-name" className="lf-input" value={form.name} onChange={set('name')} required autoFocus />
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="lp-form">
            Embedded form
          </label>
          <select id="lp-form" className="lf-input" value={form.formId} onChange={set('formId')}>
            <option value="">None — page only</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="lp-headline">
          Headline
        </label>
        <input id="lp-headline" className="lf-input" value={form.headline} onChange={set('headline')} required />
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="lp-body">
          Supporting copy
        </label>
        <textarea id="lp-body" className="lf-input" rows={4} value={form.body} onChange={set('body')} />
      </div>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
        <input type="checkbox" checked={form.publish} onChange={set('publish')} />
        Publish immediately (makes the public link live)
      </label>

      <div>
        <button className="lf-btn" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create page'}
        </button>
      </div>
    </form>
  );
}

/** Publish / pause, and copy the public link. */
export function LandingRowActions({
  id,
  slug,
  state,
  workspaceSlug,
}: {
  id: string;
  slug: string;
  state: string;
  workspaceSlug: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function setState(next: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/landing-pages/${id}`, {
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
    await navigator.clipboard.writeText(`${window.location.origin}/l/${workspaceSlug}/${slug}`);
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
