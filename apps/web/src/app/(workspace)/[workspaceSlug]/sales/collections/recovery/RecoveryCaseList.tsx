'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';

interface CaseRow {
  id: string;
  kind: string;
  status: string;
  outcome: string | null;
  booking: string;
  bookingId: string;
  person: string;
  commissionAmount: string;
  commissionStatus: string;
  currency: string;
  shortfall: string | null;
  adjustment: string | null;
  origin: string;
  reason: string;
  assignee: string;
  assigneeId: string | null;
  proposedOutcome: string | null;
  proposedBy: string;
  proposedById: string | null;
  proposalReason: string | null;
  resolutionNote: string | null;
  recoveredAmount: string | null;
  resolutionReference: string | null;
  createdAt: string;
}

const money = (amount: string | null, currency: string) =>
  amount === null
    ? '—'
    : `${currency} ${Number(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function call(url: string, body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  try {
    const problem = await res.json();
    return problem.detail ?? problem.errors?.[0]?.message ?? problem.title ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export default function RecoveryCaseList({
  cases,
  perms,
}: {
  cases: CaseRow[];
  perms: { canWork: boolean; canApprove: boolean; userId: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<{ id: string; what: 'ack' | 'recover' | 'propose' } | null>(null);
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [txn, setTxn] = useState('');
  const [outcome, setOutcome] = useState<'WRITTEN_OFF' | 'ADJUSTED'>('WRITTEN_OFF');

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const err = await fn();
    setBusy(false);
    if (err) setError(err);
    else {
      setMode(null);
      setText('');
      setAmount('');
      setReference('');
      setTxn('');
      router.refresh();
    }
  };

  return (
    <div className="lf-stack" data-testid="recovery-cases">
      {error ? (
        <p role="alert" className="lf-error" data-testid="case-error">
          {error}
        </p>
      ) : null}
      {cases.map((k) => (
        <section key={k.id} className="lf-card" data-testid={`case-${k.id}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
            <div>
              <strong>
                <SalesLink href={`/collections/${k.bookingId}`}>{k.booking}</SalesLink> · {k.person}
              </strong>
              <div>
                {k.kind === 'FEE_AMENDMENT' ? 'Fee amendment' : 'Receipt reversal'} {k.origin} · commission{' '}
                {money(k.commissionAmount, k.currency)} ({k.commissionStatus})
                {k.shortfall ? ` · shortfall ${money(k.shortfall, k.currency)}` : ''}
                {k.adjustment ? ` · adjustment ${money(k.adjustment, k.currency)}` : ''}
              </div>
              <div>{k.reason}</div>
              <div>
                Assigned to {k.assignee}
                {k.resolutionNote ? ` · ${k.resolutionNote}` : ''}
                {k.proposedOutcome
                  ? ` · ${k.proposedOutcome.replace('_', ' ').toLowerCase()} proposed by ${k.proposedBy}: ${k.proposalReason}`
                  : ''}
                {k.outcome === 'RECOVERED'
                  ? ` · recovered ${money(k.recoveredAmount, k.currency)} (${k.resolutionReference})`
                  : ''}
              </div>
            </div>
            <Badge
              tone={k.status === 'RESOLVED' ? 'viridian' : k.status === 'RESOLUTION_PROPOSED' ? 'brass' : 'vermillion'}
            >
              {k.status.replace('_', ' ')}
              {k.outcome ? ` · ${k.outcome.replace('_', ' ')}` : ''}
            </Badge>
          </div>

          {k.status !== 'RESOLVED' && perms.canWork ? (
            <div
              style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap', marginTop: 'var(--lf-space-2)' }}
            >
              {k.assigneeId !== perms.userId ? (
                <button
                  type="button"
                  className="lf-btn lf-btn--secondary lf-btn--sm"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      call('/api/v1/collections/recovery', {
                        action: 'ASSIGN',
                        caseId: k.id,
                        assigneeId: perms.userId,
                      }),
                    )
                  }
                >
                  Assign to me
                </button>
              ) : null}
              {k.status === 'OPEN' ? (
                <button
                  type="button"
                  className="lf-btn lf-btn--secondary lf-btn--sm"
                  disabled={busy}
                  onClick={() => setMode({ id: k.id, what: 'ack' })}
                >
                  Acknowledge
                </button>
              ) : null}
              {k.status !== 'RESOLUTION_PROPOSED' ? (
                <>
                  <button
                    type="button"
                    className="lf-btn lf-btn--sm"
                    disabled={busy}
                    onClick={() => setMode({ id: k.id, what: 'recover' })}
                  >
                    Record recovery
                  </button>
                  <button
                    type="button"
                    className="lf-btn lf-btn--secondary lf-btn--sm"
                    disabled={busy}
                    onClick={() => setMode({ id: k.id, what: 'propose' })}
                  >
                    Propose write-off / adjustment
                  </button>
                </>
              ) : null}
            </div>
          ) : null}

          {k.status === 'RESOLUTION_PROPOSED' && perms.canApprove && k.proposedById !== perms.userId ? (
            <div
              style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap', marginTop: 'var(--lf-space-2)' }}
            >
              <input
                className="lf-input"
                style={{ maxWidth: 220 }}
                placeholder="Note"
                aria-label="Approval note"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button
                type="button"
                className="lf-btn lf-btn--sm"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    call('/api/v1/collections/recovery/approve', {
                      caseId: k.id,
                      approve: true,
                      ...(text.length >= 4 ? { note: text } : {}),
                    }),
                  )
                }
              >
                Approve {k.proposedOutcome?.replace('_', ' ').toLowerCase()}
              </button>
              <button
                type="button"
                className="lf-btn lf-btn--secondary lf-btn--sm"
                disabled={busy || text.length < 4}
                onClick={() =>
                  run(() => call('/api/v1/collections/recovery/approve', { caseId: k.id, approve: false, note: text }))
                }
              >
                Decline
              </button>
            </div>
          ) : k.status === 'RESOLUTION_PROPOSED' && k.proposedById === perms.userId ? (
            <p>Awaiting a second person&rsquo;s approval.</p>
          ) : null}

          {mode?.id === k.id && mode.what === 'ack' ? (
            <div className="lf-form-grid" data-testid="ack-form">
              <input
                className="lf-input"
                placeholder="What was found"
                aria-label="Acknowledgement note"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 'var(--lf-space-2)' }}>
                <button
                  type="button"
                  className="lf-btn lf-btn--sm"
                  disabled={busy || text.length < 4}
                  onClick={() =>
                    run(() => call('/api/v1/collections/recovery', { action: 'ACKNOWLEDGE', caseId: k.id, note: text }))
                  }
                >
                  Save acknowledgement
                </button>
                <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
              <p style={{ gridColumn: '1 / -1' }}>
                Acknowledging records that someone looked. It does not mean money was recovered.
              </p>
            </div>
          ) : null}

          {mode?.id === k.id && mode.what === 'recover' ? (
            <div className="lf-form-grid" data-testid="recover-form">
              <input
                className="lf-input"
                inputMode="decimal"
                placeholder={`Amount recovered (${k.currency})`}
                aria-label="Amount recovered"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <input
                className="lf-input"
                placeholder="Reference"
                aria-label="Recovery reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
              <input
                className="lf-input"
                placeholder="Bank / provider transaction id"
                aria-label="Recovery transaction id"
                value={txn}
                onChange={(e) => setTxn(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 'var(--lf-space-2)' }}>
                <button
                  type="button"
                  className="lf-btn lf-btn--sm"
                  disabled={busy || !amount || reference.length < 2 || txn.length < 4}
                  onClick={() =>
                    run(() =>
                      call('/api/v1/collections/recovery', {
                        action: 'RECOVER',
                        caseId: k.id,
                        recoveredAmount: amount,
                        resolutionReference: reference,
                        providerTransactionRef: txn,
                      }),
                    )
                  }
                >
                  Record recovery
                </button>
                <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {mode?.id === k.id && mode.what === 'propose' ? (
            <div className="lf-form-grid" data-testid="propose-form">
              <select
                className="lf-input"
                aria-label="Proposed outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as 'WRITTEN_OFF' | 'ADJUSTED')}
              >
                <option value="WRITTEN_OFF">Write off</option>
                {k.kind === 'FEE_AMENDMENT' ? <option value="ADJUSTED">Accept adjustment</option> : null}
              </select>
              <input
                className="lf-input"
                placeholder="Reason"
                aria-label="Proposal reason"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 'var(--lf-space-2)' }}>
                <button
                  type="button"
                  className="lf-btn lf-btn--sm"
                  disabled={busy || text.length < 4}
                  onClick={() =>
                    run(() =>
                      call('/api/v1/collections/recovery', { action: 'PROPOSE', caseId: k.id, outcome, reason: text }),
                    )
                  }
                >
                  Propose
                </button>
                <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
              <p style={{ gridColumn: '1 / -1' }}>
                A second person with approval rights must agree before the case closes this way. Nobody is debited.
              </p>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}
