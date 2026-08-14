'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SalesLink from '@/components/workspace/SalesLink';
import { useModuleBase } from '@/components/workspace/SalesLink';

export default function ContactForm({
  accounts,
  contactId,
  initial,
}: {
  accounts: { id: string; name: string }[];
  /** Present when editing — the form PATCHes this contact instead of creating one. */
  contactId?: string;
  initial?: {
    fullName: string;
    jobTitle: string | null;
    email: string | null;
    phone: string | null;
    accountId: string | null;
  };
}) {
  const router = useRouter();
  const base = useModuleBase();
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [jobTitle, setJobTitle] = useState(initial?.jobTitle ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [accountId, setAccountId] = useState(initial?.accountId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const editing = Boolean(contactId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(editing ? `/api/v1/contacts/${contactId}` : '/api/v1/contacts', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName,
          ...(jobTitle ? { jobTitle } : {}),
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          // PATCH accepts null to unlink the account; POST only takes a real id.
          ...(editing ? { accountId: accountId || null } : accountId ? { accountId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? (editing ? 'Could not save this contact.' : 'Could not create this contact.'));
        return;
      }
      router.push(`${base}/contacts/${contactId ?? data.id}`);
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
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create contact'}
        </button>
        <SalesLink className="lf-btn lf-btn--secondary" href={editing ? `/contacts/${contactId}` : '/contacts'}>
          Cancel
        </SalesLink>
      </div>
    </form>
  );
}
