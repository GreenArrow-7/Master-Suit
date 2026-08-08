'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Everything that can be done to a visit, in the order it happens.
 *
 * Nothing here is optimistic. A visit is the evidence behind a commission, and
 * a button that flips back a second later would have told an agent they had
 * checked in somewhere they had not.
 */
export default function VisitActions({
  visitId,
  status,
  verification,
  isOwner,
  canApprove,
  canVerify,
  canEdit,
}: {
  visitId: string;
  status: string;
  verification: string;
  isOwner: boolean;
  canApprove: boolean;
  canVerify: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [amending, setAmending] = useState(false);
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState('');

  async function call(label: string, url: string, body: unknown, method = 'PATCH') {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.errors?.[0]?.message ?? data.detail ?? 'That was refused.');
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError('The server could not be reached.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const move = (to: string) =>
    call(to, `/api/v1/site-visits/${visitId}`, { action: 'transition', status: to, note: note || undefined });

  /**
   * Browser geolocation, at an explicit checkpoint, while the tab is open.
   *
   * That is all the web offers and this does not pretend otherwise — there is no
   * background tracking here and no attempt to detect a mocked fix, because a
   * page cannot. What the server does with the reading is measure it.
   */
  async function doPunch(direction: 'in' | 'out') {
    if (!navigator.geolocation) {
      setError('This browser will not share a location. Check in from a phone.');
      return;
    }
    setBusy(direction);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        void call(
          direction,
          `/api/v1/site-visits/${visitId}/punch`,
          {
            direction,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyM: position.coords.accuracy,
          },
          'POST',
        );
      },
      (err) => {
        setBusy(null);
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was refused. A visit cannot be checked in without it.'
            : 'Could not get a location fix. Move somewhere with a clearer view of the sky and try again.',
        );
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  return (
    <section className="lf-card" style={{ padding: 18 }}>
      <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
        Actions
      </h2>

      {error && (
        <p className="lf-hint lf-hint--error" role="alert">
          {error}
        </p>
      )}

      {(status === 'REQUESTED' || status === 'APPROVED') && (
        <div className="lf-field" style={{ marginBottom: 12 }}>
          <label className="lf-label" htmlFor="visit-note">
            Note
          </label>
          <input
            id="visit-note"
            className="lf-input"
            value={note}
            placeholder="Optional — recorded against the decision"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {status === 'REQUESTED' && canApprove && (
          <>
            <button
              type="button"
              className="lf-btn lf-btn--sm"
              disabled={busy !== null}
              onClick={() => void move('APPROVED')}
            >
              {busy === 'APPROVED' ? 'Saving…' : 'Approve'}
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--danger lf-btn--sm"
              disabled={busy !== null}
              onClick={() => void move('REJECTED')}
            >
              {busy === 'REJECTED' ? 'Saving…' : 'Reject'}
            </button>
          </>
        )}

        {status === 'APPROVED' && isOwner && (
          <button
            type="button"
            className="lf-btn lf-btn--lg"
            disabled={busy !== null}
            onClick={() => void doPunch('in')}
          >
            {busy === 'in' ? 'Getting your location…' : 'Check in at the property'}
          </button>
        )}

        {status === 'CHECKED_IN' && isOwner && (
          <>
            <button
              type="button"
              className="lf-btn lf-btn--secondary lf-btn--sm"
              disabled={busy !== null}
              onClick={() => void doPunch('out')}
            >
              {busy === 'out' ? 'Getting your location…' : 'Check out'}
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--sm"
              disabled={busy !== null}
              onClick={() => void move('COMPLETED')}
            >
              {busy === 'COMPLETED' ? 'Saving…' : 'Complete'}
            </button>
          </>
        )}

        {status === 'APPROVED' && canApprove && (
          <button
            type="button"
            className="lf-btn lf-btn--ghost lf-btn--sm"
            disabled={busy !== null}
            onClick={() => void move('NO_SHOW')}
          >
            {busy === 'NO_SHOW' ? 'Saving…' : 'Mark no-show'}
          </button>
        )}

        {['REQUESTED', 'APPROVED'].includes(status) && (isOwner || canApprove) && (
          <button
            type="button"
            className="lf-btn lf-btn--ghost lf-btn--sm"
            disabled={busy !== null}
            onClick={() => void move('CANCELLED')}
          >
            {busy === 'CANCELLED' ? 'Saving…' : 'Cancel'}
          </button>
        )}

        {['COMPLETED', 'NO_SHOW'].includes(status) && canVerify && verification === 'PENDING' && (
          <>
            <button
              type="button"
              className="lf-btn lf-btn--sm"
              disabled={busy !== null}
              onClick={() =>
                void call('verify', `/api/v1/site-visits/${visitId}`, {
                  action: 'verify',
                  verdict: 'VERIFIED',
                  note: note || undefined,
                })
              }
            >
              {busy === 'verify' ? 'Saving…' : 'Verify'}
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--danger lf-btn--sm"
              disabled={busy !== null}
              onClick={() =>
                void call('dispute', `/api/v1/site-visits/${visitId}`, {
                  action: 'verify',
                  verdict: 'DISPUTED',
                  note: note || undefined,
                })
              }
            >
              {busy === 'dispute' ? 'Saving…' : 'Dispute'}
            </button>
          </>
        )}

        {status === 'COMPLETED' && canEdit && !amending && (
          <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setAmending(true)}>
            Correct the record
          </button>
        )}
      </div>

      {/* The acceptance criterion, made visible. A completed visit is not edited
          in place — the correction carries a reason, and the reason is what the
          audit entry quotes. */}
      {amending && (
        <form
          style={{ marginTop: 16, display: 'grid', gap: 12, maxWidth: 560 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await call('amend', `/api/v1/site-visits/${visitId}`, {
              action: 'amend',
              reason,
              outcome: outcome || undefined,
            });
            if (ok) setAmending(false);
          }}
        >
          <div className="lf-field">
            <label className="lf-label" htmlFor="amend-outcome">
              Corrected outcome
            </label>
            <input
              id="amend-outcome"
              className="lf-input"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            />
          </div>
          <div className="lf-field">
            <label className="lf-label" htmlFor="amend-reason">
              Why is this being corrected?
            </label>
            <input
              id="amend-reason"
              className="lf-input"
              required
              minLength={5}
              value={reason}
              placeholder="Recorded in the audit log alongside what changed"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <p className="lf-hint" style={{ margin: 0 }}>
            The visit goes back to the verification queue: the record changed after it was signed off, so the sign-off
            no longer covers it.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="lf-btn lf-btn--sm" disabled={busy !== null}>
              {busy === 'amend' ? 'Saving…' : 'Save the correction'}
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--ghost lf-btn--sm"
              onClick={() => setAmending(false)}
              disabled={busy !== null}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
