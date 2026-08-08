'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SalesLink from '@/components/workspace/SalesLink';
import { useModuleBase } from '@/components/workspace/SalesLink';

export default function AccountForm() {
  const router = useRouter();
  const base = useModuleBase();
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState('');
  const [industry, setIndustry] = useState('');
  const [website, setWebsite] = useState('');
  const [mainPhone, setMainPhone] = useState('');
  const [mainEmail, setMainEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/accounts', {
        method: 'POST',
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
        setError(data.detail ?? 'Could not create this account.');
        return;
      }
      router.push(`${base}/accounts/${data.id}`);
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
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <SalesLink className="lf-btn lf-btn--secondary" href="/accounts">
          Cancel
        </SalesLink>
      </div>
    </form>
  );
}
