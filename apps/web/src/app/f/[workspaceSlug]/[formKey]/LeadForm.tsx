'use client';

import { useState } from 'react';

interface FieldDef {
  key: string;
  label: string;
  type: string;
  isRequired: boolean;
  placeholder: string | null;
}

/** Renders the published fields and posts answers to the public submit API. */
export default function LeadForm({
  workspace,
  formKey,
  fields,
}: {
  workspace: string;
  formKey: string;
  fields: FieldDef[];
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/public/forms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace, form: formKey, answers }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : 'Something was missing — check the form and retry.');
        return;
      }
      setDone(data.message ?? 'Thank you — we will be in touch shortly.');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p role="status" style={{ margin: 0, fontSize: 'var(--lf-text-base)', color: 'var(--lf-ink)' }}>
        {done}
      </p>
    );
  }

  const inputType = (type: string) =>
    type === 'EMAIL' ? 'email' : type === 'PHONE' ? 'tel' : type === 'NUMBER' ? 'number' : 'text';

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--lf-space-4)' }} noValidate>
      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}

      {fields.map((field) => (
        <div className="lf-field" key={field.key}>
          <label className="lf-label" htmlFor={`pf-${field.key}`}>
            {field.label}
            {field.isRequired ? ' *' : ''}
          </label>
          {field.type === 'LONG_TEXT' ? (
            <textarea
              id={`pf-${field.key}`}
              className="lf-input"
              rows={3}
              required={field.isRequired}
              placeholder={field.placeholder ?? undefined}
              value={answers[field.key] ?? ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [field.key]: e.target.value }))}
            />
          ) : (
            <input
              id={`pf-${field.key}`}
              className="lf-input"
              type={inputType(field.type)}
              required={field.isRequired}
              placeholder={field.placeholder ?? undefined}
              value={answers[field.key] ?? ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [field.key]: e.target.value }))}
            />
          )}
        </div>
      ))}

      <button className="lf-btn" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send'}
      </button>
    </form>
  );
}
