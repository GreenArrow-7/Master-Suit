'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useModuleBase } from '@/components/workspace/SalesLink';
import Badge from '@/components/ui/Badge';
import type { LeadCallContext } from '@/services/leads/callContext';

interface Segment {
  speaker: string;
  text: string;
  at: number;
}

interface Hint {
  kind: string;
  text: string;
  say?: string;
  why?: string;
  source: string;
  at: number;
}

const QUICK_ACTIONS: [action: string, label: string][] = [
  ['ASK_NEXT', 'Ask next'],
  ['HANDLE_OBJECTION', 'Handle objection'],
  ['RECOMMEND_PROPERTY', 'Recommend property'],
  ['PAYMENT_PLAN', 'Payment plan'],
  ['CLOSING_LINE', 'Closing line'],
  ['SUMMARIZE', 'Summarize customer'],
  ['TRANSLATE', 'Translate'],
];

const HINT_TONE: Record<string, 'brass' | 'vermillion' | 'viridian' | 'slate' | 'wine'> = {
  TIP: 'viridian',
  OBJECTION: 'vermillion',
  SENTIMENT: 'brass',
  ACTION: 'wine',
  COMPLIANCE: 'slate',
  ASK: 'wine',
  BUYING_SIGNAL: 'viridian',
};

const HINT_LABEL: Record<string, string> = {
  ASK: 'ask next',
  BUYING_SIGNAL: '🔥 buying signal',
};

const fmtMoney = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M` : `${n}`);

/**
 * The during-call assistance surface: streaming transcript on the left, the AI
 * coach on the right, controls and notes below. Fed by the SSE session at
 * /api/v1/calls/[id]/live — today a clearly-labelled simulation, the same feed
 * a telephony vendor's streaming transcription would drive.
 */
export default function LiveCallWorkspace({
  call,
  context,
  hasGemini,
  transport = 'demo',
}: {
  call: {
    id: string;
    status: string;
    direction: string;
    recipientNumber: string | null;
    notes: string | null;
    agentName: string;
  };
  context: LeadCallContext | null;
  hasGemini: boolean;
  transport?: 'demo' | 'vendor';
}) {
  const lead = context?.lead ?? null;
  const router = useRouter();
  const base = useModuleBase();
  const [phase, setPhase] = useState<'idle' | 'live' | 'wrapping' | 'done'>('idle');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [hints, setHints] = useState<Hint[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [notes, setNotes] = useState(call.notes ?? '');
  const [notesSaved, setNotesSaved] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [mode, setMode] = useState<'sim' | 'mic'>('sim');
  const [micError, setMicError] = useState('');
  const micRef = useRef<{ stream: MediaStream; stopped: boolean; chunk: number } | null>(null);
  /** Per-listing viewing request: the picked time, and where the request got to. */
  const [visitTimes, setVisitTimes] = useState<Record<string, string>>({});
  const [visitStatus, setVisitStatus] = useState<Record<string, 'busy' | 'done' | string>>({});
  const sourceRef = useRef<EventSource | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // The timer runs while live; the stream's `at` field keeps it honest.
  useEffect(() => {
    if (phase !== 'live') return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [segments]);

  useEffect(
    () => () => {
      sourceRef.current?.close();
      if (micRef.current) {
        micRef.current.stopped = true;
        micRef.current.stream.getTracks().forEach((t) => t.stop());
      }
    },
    [],
  );

  function start() {
    setPhase('live');
    const source = new EventSource(`/api/v1/calls/${call.id}/live`);
    sourceRef.current = source;
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'segment') {
        setSegments((prev) => [...prev, data]);
        setSeconds(data.at);
      } else if (data.type === 'coach') {
        setHints((prev) => [...prev, data]);
      } else if (data.type === 'stage') {
        setStage(data.stage);
      } else if (data.type === 'error') {
        setMicError(data.message);
      } else if (data.type === 'status' && data.status === 'WRAPPING_UP') {
        setPhase('wrapping');
      } else if (data.type === 'done') {
        source.close();
        setPhase('done');
      }
    };
    source.onerror = () => {
      // The stream closed (call ended server-side or connection lost).
      source.close();
      setPhase((p) => (p === 'live' ? 'done' : p));
    };
  }

  function endCall() {
    if (mode === 'mic' && micRef.current) {
      micRef.current.stopped = true;
      micRef.current.stream.getTracks().forEach((t) => t.stop());
      void fetch(`/api/v1/calls/${call.id}/live-audio?final=true`, { method: 'POST' });
    }
    sourceRef.current?.close();
    setPhase('done');
  }

  /**
   * The real-call transport: the browser microphone next to the phone call,
   * recorded in standalone ~5s chunks (a fresh MediaRecorder per chunk — later
   * slices of one recorder are headerless and untranscribable). Each chunk
   * comes back with its transcript, hints and stage. Consent is affirmed and
   * recorded before the first byte, and the server refuses audio without it.
   */
  async function micStart() {
    setMicError('');
    const affirmed = window.confirm(
      'Confirm you have told the customer this call is recorded and they have consented. This is recorded against the call.',
    );
    if (!affirmed) return;
    try {
      const consent = await fetch(`/api/v1/calls/${call.id}/consent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consentGiven: true, method: 'VERBAL' }),
      });
      // 409 means consent is already on record — exactly as good.
      if (!consent.ok && consent.status !== 409) throw new Error('Could not record consent.');

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = { stream, stopped: false, chunk: 0 };
      setMode('mic');
      setPhase('live');
      void micLoop();
    } catch (e) {
      setMicError((e as Error).message || 'Microphone access was refused.');
    }
  }

  async function micLoop() {
    const mic = micRef.current;
    if (!mic) return;
    while (!mic.stopped) {
      const recorder = new MediaRecorder(mic.stream, { mimeType: 'audio/webm' });
      const parts: Blob[] = [];
      const done = new Promise<Blob>((resolve) => {
        recorder.ondataavailable = (e) => parts.push(e.data);
        recorder.onstop = () => resolve(new Blob(parts, { type: 'audio/webm' }));
      });
      recorder.start();
      await new Promise((r) => setTimeout(r, 5000));
      if (recorder.state !== 'inactive') recorder.stop();
      const blob = await done;
      if (mic.stopped) break;
      mic.chunk += 1;
      // Fire and forget so the next chunk starts recording immediately; a model
      // tick every 4th chunk, heuristics on all of them. Chunks are ~5s, so the
      // counter doubles as the timestamp.
      void micUpload(blob, mic.chunk % 4 === 0, mic.chunk * 5);
    }
  }

  /**
   * The spec's "book a viewing" made concrete: one click files a SiteVisit
   * request through the existing register (status REQUESTED — the approval
   * state machine is the point, not a bypass of it).
   */
  async function requestViewing(listingId: string) {
    const when = visitTimes[listingId];
    if (!when || !context?.lead) return;
    setVisitStatus((s) => ({ ...s, [listingId]: 'busy' }));
    try {
      const res = await fetch('/api/v1/site-visits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          leadId: context.lead.id,
          listingId,
          scheduledAt: new Date(when).toISOString(),
          notes: 'Requested from the live call workspace.',
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.errors?.[0]?.message ?? data?.detail ?? `Request failed (${res.status})`);
      setVisitStatus((s) => ({ ...s, [listingId]: 'done' }));
    } catch (e) {
      setVisitStatus((s) => ({ ...s, [listingId]: (e as Error).message }));
    }
  }

  async function micUpload(blob: Blob, tick: boolean, at: number) {
    try {
      const res = await fetch(`/api/v1/calls/${call.id}/live-audio?tick=${tick}`, {
        method: 'POST',
        headers: { 'content-type': blob.type || 'audio/webm' },
        body: blob,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setMicError(data?.errors?.[0]?.message ?? data?.detail ?? `Chunk failed (${res.status})`);
        return;
      }
      const data = await res.json();
      if (data.text) setSegments((prev) => [...prev, { speaker: 'Live', text: data.text, at }]);
      if (data.hints?.length) setHints((prev) => [...prev, ...data.hints.map((h: Hint) => ({ ...h, at }))]);
      if (data.stage) setStage(data.stage);
    } catch {
      /* one lost chunk must not stop the call */
    }
  }

  async function quickAction(action: string) {
    setPendingAction(action);
    try {
      const res = await fetch(`/api/v1/calls/${call.id}/coach`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          window: segments
            .slice(-8)
            .map((s) => `${s.speaker}: ${s.text}`)
            .join('\n'),
        }),
      });
      if (res.ok) {
        const { hint } = await res.json();
        setHints((prev) => [...prev, { ...hint, at: seconds }]);
      }
    } finally {
      setPendingAction(null);
    }
  }

  async function saveNotes() {
    const res = await fetch(`/api/v1/calls/${call.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    if (res.ok) {
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    }
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
      <div className="lf-alert" role="note">
        {transport === 'vendor'
          ? 'Live call — audio streams server-side from the telephony provider; this screen only displays coaching.'
          : 'Demo simulation — no real phone call is placed. Connect a telephony provider under Administration → Integrations for live calls; the coaching feed works the same way.'}
        {hasGemini
          ? ' Live hints are generated by Gemini.'
          : ' AI hints are heuristic until an AI provider is connected.'}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--lf-space-4)',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className="lf-h1" style={{ marginBottom: 2 }}>
            {lead ? lead.fullName : (call.recipientNumber ?? 'Live call')}
          </h1>
          <p style={{ margin: 0, fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            {call.direction === 'INBOUND' ? 'Incoming' : 'Outgoing'}
            {lead?.company ? ` · ${lead.company}` : ''}
            {lead?.stageName ? ` · ${lead.stageName}` : ''}
            {lead ? ` · Score ${lead.score}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-3)', marginLeft: 'auto' }}>
          <span
            className="lf-num"
            style={{ fontSize: 'var(--lf-text-xl)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
            aria-label="Call timer"
          >
            {mm}:{ss}
          </span>
          {stage && phase === 'live' && (
            <Badge tone="wine">{stage.toLowerCase().replace(/_/g, ' ')}</Badge>
          )}
          <Badge tone={phase === 'live' ? 'viridian' : phase === 'done' ? 'slate' : 'brass'}>
            {phase === 'idle' ? 'ready' : phase === 'wrapping' ? 'wrapping up' : phase}
          </Badge>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
        {phase === 'idle' &&
          (transport === 'vendor' ? (
            <button className="lf-btn" onClick={start}>
              Connect to live call
            </button>
          ) : (
            <>
              <button className="lf-btn" onClick={start}>
                Start simulated call
              </button>
              <button className="lf-btn lf-btn--secondary" onClick={micStart} title="Coach the phone call you are on, via this device's microphone">
                Coach a real call (microphone)
              </button>
            </>
          ))}
        {micError && (
          <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-vermillion)', alignSelf: 'center' }}>
            {micError}
          </span>
        )}
        {phase === 'live' && (
          <>
            <button
              className="lf-btn lf-btn--secondary"
              aria-pressed={muted}
              onClick={() => setMuted((m) => !m)}
              title="Simulated control"
            >
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button className="lf-btn lf-btn--danger" onClick={endCall}>
              {transport === 'vendor' ? 'Stop watching' : 'End call'}
            </button>
          </>
        )}
        {phase === 'done' && (
          <button className="lf-btn" onClick={() => router.push(`${base}/calls/${call.id}`)}>
            View call record &amp; audit
          </button>
        )}
      </div>

      <div
        className="lf-live-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: context
            ? 'minmax(0, 0.9fr) minmax(0, 1.4fr) minmax(0, 1fr)'
            : 'minmax(0, 1.6fr) minmax(0, 1fr)',
          gap: 'var(--lf-space-4)',
        }}
      >
        {context && (
          <section
            className="lf-card"
            style={{ padding: 'var(--lf-space-4)', maxHeight: 480, overflowY: 'auto', fontSize: 'var(--lf-text-sm)' }}
          >
            <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
              Customer context
            </div>
            <div style={{ display: 'grid', gap: 4, color: 'var(--lf-ink-2)' }}>
              <span>
                <strong>{context.lead.fullName}</strong>
                {context.lead.company ? ` · ${context.lead.company}` : ''}
              </span>
              {context.lead.phone && <span>{context.lead.phone}</span>}
              <span style={{ color: 'var(--lf-ink-3)' }}>
                {context.lead.source.toLowerCase()}
                {context.lead.city ? ` · ${context.lead.city}` : ''}
                {context.lead.stageName ? ` · ${context.lead.stageName}` : ''} · score {context.lead.score}
              </span>
              {context.playbook && (
                <span style={{ color: 'var(--lf-ink-3)' }}>
                  Playbook: <strong>{context.playbook.name}</strong>
                </span>
              )}
            </div>

            <div className="lf-eyebrow" style={{ margin: 'var(--lf-space-3) 0 4px' }}>
              Requirement
            </div>
            {context.requirement ? (
              <div style={{ color: 'var(--lf-ink-2)' }}>
                {context.requirement.purpose}
                {context.requirement.budgetMin != null || context.requirement.budgetMax != null
                  ? ` · ${context.requirement.budgetMin != null ? fmtMoney(context.requirement.budgetMin) : '?'}–${
                      context.requirement.budgetMax != null ? fmtMoney(context.requirement.budgetMax) : '?'
                    } ${context.requirement.currency}`
                  : ''}
                {context.requirement.bedroomsMin != null || context.requirement.bedroomsMax != null
                  ? ` · ${context.requirement.bedroomsMin ?? '?'}–${context.requirement.bedroomsMax ?? '?'} BR`
                  : ''}
                {context.requirement.propertyTypes.length
                  ? ` · ${context.requirement.propertyTypes.join(', ').toLowerCase()}`
                  : ''}
              </div>
            ) : (
              <p style={{ margin: 0, color: 'var(--lf-ink-3)' }}>
                Nothing on record — discovery is the goal of this call.
              </p>
            )}

            {context.lastCall?.summary && (
              <>
                <div className="lf-eyebrow" style={{ margin: 'var(--lf-space-3) 0 4px' }}>
                  Last call
                </div>
                <p style={{ margin: 0, color: 'var(--lf-ink-2)' }}>
                  {context.lastCall.summary.length > 280
                    ? `${context.lastCall.summary.slice(0, 277)}…`
                    : context.lastCall.summary}
                </p>
                {context.lastCall.objections.length > 0 && (
                  <p style={{ margin: '4px 0 0', color: 'var(--lf-ink-3)' }}>
                    Past objections: {context.lastCall.objections.slice(0, 3).join('; ')}
                  </p>
                )}
              </>
            )}

            {context.matches.length > 0 && (
              <>
                <div className="lf-eyebrow" style={{ margin: 'var(--lf-space-3) 0 4px' }}>
                  Recommended properties
                </div>
                {context.matches.map((m) => (
                  <div key={m.id} style={{ marginBottom: 'var(--lf-space-2)' }}>
                    <div style={{ fontWeight: 600 }}>
                      {m.title}
                      <span style={{ fontWeight: 400, color: 'var(--lf-ink-3)' }}>
                        {' '}
                        · {m.bedrooms != null ? `${m.bedrooms}BR · ` : ''}
                        {fmtMoney(m.price)} {m.currency}
                        {m.micromarket ? ` · ${m.micromarket}` : ''}
                      </span>
                    </div>
                    {m.whyMatch.length > 0 && (
                      <ul style={{ margin: '2px 0 0', paddingLeft: 'var(--lf-space-4)', color: 'var(--lf-ink-3)' }}>
                        {m.whyMatch.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    )}
                    {visitStatus[m.id] === 'done' ? (
                      <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-viridian, #16a34a)' }}>
                        Viewing requested — pending approval.
                      </span>
                    ) : (
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                        <input
                          type="datetime-local"
                          className="lf-input"
                          style={{ padding: '2px 6px', fontSize: 'var(--lf-text-xs)', width: 170 }}
                          value={visitTimes[m.id] ?? ''}
                          onChange={(e) => setVisitTimes((t) => ({ ...t, [m.id]: e.target.value }))}
                          aria-label={`Viewing time for ${m.title}`}
                        />
                        <button
                          type="button"
                          className="lf-btn lf-btn--sm lf-btn--secondary"
                          disabled={!visitTimes[m.id] || visitStatus[m.id] === 'busy'}
                          onClick={() => requestViewing(m.id)}
                        >
                          {visitStatus[m.id] === 'busy' ? '…' : 'Request viewing'}
                        </button>
                        {visitStatus[m.id] && !['busy', 'done'].includes(visitStatus[m.id]) && (
                          <span style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-vermillion)' }}>
                            {visitStatus[m.id]}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                ))}
                <p className="lf-hint" style={{ margin: 0 }}>
                  Drawn from live inventory matching the recorded requirement.
                </p>
              </>
            )}
          </section>
        )}

        <section className="lf-card" style={{ padding: 'var(--lf-space-4)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
            Live transcript
          </div>
          <div
            ref={transcriptRef}
            style={{ maxHeight: 420, overflowY: 'auto', display: 'grid', gap: 'var(--lf-space-2)' }}
            aria-live="polite"
          >
            {segments.length === 0 ? (
              <p style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
                {phase === 'idle' ? 'Start the call to see the live transcript.' : 'Listening…'}
              </p>
            ) : (
              segments.map((segment, i) => (
                <div key={i} style={{ display: 'flex', gap: 'var(--lf-space-2)', fontSize: 'var(--lf-text-sm)' }}>
                  <span
                    style={{
                      flexShrink: 0,
                      width: 74,
                      fontWeight: 600,
                      color: segment.speaker === 'Agent' ? 'var(--lf-wine-700, #7f1d4e)' : 'var(--lf-ink-2)',
                    }}
                  >
                    {segment.speaker}
                  </span>
                  <span>{segment.text}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="lf-card" style={{ padding: 'var(--lf-space-4)' }}>
          <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
            AI coach
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto', display: 'grid', gap: 'var(--lf-space-3)' }}>
            {hints.length === 0 ? (
              <p style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
                Hints appear here as the conversation develops.
              </p>
            ) : (
              hints.map((hint, i) => (
                <div key={i} style={{ display: 'grid', gap: 4 }}>
                  <span style={{ display: 'flex', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
                    <Badge tone={HINT_TONE[hint.kind] ?? 'slate'}>{HINT_LABEL[hint.kind] ?? hint.kind.toLowerCase()}</Badge>
                    <span style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-4)' }}>
                      {hint.source === 'gemini' ? 'Gemini' : 'heuristic'} · {Math.floor(hint.at / 60)}:
                      {String(hint.at % 60).padStart(2, '0')}
                    </span>
                  </span>
                  <span style={{ fontSize: 'var(--lf-text-sm)' }}>{hint.text}</span>
                  {hint.say && (
                    <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-wine-700, #7f1d4e)' }}>
                      Say: {hint.say}
                    </span>
                  )}
                  {hint.why && (
                    <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>Why: {hint.why}</span>
                  )}
                </div>
              ))
            )}
          </div>
          {phase !== 'idle' && (
            <div
              style={{
                display: 'flex',
                gap: 'var(--lf-space-2)',
                flexWrap: 'wrap',
                marginTop: 'var(--lf-space-3)',
                borderTop: '1px solid var(--lf-line)',
                paddingTop: 'var(--lf-space-3)',
              }}
            >
              {QUICK_ACTIONS.map(([action, label]) => (
                <button
                  key={action}
                  type="button"
                  className="lf-btn lf-btn--sm lf-btn--secondary"
                  disabled={pendingAction !== null}
                  onClick={() => quickAction(action)}
                >
                  {pendingAction === action ? '…' : label}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="lf-card" style={{ padding: 'var(--lf-space-4)', display: 'grid', gap: 'var(--lf-space-2)' }}>
        <label className="lf-label" htmlFor="live-notes">
          Notes
        </label>
        <textarea
          id="live-notes"
          className="lf-input"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Jot down commitments, numbers, follow-ups…"
        />
        <div style={{ display: 'flex', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
          <button type="button" className="lf-btn lf-btn--sm" onClick={saveNotes}>
            Save notes
          </button>
          {notesSaved && (
            <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-viridian, #16a34a)' }}>Saved</span>
          )}
        </div>
      </section>
    </div>
  );
}
