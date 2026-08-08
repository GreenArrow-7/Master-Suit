'use client';

import { useState } from 'react';

/**
 * One star, one endpoint.
 *
 * Optimistic, deliberately — the platform rule forbids optimistic UI on money
 * and on status transitions, and a personal bookmark is neither. Reverted on
 * failure so a star that did not save does not keep claiming it did.
 */
export default function FavouriteButton({ projectId, initial }: { projectId: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const previous = on;
    setOn(!on);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/favourite`, { method: 'POST' });
      if (!res.ok) throw new Error('refused');
      const data = await res.json();
      setOn(Boolean(data.isFavourite));
    } catch {
      setOn(previous);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`lf-btn lf-btn--sm ${on ? '' : 'lf-btn--secondary'}`}
      aria-pressed={on}
      disabled={busy}
      onClick={() => void toggle()}
    >
      {on ? '★ Saved' : '☆ Save'}
    </button>
  );
}

/**
 * Priority and pitchable, as two toggles rather than an edit screen.
 *
 * These are the two fields the sales floor actually changes day to day — "push
 * this one this week", "stop offering that one" — and they are decided by
 * someone looking at the project, not by someone opening a form. Not optimistic:
 * un-pitchable is a compliance-shaped statement, and a toggle that flips back a
 * second later is worse than one that takes a moment.
 */
export function ProjectFlags({
  projectId,
  isPriority,
  isPitchable,
}: {
  projectId: string;
  isPriority: boolean;
  isPitchable: boolean;
}) {
  const [flags, setFlags] = useState({ isPriority, isPitchable });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function set(key: 'isPriority' | 'isPitchable', value: boolean) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? 'That change was refused.');
        return;
      }
      setFlags((f) => ({ ...f, [key]: value }));
    } catch {
      setError('The server could not be reached.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        type="button"
        className={`lf-btn lf-btn--sm ${flags.isPriority ? '' : 'lf-btn--secondary'}`}
        aria-pressed={flags.isPriority}
        disabled={busy !== null}
        onClick={() => void set('isPriority', !flags.isPriority)}
      >
        {busy === 'isPriority' ? 'Saving…' : flags.isPriority ? 'Priority' : 'Make priority'}
      </button>
      <button
        type="button"
        className={`lf-btn lf-btn--sm ${flags.isPitchable ? 'lf-btn--secondary' : 'lf-btn--danger'}`}
        aria-pressed={!flags.isPitchable}
        disabled={busy !== null}
        onClick={() => void set('isPitchable', !flags.isPitchable)}
      >
        {busy === 'isPitchable' ? 'Saving…' : flags.isPitchable ? 'Stop pitching' : 'Not pitchable'}
      </button>
      {error && (
        <span className="lf-hint lf-hint--error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
