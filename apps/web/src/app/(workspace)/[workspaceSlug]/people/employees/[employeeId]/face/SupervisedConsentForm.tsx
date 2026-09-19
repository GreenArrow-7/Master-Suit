'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Consent recorded at HR's desk with the employee present. The employee reads
 * the policy and signs by typing their full name; HR submits. The server checks
 * the name against the record and keeps who recorded it beside the signature.
 */
export default function SupervisedConsentForm({
  actionsBase,
  employeeId,
  employeeName,
  policyVersion,
}: {
  actionsBase: string;
  employeeId: string;
  employeeName: string;
  policyVersion: string;
}) {
  const router = useRouter();
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${actionsBase}/consent-grant-supervised`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ employeeId, signature, policyVersion }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : 'The consent could not be recorded.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="lf-card" style={{ padding: 'var(--lf-space-5)' }} onSubmit={submit}>
      <h2 style={{ margin: 0 }}>Record consent with the employee present</h2>
      <p style={{ color: 'var(--lf-ink-2)', maxWidth: '80ch' }}>
        Read the biometric policy ({policyVersion}) with {employeeName}: their face is measured to confirm attendance,
        stored as a template that cannot be turned back into a photo, kept only while they are employed, and they can
        withdraw at any time from their own Security screen. If they agree, they type their full name below as their
        signature; you submit it. Their name is checked against their record.
      </p>
      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}
      <label className="lf-field">
        <span className="lf-label" data-required="">
          Employee signature (full name)
        </span>
        <input
          className="lf-input"
          value={signature}
          onChange={(event) => setSignature(event.target.value)}
          placeholder={employeeName}
          autoComplete="off"
          required
        />
      </label>
      <div style={{ marginTop: 'var(--lf-space-3)' }}>
        <button className="lf-btn" type="submit" disabled={busy || !signature.trim()}>
          {busy ? 'Recording…' : 'Record consent'}
        </button>
      </div>
    </form>
  );
}
