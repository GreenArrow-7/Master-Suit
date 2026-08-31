'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SalesLink from '@/components/workspace/SalesLink';
import { useModuleBase } from '@/components/workspace/SalesLink';
import { problemSummary } from '@/components/forms/useFormErrors';

export default function OpportunityForm({
  accounts = [],
  opportunityId,
  initial,
  stages = [],
}: {
  /** Create mode only — the account link is not PATCHable after creation. */
  accounts?: { id: string; name: string }[];
  /** Present when editing — the form PATCHes this opportunity instead of creating one. */
  opportunityId?: string;
  initial?: {
    name: string;
    amount: string;
    currency: string;
    expectedCloseDate: string;
    stageId: string;
  };
  /** Edit mode only — stages of the opportunity's pipeline. */
  stages?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const base = useModuleBase();
  const [name, setName] = useState(initial?.name ?? '');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [currency, setCurrency] = useState(initial?.currency ?? 'AED');
  const [expectedCloseDate, setExpectedCloseDate] = useState(initial?.expectedCloseDate ?? '');
  const [stageId, setStageId] = useState(initial?.stageId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const editing = Boolean(opportunityId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(editing ? `/api/v1/opportunities/${opportunityId}` : '/api/v1/opportunities', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          ...(!editing && accountId ? { accountId } : {}),
          ...(amount ? { amount: Number(amount) } : {}),
          currency,
          // PATCH accepts null to clear the date; POST only takes a real one.
          ...(editing
            ? { expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate).toISOString() : null }
            : expectedCloseDate
              ? { expectedCloseDate: new Date(expectedCloseDate).toISOString() }
              : {}),
          ...(editing && stageId ? { stageId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          problemSummary(data, editing ? 'Could not save this opportunity.' : 'Could not create this opportunity.'),
        );
        return;
      }
      router.push(`${base}/opportunities/${opportunityId ?? data.id}`);
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

      {!editing && (
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
      )}

      {editing && stages.length > 0 && (
        <div className="lf-field">
          <label className="lf-label" htmlFor="stageId">
            Stage
          </label>
          <select id="stageId" className="lf-input" value={stageId} onChange={(e) => setStageId(e.target.value)}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

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
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create opportunity'}
        </button>
        <SalesLink
          className="lf-btn lf-btn--secondary"
          href={editing ? `/opportunities/${opportunityId}` : '/opportunities'}
        >
          Cancel
        </SalesLink>
      </div>
    </form>
  );
}
