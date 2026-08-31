'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Turn {
  role: 'REP' | 'PROSPECT';
  text: string;
  at: string;
}

interface Session {
  id: string;
  scenario: string;
  status: string;
  turns: Turn[];
  remainingToday?: number;
}

interface Score {
  status: string;
  overallScore: number | null;
  maxScore: number | null;
  rubricScores: { label: string; score: number; maxScore: number; comment: string }[];
  strengths: string[];
  improvements: string[];
  errorMessage: string | null;
}

const SCENARIOS = [
  { key: 'OPENER', label: 'Cold open', hint: 'Earn thirty seconds from a busy prospect.' },
  { key: 'DISCOVERY', label: 'Discovery', hint: 'Uncover needs, budget and timing with open questions.' },
  { key: 'OBJECTION', label: 'Objection', hint: 'Handle one firm reservation from the playbook.' },
  { key: 'CLOSE', label: 'Close', hint: 'Ask for the commitment and make the next step concrete.' },
];

export default function PracticeWorkspace({
  objections,
  remainingToday,
  capEnabled,
}: {
  objections: { id: string; name: string }[];
  remainingToday: number;
  capEnabled: boolean;
}) {
  const router = useRouter();
  const [scenario, setScenario] = useState('OPENER');
  const [objectionId, setObjectionId] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prospectEnded, setProspectEnded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [session?.turns.length]);

  async function api(url: string, method: string, body?: Record<string, unknown>) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail ?? data.errors?.[0]?.message ?? `Request failed (${res.status})`);
    return data;
  }

  async function start() {
    setBusy(true);
    setError('');
    setScore(null);
    setProspectEnded(false);
    try {
      const body: Record<string, unknown> = { scenario };
      if (scenario === 'OBJECTION' && objectionId) body.objectionId = objectionId;
      const data = await api('/api/v1/practice', 'POST', body);
      setSession({ ...data, turns: [] });
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function say(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!session || !input.trim()) return;
    setBusy(true);
    setError('');
    try {
      const data = await api(`/api/v1/practice/${session.id}`, 'POST', { text: input.trim() });
      setSession({ ...session, turns: data.turns });
      setProspectEnded(Boolean(data.prospectEnded));
      setInput('');
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function finish(outcome: 'COMPLETED' | 'ABANDONED') {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const data = await api(`/api/v1/practice/${session.id}`, 'PATCH', { outcome });
      if (outcome === 'ABANDONED') {
        setSession(null);
        router.refresh();
        setBusy(false);
        return;
      }
      setSession({ ...session, status: 'COMPLETED' });
      // Poll for the score; it runs on the ai queue.
      let landed = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const current = attempt === 0 ? data : await api(`/api/v1/practice/${session.id}`, 'GET');
        if (current.score && !['PENDING', 'PROCESSING'].includes(current.score.status)) {
          setScore(current.score);
          landed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      /**
       * Forty seconds without a verdict means the queue is backed up or has no
       * worker attached, not that scoring failed. Saying so beats leaving
       * "Scoring your session…" on screen forever — the session is safely
       * COMPLETED and its score appears in the history below when it lands.
       */
      if (!landed) setError('Still scoring — it will appear in your session history shortly.');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  if (!session) {
    return (
      <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
        <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
          New session
        </div>
        {error && (
          <div style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-sm)', marginBottom: 8 }}>{error}</div>
        )}
        {!capEnabled ? (
          <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            Practice is switched off for this workspace.
          </p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
              {SCENARIOS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setScenario(s.key)}
                  className="lf-card"
                  style={{
                    padding: 'var(--lf-space-3)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: scenario === s.key ? '2px solid var(--lf-wine-700)' : '1px solid var(--lf-line)',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 'var(--lf-text-sm)' }}>{s.label}</div>
                  <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>{s.hint}</div>
                </button>
              ))}
            </div>
            {scenario === 'OBJECTION' && objections.length > 0 && (
              <select
                className="lf-input"
                style={{ marginTop: 8 }}
                value={objectionId}
                onChange={(e) => setObjectionId(e.target.value)}
              >
                <option value="">Any objection…</option>
                {objections.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 'var(--lf-space-3)' }}>
              <button className="lf-btn" onClick={start} disabled={busy || remainingToday <= 0}>
                {busy ? 'Starting…' : 'Start practising'}
              </button>
              <span style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>
                {remainingToday} session{remainingToday === 1 ? '' : 's'} left today
              </span>
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--lf-space-3)' }}>
        <div className="lf-eyebrow">{session.scenario.toLowerCase()} practice</div>
        {session.status === 'IN_PROGRESS' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => finish('COMPLETED')} disabled={busy}>
              Finish &amp; score
            </button>
            <button className="lf-btn lf-btn--ghost lf-btn--sm" onClick={() => finish('ABANDONED')} disabled={busy}>
              Abandon
            </button>
          </div>
        )}
      </div>

      {error && (
        <div style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-sm)', marginBottom: 8 }}>{error}</div>
      )}

      <div
        ref={scrollRef}
        style={{
          maxHeight: 360,
          overflowY: 'auto',
          display: 'grid',
          gap: 8,
          marginBottom: 'var(--lf-space-3)',
          paddingRight: 4,
        }}
      >
        {session.turns.length === 0 && (
          <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            You speak first — it’s your call. The prospect answers in character.
          </p>
        )}
        {session.turns.map((turn, i) => (
          <div
            key={i}
            style={{
              justifySelf: turn.role === 'REP' ? 'end' : 'start',
              maxWidth: '85%',
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 'var(--lf-text-sm)',
              background: turn.role === 'REP' ? 'var(--lf-wine-700)' : 'var(--lf-surface-2, #f0f0f0)',
              color: turn.role === 'REP' ? '#fff' : 'var(--lf-ink)',
            }}
          >
            {turn.text}
          </div>
        ))}
      </div>

      {session.status === 'IN_PROGRESS' && (
        <form onSubmit={say} style={{ display: 'flex', gap: 8 }}>
          <input
            className="lf-input"
            style={{ flex: 1 }}
            placeholder={prospectEnded ? 'The prospect has wrapped up — finish for your score.' : 'Say something…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            maxLength={2000}
          />
          <button type="submit" className="lf-btn" disabled={busy || !input.trim()}>
            {busy ? '…' : 'Send'}
          </button>
        </form>
      )}

      {session.status === 'COMPLETED' && !score && (
        <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-brass)' }}>Scoring your session…</p>
      )}

      {score && (
        <div style={{ marginTop: 'var(--lf-space-3)' }}>
          {score.status === 'FAILED' ? (
            <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-vermillion)' }}>
              Scoring failed: {score.errorMessage ?? 'unknown error'}
            </p>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <span className="lf-num" style={{ fontSize: '1.6rem', fontWeight: 700 }}>
                  {score.maxScore ? Math.round(((score.overallScore ?? 0) / score.maxScore) * 100) : 0}%
                </span>
                <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
                  {score.overallScore}/{score.maxScore}
                </span>
              </div>
              {score.rubricScores.map((r, i) => (
                <div key={i} style={{ fontSize: 'var(--lf-text-sm)', padding: '4px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 500 }}>{r.label}</span>
                    <span className="lf-num">
                      {r.score}/{r.maxScore}
                    </span>
                  </div>
                  <div style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-2xs)' }}>{r.comment}</div>
                </div>
              ))}
              {score.improvements.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="lf-eyebrow" style={{ marginBottom: 4 }}>
                    Work on
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 'var(--lf-space-4)', fontSize: 'var(--lf-text-sm)' }}>
                    {score.improvements.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <button
            className="lf-btn lf-btn--secondary"
            style={{ marginTop: 'var(--lf-space-3)' }}
            onClick={() => {
              setSession(null);
              setScore(null);
            }}
          >
            Practise again
          </button>
        </div>
      )}
    </section>
  );
}
