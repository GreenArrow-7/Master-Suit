'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SalesLink from '@/components/workspace/SalesLink';
import { useModuleBase } from '@/components/workspace/SalesLink';

export default function ContactForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const router = useRouter();
  const base = useModuleBase();
  const [fullName, setFullName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/contacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName,
          ...(jobTitle ? { jobTitle } : {}),
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          ...(accountId ? { accountId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? 'Could not create this contact.');
        return;
      }
      router.push(`${base}/contacts/${data.id}`);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--lf-space-4)' }} noValidate>
      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}

      <div className="lf-field">
        <label className="lf-label" htmlFor="fullName">
          Full name
        </label>
        <input
          id="fullName"
          className="lf-input"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          autoFocus
        />
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="jobTitle">
          Job title
        </label>
        <input id="jobTitle" className="lf-input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="email">
          Email
        </label>
        <input id="email" className="lf-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="phone">
          Phone
        </label>
        <input id="phone" className="lf-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="accountId">
          Account
        </label>
        <select id="accountId" className="lf-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">No account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 'var(--lf-space-3)', marginTop: 'var(--lf-space-2)' }}>
        <button className="lf-btn" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create contact'}
        </button>
        <SalesLink className="lf-btn lf-btn--secondary" href="/contacts">
          Cancel
        </SalesLink>
      </div>
    </form>
  );
}
