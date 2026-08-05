'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

export type FormField = {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'date' | 'time' | 'datetime-local' | 'number' | 'select';
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
};

export default function WorkspaceRecordForm({ endpoint, fields, submitLabel = 'Create' }: { endpoint: string; fields: FormField[]; submitLabel?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setError(null);
    const body = Object.fromEntries(
      [...new FormData(form).entries()].filter(([, value]) => value !== ''),
    );
    try {
      const response = await authFetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) { setError(data.detail ?? data.title ?? 'The record could not be saved.'); return; }
      form.reset();
      router.refresh();
    } catch { setError('The server could not be reached.'); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="lf-form-section">
    {error && <div className="lf-alert" role="alert">{error}</div>}
    <div className="lf-form-section__heading"><div><h2>Record details</h2><p>Complete the information below. Required fields are marked by the browser.</p></div></div>
    <div className="lf-form-grid">
      {fields.map((field) => <label className="lf-field" key={field.name}><span className="lf-label">{field.label}</span>
        {field.type === 'select'
          ? <select className="lf-input" name={field.name} required={field.required}><option value="">Select…</option>{field.options?.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
          : <input className="lf-input" name={field.name} type={field.type ?? 'text'} required={field.required} placeholder={field.placeholder} />}
      </label>)}
    </div>
    <div><button className="lf-btn" type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button></div>
  </form>;
}
