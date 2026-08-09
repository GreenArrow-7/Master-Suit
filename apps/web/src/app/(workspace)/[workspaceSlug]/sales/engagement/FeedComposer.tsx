'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const KINDS = [
  ['UPDATE', 'Update'],
  ['ANNOUNCEMENT', 'Announcement'],
  ['CELEBRATION', 'Celebration'],
  ['QUESTION', 'Question'],
] as const;

/**
 * Writing a post, and reacting to one.
 *
 * Both live in the same component because both are the same fetch to the same
 * route, and a reaction that used its own client would need its own copy of the
 * error handling to stay consistent with this one.
 */
export default function FeedComposer({ canPin }: { canPin: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<string>('UPDATE');
  const [videoUrl, setVideoUrl] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body,
          kind,
          videoUrl: videoUrl.trim() || undefined,
          isPinned: isPinned || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? 'That could not be posted. Try again shortly.');
        return;
      }
      setBody('');
      setVideoUrl('');
      setIsPinned(false);
      // Server-rendered feed, so the new post arrives with a refresh rather
      // than being optimistically spliced in and possibly disagreeing.
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="lf-card" style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
      <label style={{ display: 'grid', gap: 'var(--lf-space-2)' }}>
        <span className="lf-hint">Say something to the workspace</span>
        <textarea
          className="lf-input"
          rows={3}
          maxLength={8000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
        />
      </label>

      <div style={{ display: 'flex', gap: 'var(--lf-space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="lf-input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          {KINDS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <input
          className="lf-input"
          style={{ flex: '1 1 240px' }}
          type="url"
          placeholder="Link to a clip (optional)"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
        />

        {canPin && (
          <label style={{ display: 'flex', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
            <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} />
            <span>Pin</span>
          </label>
        )}

        <button type="submit" className="lf-btn" disabled={busy || body.trim().length === 0}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>

      {error && (
        <p role="alert" style={{ color: 'var(--lf-vermillion)', margin: 0 }}>
          {error}
        </p>
      )}
    </form>
  );
}

const REACTIONS = [
  ['LIKE', '👍'],
  ['CELEBRATE', '🎉'],
  ['SUPPORT', '💪'],
  ['INSIGHTFUL', '💡'],
] as const;

export function Reactions({
  postId,
  counts,
  mine,
}: {
  postId: string;
  counts: Record<string, number>;
  mine: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function press(kind: string) {
    setBusy(true);
    try {
      await fetch('/api/v1/posts', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        // Pressing the one you already chose takes it back.
        body: JSON.stringify({ action: 'REACT', postId, kind: mine === kind ? null : kind }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 'var(--lf-space-2)', marginTop: 'var(--lf-space-2)' }}>
      {REACTIONS.map(([kind, glyph]) => (
        <button
          key={kind}
          type="button"
          disabled={busy}
          onClick={() => press(kind)}
          aria-pressed={mine === kind}
          aria-label={kind.toLowerCase()}
          className={mine === kind ? 'lf-btn lf-btn--sm' : 'lf-btn lf-btn--secondary lf-btn--sm'}
        >
          {glyph} {counts[kind] ?? 0}
        </button>
      ))}
    </div>
  );
}
