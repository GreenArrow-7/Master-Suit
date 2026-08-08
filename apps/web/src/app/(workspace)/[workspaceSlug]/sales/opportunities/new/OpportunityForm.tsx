'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SalesLink from '@/components/workspace/SalesLink';
import { useModuleBase } from '@/components/workspace/SalesLink';

export default function OpportunityForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const router = useRouter();
  const base = useModuleBase();
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('AED');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/opportunities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          ...(accountId ? { accountId } : {}),
          ...(amount ? { amount: Number(amount) } : {}),
          currency,
          ...(expectedCloseDate ? { expectedCloseDate: new Date(expectedCloseDate).toISOString() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? 'Could not create this opportunity.');
        return;
      }
      router.push(`${base}/opportunities/${data.id}`);
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
          Opportunity name
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 'var(--lf-space-3)' }}>
        <div className="lf-field">
          <label className="lf-label" htmlFor="amount">
            Amount
          </label>
          <input
            id="amount"
            className="lf-input"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="lf-field">
          <label className="lf-label" htmlFor="currency">
            Currency
          </label>
          <input
            id="currency"
            className="lf-input"
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </div>
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="expectedCloseDate">
          Expected close date
        </label>
        <input
          id="expectedCloseDate"
          className="lf-input"
          type="date"
          value={expectedCloseDate}
          onChange={(e) => setExpectedCloseDate(e.target.value)}
        />
      </div>

      <div style={{ display: 'flex', gap: 'var(--lf-space-3)', marginTop: 'var(--lf-space-2)' }}>
        <button className="lf-btn" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create opportunity'}
        </button>
        <SalesLink className="lf-btn lf-btn--secondary" href="/opportunities">
          Cancel
        </SalesLink>
      </div>
    </form>
  );
}
