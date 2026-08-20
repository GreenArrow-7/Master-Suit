'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface CoachingNoteView {
  id: string;
  body: string;
  resolvedAt: string | null;
  createdAt: string;
  author: { id: string; fullName: string };
}

/**
 * Notes are loaded by the server page (visibility already applied there); this
 * component only writes. `canCoach` reflects the same rule the API enforces —
 * TEAM-or-wider viewers writing on someone else's call — so the form does not
 * appear only to be refused.
 */
export default function CoachingNotes({
  callId,
  notes,
  canCoach,
  viewerId,
  repId,
}: {
  callId: string;
  notes: CoachingNoteView[];
  canCoach: boolean;
  viewerId: string;
  repId: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/calls/${callId}/coaching`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? `Request failed (${res.status})`);
      }
      setBody('');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function resolve(noteId: string, resolved: boolean) {
    setBusy(true);
    try {
      await fetch(`/api/v1/calls/${callId}/coaching`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId, resolved }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
        Coaching
      </div>

      {notes.length === 0 && (
        <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>No coaching notes on this call.</p>
      )}

      {notes.map((note) => (
        <div
          key={note.id}
          style={{
            borderBottom: '1px solid var(--lf-line)',
            paddingBottom: 'var(--lf-space-3)',
            marginBottom: 'var(--lf-space-3)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 'var(--lf-text-sm)', fontWeight: 600 }}>{note.author.fullName}</span>
            <span style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>
              {new Date(note.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
              {note.resolvedAt && <span style={{ color: 'var(--lf-viridian)', marginLeft: 6 }}>✓ acted on</span>}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)', whiteSpace: 'pre-wrap' }}>
            {note.body}
          </p>
          {(viewerId === repId || viewerId === note.author.id) && (
            <button
              className="lf-btn lf-btn--ghost lf-btn--sm"
              style={{ marginTop: 4 }}
              disabled={busy}
              onClick={() => resolve(note.id, !note.resolvedAt)}
            >
              {note.resolvedAt ? 'Reopen' : 'Mark acted on'}
            </button>
          )}
        </div>
      ))}

      {canCoach && (
        <form onSubmit={submit} style={{ display: 'grid', gap: 8 }}>
          {error && <div style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-sm)' }}>{error}</div>}
          <textarea
            className="lf-input"
            rows={3}
            placeholder="Coach this call — what went well, what to do differently…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            maxLength={5000}
          />
          <button type="submit" className="lf-btn lf-btn--secondary" disabled={busy || !body.trim()}>
            {busy ? 'Saving…' : 'Add coaching note'}
          </button>
        </form>
      )}
    </section>
  );
}
