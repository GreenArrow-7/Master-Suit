'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Closes an opportunity won or lost. A loss asks for a reason before it commits,
 * because "why did we lose it" is the only part of a lost deal worth keeping.
 */
export default function OutcomeActions({
  opportunityId,
  lossReasons,
}: {
  opportunityId: string;
  lossReasons: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    const res = await fetch(`/api/v1/opportunities/${opportunityId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.detail ?? data.title ?? 'Could not update this opportunity.');
      return;
    }
    setAsking(false);
    router.refresh();
  }

  return (
    <div style={{ position: 'relative', display: 'flex', gap: 'var(--lf-space-2)' }}>
      <button className="lf-btn lf-btn--secondary lf-btn--sm" disabled={busy} onClick={() => setAsking((v) => !v)}>
        Mark lost
      </button>
      <button className="lf-btn lf-btn--sm" disabled={busy} onClick={() => patch({ status: 'WON' })}>
        {busy ? 'Saving…' : 'Mark won'}
      </button>

      {asking && (
        <form
          className="lf-card"
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 6,
            zIndex: 20,
            width: 300,
            padding: 'var(--lf-space-4)',
            boxShadow: 'var(--lf-shadow-2)',
            textAlign: 'left',
          }}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const reasonId = String(form.get('lossReasonId') ?? '');
            void patch({
              status: 'LOST',
              ...(reasonId ? { lossReasonId: reasonId } : {}),
              ...(form.get('lossNotes') ? { lossNotes: String(form.get('lossNotes')) } : {}),
            });
          }}
        >
          <strong style={{ fontSize: 'var(--lf-text-sm)' }}>Why was it lost?</strong>
          {lossReasons.length > 0 && (
            <select className="lf-input" name="lossReasonId" defaultValue="" style={{ marginTop: 8 }}>
              <option value="">No reason recorded</option>
              {lossReasons.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {reason.name}
                </option>
              ))}
            </select>
          )}
          <textarea
            className="lf-input"
            name="lossNotes"
            rows={3}
            maxLength={1000}
            placeholder="Notes (optional)"
            style={{ marginTop: 8 }}
          />
          {error && (
            <p style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-2xs)', marginTop: 6 }}>{error}</p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 'var(--lf-space-3)' }}>
            <button className="lf-btn lf-btn--sm" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Confirm lost'}
            </button>
            <button className="lf-btn lf-btn--sm lf-btn--secondary" type="button" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && !asking && (
        <span style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-2xs)', alignSelf: 'center' }}>
          {error}
        </span>
      )}
    </div>
  );
}
