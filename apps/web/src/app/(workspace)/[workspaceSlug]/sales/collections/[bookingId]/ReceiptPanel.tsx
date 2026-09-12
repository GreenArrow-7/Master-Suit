'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';

export interface ReceiptRow {
  id: string;
  reference: string;
  kind: string;
  status: string;
  amount: string;
  currency: string;
  paidAt: string;
  paymentReference: string;
  providerTransactionRef: string | null;
  evidenceDocumentId: string | null;
  reason: string | null;
  reversesId: string | null;
  recordedBy: string;
  recordedById: string;
  recordedAt: string;
  verifiedBy: string;
  verifiedAt: string | null;
  rejectedBy: string;
  rejectedAt: string | null;
}

export interface Perms {
  canRecord: boolean;
  canApprove: boolean;
  canProposeFee: boolean;
  canApproveFee: boolean;
  userId: string;
}

const money = (amount: string, currency: string) =>
  `${currency} ${Number(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

/**
 * Every receipt on the sale, and the three things a finance user does with
 * them. Buttons appear only where the server would say yes — the recorder
 * never sees "Verify" on their own entry — but the server is what decides.
 */
export default function ReceiptPanel({
  bookingId,
  currency,
  receipts,
  perms,
}: {
  bookingId: string;
  currency: string;
  receipts: ReceiptRow[];
  perms: Perms;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [reversing, setReversing] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [form, setForm] = useState({
    amount: '',
    paidAt: '',
    paymentReference: '',
    providerTransactionRef: '',
    evidenceDocumentId: '',
  });
  const [reason, setReason] = useState('');
  const [reverseAmount, setReverseAmount] = useState('');

  const run = async (key: string, fn: () => Promise<string | null>) => {
    setBusy(key);
    setError(null);
    try {
      const err = await fn();
      if (err) setError(err);
      else {
        setRecording(false);
        setReversing(null);
        setRejecting(null);
        setForm({ amount: '', paidAt: '', paymentReference: '', providerTransactionRef: '', evidenceDocumentId: '' });
        setReason('');
        setReverseAmount('');
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  const record = () =>
    run('record', () =>
      call('/api/v1/collections/receipts', 'POST', {
        bookingId,
        amount: form.amount,
        currency,
        paidAt: new Date(form.paidAt).toISOString(),
        paymentReference: form.paymentReference,
        ...(form.providerTransactionRef ? { providerTransactionRef: form.providerTransactionRef } : {}),
        ...(form.evidenceDocumentId ? { evidenceDocumentId: form.evidenceDocumentId } : {}),
        requestKey: `ui-${bookingId}-${form.paymentReference}-${form.amount}`,
      }),
    );
  const decide = (receiptId: string, to: 'VERIFIED' | 'REJECTED') =>
    run(`${to}-${receiptId}`, () =>
      call('/api/v1/collections/receipts/decide', 'PATCH', { receiptId, to, ...(to === 'REJECTED' ? { reason } : {}) }),
    );
  const reverse = (receiptId: string) =>
    run(`reverse-${receiptId}`, () =>
      call('/api/v1/collections/receipts/reverse', 'POST', { receiptId, amount: reverseAmount, reason }),
    );

  return (
    <section className="lf-card" data-testid="receipts">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--lf-space-2)',
          flexWrap: 'wrap',
        }}
      >
        <h2>Receipts</h2>
        {perms.canRecord && !recording ? (
          <button type="button" className="lf-btn" onClick={() => setRecording(true)}>
            Record a receipt
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="lf-error" data-testid="receipt-error">
          {error}
        </p>
      ) : null}

      {recording ? (
        <form
          className="lf-form-grid"
          data-testid="record-form"
          onSubmit={(e) => {
            e.preventDefault();
            void record();
          }}
        >
          <label className="lf-field">
            <span>Amount received ({currency})</span>
            <input
              className="lf-input"
              inputMode="decimal"
              required
              pattern="^\d{1,16}(\.\d{1,2})?$"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              aria-label="Amount received"
            />
          </label>
          <label className="lf-field">
            <span>Payment date</span>
            <input
              className="lf-input"
              type="date"
              required
              value={form.paidAt}
              onChange={(e) => setForm({ ...form, paidAt: e.target.value })}
              aria-label="Payment date"
            />
          </label>
          <label className="lf-field">
            <span>Payment reference</span>
            <input
              className="lf-input"
              required
              minLength={2}
              value={form.paymentReference}
              onChange={(e) => setForm({ ...form, paymentReference: e.target.value })}
              aria-label="Payment reference"
            />
          </label>
          <label className="lf-field">
            <span>Bank / provider transaction id</span>
            <input
              className="lf-input"
              value={form.providerTransactionRef}
              onChange={(e) => setForm({ ...form, providerTransactionRef: e.target.value })}
              aria-label="Bank or provider transaction id"
            />
          </label>
          <label className="lf-field">
            <span>Evidence document id (if no transaction id)</span>
            <input
              className="lf-input"
              value={form.evidenceDocumentId}
              onChange={(e) => setForm({ ...form, evidenceDocumentId: e.target.value })}
              aria-label="Evidence document id"
            />
          </label>
          <div style={{ display: 'flex', gap: 'var(--lf-space-2)' }}>
            <button type="submit" className="lf-btn" disabled={busy !== null}>
              Save receipt
            </button>
            <button type="button" className="lf-btn lf-btn--secondary" onClick={() => setRecording(false)}>
              Cancel
            </button>
          </div>
          <p style={{ gridColumn: '1 / -1' }}>
            A reference alone is not evidence: give the bank or provider transaction id, or the uploaded document.
            Someone else will verify it.
          </p>
        </form>
      ) : null}

      {receipts.length === 0 ? (
        <p>No receipts recorded.</p>
      ) : (
        <div className="lf-table-wrap">
          <table className="lf-table" data-testid="receipts-table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Amount</th>
                <th>Paid on</th>
                <th>Reference / evidence</th>
                <th>Recorded by</th>
                <th>Verified by</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => {
                const own = r.recordedById === perms.userId;
                return (
                  <tr key={r.id} data-testid={`receipt-${r.reference}`}>
                    <td>
                      <strong>{r.reference}</strong>
                      <span>
                        {r.kind === 'REVERSAL' ? 'Reversal' : 'Receipt'}
                        {r.reason ? ` · ${r.reason}` : ''}
                      </span>
                    </td>
                    <td>
                      {r.kind === 'REVERSAL' ? '−' : ''}
                      {money(r.amount, r.currency)}
                    </td>
                    <td>{r.paidAt.slice(0, 10)}</td>
                    <td>
                      <strong>{r.paymentReference}</strong>
                      <span>
                        {r.providerTransactionRef ?? (r.evidenceDocumentId ? `document ${r.evidenceDocumentId}` : '—')}
                      </span>
                    </td>
                    <td>
                      <strong>{r.recordedBy}</strong>
                      <span>{r.recordedAt.slice(0, 16).replace('T', ' ')}</span>
                    </td>
                    <td>
                      {r.status === 'VERIFIED' ? (
                        <>
                          <strong>{r.verifiedBy}</strong>
                          <span>{r.verifiedAt?.slice(0, 16).replace('T', ' ')}</span>
                        </>
                      ) : r.status === 'REJECTED' ? (
                        <>
                          <strong>Rejected by {r.rejectedBy}</strong>
                          <span>{r.reason}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <Badge
                        tone={r.status === 'VERIFIED' ? 'viridian' : r.status === 'REJECTED' ? 'vermillion' : 'brass'}
                      >
                        {r.status}
                      </Badge>
                    </td>
                    <td>
                      {r.status === 'PENDING' && perms.canApprove && !own ? (
                        rejecting === r.id ? (
                          <span style={{ display: 'inline-flex', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
                            <input
                              className="lf-input"
                              style={{ maxWidth: 200 }}
                              placeholder="Why"
                              aria-label="Rejection reason"
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                            />
                            <button
                              type="button"
                              className="lf-btn lf-btn--danger lf-btn--sm"
                              disabled={busy !== null || reason.length < 4}
                              onClick={() => decide(r.id, 'REJECTED')}
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              className="lf-btn lf-btn--secondary lf-btn--sm"
                              onClick={() => setRejecting(null)}
                            >
                              Back
                            </button>
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', gap: 'var(--lf-space-2)' }}>
                            <button
                              type="button"
                              className="lf-btn lf-btn--sm"
                              disabled={busy !== null}
                              onClick={() => decide(r.id, 'VERIFIED')}
                            >
                              Verify
                            </button>
                            <button
                              type="button"
                              className="lf-btn lf-btn--secondary lf-btn--sm"
                              disabled={busy !== null}
                              onClick={() => setRejecting(r.id)}
                            >
                              Reject
                            </button>
                          </span>
                        )
                      ) : r.status === 'PENDING' && own ? (
                        <span>Awaiting someone else</span>
                      ) : null}
                      {r.status === 'VERIFIED' && r.kind === 'RECEIPT' && perms.canRecord ? (
                        reversing === r.id ? (
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
                              style={{ maxWidth: 120 }}
                              inputMode="decimal"
                              placeholder="Amount"
                              aria-label="Reversal amount"
                              value={reverseAmount}
                              onChange={(e) => setReverseAmount(e.target.value)}
                            />
                            <input
                              className="lf-input"
                              style={{ maxWidth: 200 }}
                              placeholder="Reason"
                              aria-label="Reversal reason"
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                            />
                            <button
                              type="button"
                              className="lf-btn lf-btn--danger lf-btn--sm"
                              disabled={busy !== null || reason.length < 4 || !reverseAmount}
                              onClick={() => reverse(r.id)}
                            >
                              Record reversal
                            </button>
                            <button
                              type="button"
                              className="lf-btn lf-btn--secondary lf-btn--sm"
                              onClick={() => setReversing(null)}
                            >
                              Back
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="lf-btn lf-btn--secondary lf-btn--sm"
                            disabled={busy !== null}
                            onClick={() => setReversing(r.id)}
                          >
                            Reverse
                          </button>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
