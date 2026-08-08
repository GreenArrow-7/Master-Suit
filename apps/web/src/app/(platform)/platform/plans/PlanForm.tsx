'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PlanForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    try {
      const response = await fetch('/api/v1/platform/plans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: values.code,
          name: values.name,
          modules: form.getAll('modules'),
          maxUsers: Number(values.maxUsers),
          maxEmployees: Number(values.maxEmployees),
          maxStorageMb: Number(values.maxStorageMb),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.detail ?? 'The plan could not be created.');
        return;
      }
      event.currentTarget.reset();
      router.refresh();
    } catch {
      setError('The server could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="lf-card"
      style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 'var(--lf-space-4)' }}
    >
      <div>
        <div className="lf-eyebrow">Plan management</div>
        <h2 style={{ margin: '6px 0 0' }}>Create a subscription plan</h2>
      </div>
      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--lf-space-4)' }}>
        <Field label="Plan name" name="name" required />
        <Field label="Plan code" name="code" placeholder="growth" required />
      </div>
      <fieldset style={{ border: '1px solid var(--lf-line)', borderRadius: 8, padding: 'var(--lf-space-4)' }}>
        <legend className="lf-label">Included modules</legend>
        <div style={{ display: 'flex', gap: 'var(--lf-space-5)' }}>
          <label>
            <input type="checkbox" name="modules" value="HRMS" defaultChecked /> People / HRMS
          </label>
          <label>
            <input type="checkbox" name="modules" value="SALES" defaultChecked /> Sales CRM
          </label>
        </div>
      </fieldset>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--lf-space-4)' }}>
        <Field label="Maximum users" name="maxUsers" type="number" defaultValue="100" required />
        <Field label="Maximum employees" name="maxEmployees" type="number" defaultValue="100" required />
        <Field label="Storage (MB)" name="maxStorageMb" type="number" defaultValue="10240" required />
      </div>
      <div>
        <button type="submit" className="lf-btn" disabled={busy}>
          {busy ? 'Creating…' : 'Create plan'}
        </button>
      </div>
    </form>
  );
}

function Field(props: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
}) {
  const { label, ...inputProps } = props;
  return (
    <label className="lf-field">
      <span className="lf-label">{label}</span>
      <input className="lf-input" {...inputProps} />
    </label>
  );
}
