'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';

interface Mandate {
  id: string;
  type: string;
  status: string;
  startsAt: string;
  expiresAt: string;
  commissionPct: string | null;
  terminationNote: string | null;
}

const TONE: Record<string, 'viridian' | 'brass' | 'vermillion' | 'slate'> = {
  ACTIVE: 'viridian',
  DRAFT: 'brass',
  EXPIRED: 'vermillion',
  TERMINATED: 'slate',
};

/** Mirrors the server state machine so the UI offers only legal moves. */
const NEXT: Record<string, string[]> = {
  DRAFT: ['ACTIVE', 'TERMINATED'],
  ACTIVE: ['TERMINATED'],
  EXPIRED: [],
  TERMINATED: [],
};

/**
 * The agreement that permits everything else on this page.
 *
 * Not optimistic, deliberately. Ending a mandate takes the listing off the
 * market in the same transaction, so a toggle that flips back a second later
 * would have told the agent they may still advertise a property they may not.
 *
 * EXPIRED is never offered as a move: a mandate lapses because a date passed,
 * not because somebody pressed a button, and the server sets it when the book
 * is next read.
 */
export default function MandatePanel({
  listingId,
  canEdit,
  mandates,
  daysLeft,
}: {
  listingId: string;
  canEdit: boolean;
  mandates: Mandate[];
  /**
   * Days until the live mandate ends, measured on the server.
   *
   * Not computed here: reading the clock during render is impure under the
   * React Compiler rule, and it is also the wrong clock — a laptop three days
   * behind would quietly under-report the urgency of an expiring exclusive.
   */
  daysLeft: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = mandates.find((m) => m.status === 'ACTIVE');

  async function decide(mandateId: string, status: string) {
    setBusy(mandateId);
    setError(null);
    try {
      const res = await fetch(`/api/v1/listings/${listingId}/mandate/${mandateId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.errors?.[0]?.message ?? data.detail ?? 'That change was refused.');
        return;
      }
      router.refresh();
    } catch {
      setError('The server could not be reached.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="lf-card" style={{ padding: 18 }}>
      <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
        Mandate
      </h2>

      {!live && (
        <p className="lf-alert" role="status" style={{ marginTop: 0 }}>
          No live mandate. This listing cannot be published until one is signed.
        </p>
      )}

      {live && daysLeft != null && daysLeft <= 30 && (
        <p className="lf-alert" role="status" style={{ marginTop: 0, borderColor: 'var(--lf-brass)' }}>
          This {live.type.toLowerCase().replace(/_/g, '-')} mandate ends in {daysLeft} day{daysLeft === 1 ? '' : 's'}.
          Renew it before it lapses, or the listing comes off the market.
        </p>
      )}

      {error && (
        <p className="lf-hint lf-hint--error" role="alert">
          {error}
        </p>
      )}

      {mandates.length === 0 ? (
        <p className="lf-hint" style={{ margin: 0 }}>
          No mandate has been recorded for this property.
        </p>
      ) : (
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th>From</th>
                <th>Until</th>
                <th style={{ textAlign: 'right' }}>Commission</th>
                {canEdit && <th>Move</th>}
              </tr>
            </thead>
            <tbody>
              {mandates.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 500 }}>{m.type.replace(/_/g, ' ').toLowerCase()}</td>
                  <td>
                    <Badge value={m.status} tone={TONE[m.status] ?? 'slate'} />
                  </td>
                  <td>{new Date(m.startsAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}</td>
                  <td>{new Date(m.expiresAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}</td>
                  <td style={{ textAlign: 'right' }} className="lf-num">
                    {m.commissionPct ? `${m.commissionPct}%` : '—'}
                  </td>
                  {canEdit && (
                    <td>
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        {(NEXT[m.status] ?? []).map((to) => (
                          <button
                            key={to}
                            type="button"
                            className={`lf-btn lf-btn--sm ${to === 'TERMINATED' ? 'lf-btn--danger' : 'lf-btn--secondary'}`}
                            disabled={busy !== null}
                            onClick={() => void decide(m.id, to)}
                          >
                            {busy === m.id ? 'Saving…' : to === 'ACTIVE' ? 'Activate' : 'Terminate'}
                          </button>
                        ))}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
