'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/ui/Badge';

interface Policy {
  afterDays: number;
  maxTimes: number;
  returnStageId: string | null;
}

interface Row {
  id: string;
  reference: string;
  fullName: string;
  stageName: string;
  ownerName: string | null;
  lostAt: string | null;
  recycleCount: number;
  blocked: string | null;
}

/**
 * The policy, and the queue it produces.
 *
 * Both on one screen because the queue is unreadable without the rule that
 * made it: "9 leads" means nothing, "9 leads lost more than 90 days ago"
 * is a decision. Changing the number above re-renders the list below, which is
 * the fastest way to answer "what happens if we wait sixty days instead".
 */
export default function RecycleQueue({
  policy,
  stages,
  candidates,
}: {
  policy: Policy;
  stages: { id: string; name: string }[];
  candidates: Row[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Policy>(policy);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = candidates.filter((row) => row.blocked === null);

  async function send<T>(method: 'PUT' | 'POST', payload: unknown, done: (result: T) => string) {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const response = await fetch('/api/v1/leads/recycle', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => ({}))) as {
          detail?: string;
          title?: string;
          errors?: { message: string }[];
        };
        throw new Error(failure.errors?.[0]?.message ?? failure.detail ?? failure.title ?? 'That did not work.');
      }
      setNote(done((await response.json()) as T));
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: 'grid', gap: 'var(--lf-space-5)' }}>
      <div className="lf-card" style={{ padding: 'var(--lf-space-4)', display: 'grid', gap: 12 }}>
        <strong>When a lost lead may be offered to somebody else</strong>
        <p style={{ margin: 0, color: 'var(--lf-ink-3)' }}>
          A recycled lead loses its owner and goes back through your distribution rules, so whoever is next in the
          rotation picks it up. Leads that asked not to be called are never recycled, however long they have been
          sitting.
        </p>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
              Cooling-off period (days, 0 is off)
            </span>
            <input
              className="lf-input"
              type="number"
              min={0}
              max={730}
              value={draft.afterDays}
              onChange={(event) => setDraft({ ...draft, afterDays: Number(event.target.value) })}
              style={{ width: '10rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>Times before giving up</span>
            <input
              className="lf-input"
              type="number"
              min={1}
              max={10}
              value={draft.maxTimes}
              onChange={(event) => setDraft({ ...draft, maxTimes: Number(event.target.value) })}
              style={{ width: '10rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>Comes back to</span>
            <select
              className="lf-input"
              value={draft.returnStageId ?? ''}
              onChange={(event) => setDraft({ ...draft, returnStageId: event.target.value || null })}
              style={{ width: '14rem' }}
            >
              <option value="">First open stage</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="lf-btn"
            disabled={busy}
            onClick={() => void send('PUT', draft, () => 'Saved.')}
          >
            Save
          </button>
        </div>
      </div>

      {note && <p style={{ margin: 0, color: 'var(--lf-viridian)' }}>{note}</p>}
      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--lf-vermillion)' }}>
          {error}
        </p>
      )}

      {candidates.length > 0 && (
        <div className="lf-card" style={{ overflowX: 'auto' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 'var(--lf-space-4)',
              flexWrap: 'wrap',
            }}
          >
            <strong>Lost leads</strong>
            <span style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)' }}>
              {ready.length} of {candidates.length} ready
            </span>
            <button
              type="button"
              className="lf-btn"
              style={{ marginLeft: 'auto' }}
              disabled={busy || ready.length === 0}
              onClick={() =>
                void send('POST', { all: true }, (result: { recycled: number }) =>
                  result.recycled === 0
                    ? 'Nothing was recycled — the queue had already moved on.'
                    : `${result.recycled} ${result.recycled === 1 ? 'lead is' : 'leads are'} back in the rotation.`,
                )
              }
            >
              Recycle all {ready.length > 0 ? ready.length : ''}
            </button>
          </div>

          <table className="lf-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Lost</th>
                <th>Was with</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {candidates.map((row) => (
                <tr key={row.id}>
                  <td>
                    <a href={`../${row.id}`}>{row.fullName}</a>
                    <span style={{ display: 'block', fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
                      {row.reference} · {row.stageName}
                      {row.recycleCount > 0 &&
                        ` · recycled ${row.recycleCount} ${row.recycleCount === 1 ? 'time' : 'times'}`}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {row.lostAt ? new Date(row.lostAt).toLocaleDateString('en-GB') : '—'}
                  </td>
                  <td>{row.ownerName ?? '—'}</td>
                  <td style={{ maxWidth: '22rem' }}>
                    {row.blocked ? (
                      <span style={{ color: 'var(--lf-ink-3)' }}>{row.blocked}</span>
                    ) : (
                      <Badge tone="viridian">Ready</Badge>
                    )}
                  </td>
                  <td>
                    {row.blocked === null && (
                      <button
                        type="button"
                        className="lf-btn lf-btn--ghost"
                        disabled={busy}
                        onClick={() =>
                          void send(
                            'POST',
                            { leadIds: [row.id] },
                            (result: { skipped: { reason: string }[] }) =>
                              result.skipped[0]?.reason ?? 'Back in the rotation.',
                          )
                        }
                      >
                        Recycle
                      </button>
                    )}
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
