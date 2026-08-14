'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SalesLink from '@/components/workspace/SalesLink';
import { useModuleBase } from '@/components/workspace/SalesLink';

export default function AccountForm({
  accountId,
  initial,
}: {
  /** Present when editing — the form PATCHes this account instead of creating one. */
  accountId?: string;
  initial?: {
    name: string;
    accountType: string | null;
    industry: string | null;
    website: string | null;
    mainPhone: string | null;
    mainEmail: string | null;
  };
}) {
  const router = useRouter();
  const base = useModuleBase();
  const [name, setName] = useState(initial?.name ?? '');
  const [accountType, setAccountType] = useState(initial?.accountType ?? '');
  const [industry, setIndustry] = useState(initial?.industry ?? '');
  const [website, setWebsite] = useState(initial?.website ?? '');
  const [mainPhone, setMainPhone] = useState(initial?.mainPhone ?? '');
  const [mainEmail, setMainEmail] = useState(initial?.mainEmail ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const editing = Boolean(accountId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(editing ? `/api/v1/accounts/${accountId}` : '/api/v1/accounts', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          ...(accountType ? { accountType } : {}),
          ...(industry ? { industry } : {}),
          ...(website ? { website } : {}),
          ...(mainPhone ? { mainPhone } : {}),
          ...(mainEmail ? { mainEmail } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? (editing ? 'Could not save this account.' : 'Could not create this account.'));
        return;
      }
      router.push(`${base}/accounts/${accountId ?? data.id}`);
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
        <label className="lf-label" htmlFor="name">
          Account name
        </label>
        <input
          id="name"
          className="lf-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="accountType">
          Type
        </label>
        <input
          id="accountType"
          className="lf-input"
          value={accountType}
          onChange={(e) => setAccountType(e.target.value)}
          placeholder="e.g. Enterprise"
        />
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="industry">
          Industry
        </label>
        <input id="industry" className="lf-input" value={industry} onChange={(e) => setIndustry(e.target.value)} />
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="website">
          Website
        </label>
        <input
          id="website"
          className="lf-input"
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://"
        />
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="mainPhone">
          Phone
        </label>
        <input id="mainPhone" className="lf-input" value={mainPhone} onChange={(e) => setMainPhone(e.target.value)} />
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="mainEmail">
          Email
        </label>
        <input
          id="mainEmail"
          className="lf-input"
          type="email"
          value={mainEmail}
          onChange={(e) => setMainEmail(e.target.value)}
        />
      </div>

      <div style={{ display: 'flex', gap: 'var(--lf-space-3)', marginTop: 'var(--lf-space-2)' }}>
        <button className="lf-btn" type="submit" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
        </button>
        <SalesLink className="lf-btn lf-btn--secondary" href={editing ? `/accounts/${accountId}` : '/accounts'}>
          Cancel
        </SalesLink>
      </div>
    </form>
  );
}
