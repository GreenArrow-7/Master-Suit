'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import type { Perms } from './ReceiptPanel';

interface AmendmentRow {
  id: string;
  reference: string;
  status: string;
  previousFee: string | null;
  proposedFee: string;
  reason: string;
  agreementReference: string;
  proposedBy: string;
  proposedById: string;
  proposedAt: string;
  decidedBy: string;
  decidedAt: string | null;
  decisionNote: string | null;
  preview: Record<string, unknown>;
}

const money = (amount: string | null, currency: string) =>
  amount === null
    ? '—'
    : `${currency} ${Number(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function call(url: string, method: 'POST' | 'PATCH', body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) return null;
  try {
    const problem = await res.json();
    return problem.detail ?? problem.errors?.[0]?.message ?? problem.title ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

/** The agreed fee and its history; propose with a preview, decide as somebody else. */
export default function FeeAmendmentPanel({
  bookingId,
  currency,
  currentFee,
  bookingStatus,
  amendments,
  perms,
}: {
  bookingId: string;
  currency: string;
  currentFee: string | null;
  bookingStatus: string;
  amendments: AmendmentRow[];
  perms: Perms;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ proposedFee: '', reason: '', agreementReference: '' });
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [note, setNote] = useState('');

  const loadPreview = async () => {
    setError(null);
    const res = await fetch(
      `/api/v1/collections/fee-amendments/preview?bookingId=${bookingId}&proposedFee=${encodeURIComponent(form.proposedFee)}`,
    );
    if (!res.ok) {
      setError(`Preview failed (${res.status})`);
      return;
    }
    setPreview(await res.json());
  };
  const propose = async () => {
    setBusy(true);
    setError(null);
    const err = await call('/api/v1/collections/fee-amendments', 'POST', { bookingId, ...form });
    setBusy(false);
    if (err) setError(err);
    else {
      setOpen(false);
      setPreview(null);
      setForm({ proposedFee: '', reason: '', agreementReference: '' });
      router.refresh();
    }
  };
  const decide = async (amendmentId: string, to: 'APPROVED' | 'REJECTED') => {
    setBusy(true);
    setError(null);
    const err = await call('/api/v1/collections/fee-amendments/decide', 'PATCH', {
      amendmentId,
      to,
      ...(note ? { note } : {}),
    });
    setBusy(false);
    if (err) setError(err);
    else {
      setNote('');
      router.refresh();
    }
  };

  const lines =
    (preview?.commissions as
      { id: string; status: string; currentAmount: string; newAmount: string | null; action: string }[] | undefined) ??
    [];

  return (
    <section className="lf-card" data-testid="fee-amendments">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--lf-space-2)',
          flexWrap: 'wrap',
        }}
      >
        <h2>Agreed agency fee · {money(currentFee, currency)}</h2>
        {perms.canProposeFee && !open ? (
          <button type="button" className="lf-btn lf-btn--secondary" onClick={() => setOpen(true)}>
            {currentFee === null ? 'Propose the fee' : 'Propose an amendment'}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="lf-error" data-testid="fee-error">
          {error}
        </p>
      ) : null}

      {open ? (
        <form
          className="lf-form-grid"
          data-testid="fee-form"
          onSubmit={(e) => {
            e.preventDefault();
            void propose();
          }}
        >
          <label className="lf-field">
            <span>Proposed fee ({currency})</span>
            <input
              className="lf-input"
              inputMode="decimal"
              required
              pattern="^\d{1,16}(\.\d{1,2})?$"
              value={form.proposedFee}
              onChange={(e) => setForm({ ...form, proposedFee: e.target.value })}
              aria-label="Proposed fee"
            />
          </label>
          <label className="lf-field">
            <span>Reason</span>
            <input
              className="lf-input"
              required
              minLength={4}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              aria-label="Amendment reason"
            />
          </label>
          <label className="lf-field">
            <span>Agreement / reference</span>
            <input
              className="lf-input"
              required
              minLength={2}
              value={form.agreementReference}
              onChange={(e) => setForm({ ...form, agreementReference: e.target.value })}
              aria-label="Agreement reference"
            />
          </label>
          <div style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="lf-btn lf-btn--secondary"
              disabled={!form.proposedFee}
              onClick={() => void loadPreview()}
            >
              Preview effect
            </button>
            <button type="submit" className="lf-btn" disabled={busy}>
              {bookingStatus === 'DRAFT' ? 'Apply (before confirmation)' : 'Propose for finance approval'}
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--secondary"
              onClick={() => {
                setOpen(false);
                setPreview(null);
              }}
            >
              Cancel
            </button>
          </div>
          {preview ? (
            <div style={{ gridColumn: '1 / -1' }} data-testid="fee-preview">
              <p>
                Coverage: {(preview.coverageBefore as { covered: boolean }).covered ? 'eligible' : 'blocked'} →{' '}
                {(preview.coverageAfter as { covered: boolean }).covered ? 'eligible' : 'blocked'}.{' '}
                {lines.filter((l) => l.action !== 'unchanged').length === 0
                  ? 'No commission is computed on the fee.'
                  : null}
              </p>
              {lines.filter((l) => l.action !== 'unchanged').length > 0 ? (
                <ul>
                  {lines
                    .filter((l) => l.action !== 'unchanged')
                    .map((l) => (
                      <li key={l.id}>
                        {l.status} commission {money(l.currentAmount, currency)} → {money(l.newAmount, currency)} ·{' '}
                        {l.action === 'recalculate'
                          ? 'recalculated from the frozen bands'
                          : l.action === 'case'
                            ? 'already paid: a review case will be opened'
                            : 'frozen bands cannot answer: a review case will be opened'}
                      </li>
                    ))}
                </ul>
              ) : null}
              {((preview.payoutsToReopen as unknown[]) ?? []).length > 0 ? (
                <p>
                  {(preview.payoutsToReopen as unknown[]).length} payout run(s) will be reopened for fresh approval.
                </p>
              ) : null}
            </div>
          ) : null}
          <p style={{ gridColumn: '1 / -1' }}>
            Currency stays {currency}; a currency change is a separate correction. The proposer cannot approve their own
            amendment.
          </p>
        </form>
      ) : null}

      {amendments.length === 0 ? (
        <p>No amendments.</p>
      ) : (
        <div className="lf-table-wrap">
          <table className="lf-table" data-testid="amendments-table">
            <thead>
              <tr>
                <th>Amendment</th>
                <th>From → to</th>
                <th>Reason / agreement</th>
                <th>Proposed by</th>
                <th>Decided by</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {amendments.map((a) => (
                <tr key={a.id} data-testid={`amendment-${a.reference}`}>
                  <td>
                    <strong>{a.reference}</strong>
                    <span>{a.proposedAt.slice(0, 16).replace('T', ' ')}</span>
                  </td>
                  <td>
                    {money(a.previousFee, currency)} → {money(a.proposedFee, currency)}
                  </td>
                  <td>
                    <strong>{a.reason}</strong>
                    <span>{a.agreementReference}</span>
                  </td>
                  <td>{a.proposedBy}</td>
                  <td>
                    {a.decidedAt ? (
                      <>
                        <strong>{a.decidedBy}</strong>
                        <span>{a.decisionNote ?? ''}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <Badge
                      tone={a.status === 'APPROVED' ? 'viridian' : a.status === 'REJECTED' ? 'vermillion' : 'brass'}
                    >
                      {a.status}
                    </Badge>
                  </td>
                  <td>
                    {a.status === 'PENDING' && perms.canApproveFee && a.proposedById !== perms.userId ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          gap: 'var(--lf-space-2)',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        <input
                          className="lf-input"
                          style={{ maxWidth: 180 }}
                          placeholder="Note (required to reject)"
                          aria-label="Decision note"
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                        />
                        <button
                          type="button"
                          className="lf-btn lf-btn--sm"
                          disabled={busy}
                          onClick={() => void decide(a.id, 'APPROVED')}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="lf-btn lf-btn--danger lf-btn--sm"
                          disabled={busy || note.length < 4}
                          onClick={() => void decide(a.id, 'REJECTED')}
                        >
                          Reject
                        </button>
                      </span>
                    ) : a.status === 'PENDING' && a.proposedById === perms.userId ? (
                      <span>Awaiting finance</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
