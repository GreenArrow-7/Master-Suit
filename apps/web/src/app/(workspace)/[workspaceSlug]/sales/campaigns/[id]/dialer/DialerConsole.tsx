'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SalesLink from '@/components/workspace/SalesLink';

interface Contact {
  id: string;
  displayName: string | null;
  phone: string;
  leadId: string | null;
  attempts: number;
  notes: string | null;
}

interface State {
  sessionId: string;
  dialed: number;
  connected: number;
  skipped: number;
  callbacks: number;
  remaining: number;
  currentCallId: string | null;
  contact: Contact | null;
}

/**
 * Dispositions, in the order an agent reaches for them.
 *
 * Connected outcomes finish the contact; the rest send it back for another
 * attempt. That distinction lives on the server — this list only decides what
 * the buttons say.
 */
const OUTCOMES = [
  ['CONNECTED', 'Spoke to them'],
  ['INTERESTED', 'Interested'],
  ['NOT_INTERESTED', 'Not interested'],
  ['QUALIFIED', 'Qualified'],
  ['NO_ANSWER', 'No answer'],
  ['BUSY', 'Busy'],
  ['VOICEMAIL', 'Voicemail'],
  ['WRONG_NUMBER', 'Wrong number'],
] as const;

/**
 * The calling console.
 *
 * Every action replaces the whole state from the server's response rather than
 * patching it locally. That is not laziness about rendering — it is the
 * acceptance criterion: the server decides who is next, and a client that
 * guessed could show an agent somebody another agent is already speaking to.
 */
export default function DialerConsole({ campaignId, initial }: { campaignId: string; initial: State | null }) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  function apply(next: {
    session: { id: string; dialed: number; connected: number; skipped: number; callbacks: number };
    contact: Contact | null;
    currentCallId: string | null;
    remaining: number;
  }) {
    setState({
      sessionId: next.session.id,
      dialed: next.session.dialed,
      connected: next.session.connected,
      skipped: next.session.skipped,
      callbacks: next.session.callbacks,
      remaining: next.remaining,
      currentCallId: next.currentCallId,
      contact: next.contact,
    });
    setNotes('');
  }

  async function send(label: string, url: string, init: RequestInit) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.errors?.[0]?.message ?? data.detail ?? 'That was refused.');
        return null;
      }
      return data;
    } catch {
      setError('The server could not be reached.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    const data = await send('start', `/api/v1/campaigns/${campaignId}/dialer`, { method: 'POST' });
    if (data) apply(data);
  }

  async function act(action: 'next' | 'skip' | 'callback', outcome?: string) {
    if (!state) return;
    const body: Record<string, unknown> = { action };
    if (outcome) body.outcome = outcome;
    if (notes.trim()) body.notes = notes.trim();

    const data = await send(outcome ?? action, `/api/v1/dialer/${state.sessionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (data) apply(data);
  }

  /**
   * Place the call.
   *
   * Three steps, in this order, because each depends on the last: create the
   * Call row, ask the vendor to dial it, then tell the session which call the
   * contact in front of the agent belongs to. Without the third the recording
   * and the disposition are recorded against a contact nobody can trace them
   * back to.
   *
   * Failure here is loud rather than silent — "no telephony provider connected"
   * is the message an operator needs, and a dialer that swallows it looks
   * broken instead of unconfigured.
   */
  async function dial() {
    if (!state?.contact) return;

    const call = await send('dial', '/api/v1/calls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipientNumber: state.contact.phone,
        campaignId,
        ...(state.contact.leadId ? { leadId: state.contact.leadId } : {}),
      }),
    });
    if (!call?.id) return;

    const dialed = await send('dial', `/api/v1/calls/${call.id}/dial`, { method: 'POST' });
    if (!dialed) return;

    const updated = await send('dial', `/api/v1/dialer/${state.sessionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'attachCall', callId: call.id }),
    });
    if (updated) setState({ ...state, currentCallId: updated.callId ?? call.id });
  }

  async function end() {
    if (!state) return;
    const data = await send('end', `/api/v1/dialer/${state.sessionId}`, { method: 'DELETE' });
    if (data) {
      setState(null);
      router.refresh();
    }
  }

  if (!state) {
    return (
      <section className="lf-card" style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ color: 'var(--lf-ink-2)', marginTop: 0 }}>
          Starting hands you the first number and holds it until you are done with it.
        </p>
        <button type="button" className="lf-btn lf-btn--lg" disabled={busy !== null} onClick={() => void start()}>
          {busy === 'start' ? 'Starting…' : 'Start dialling'}
        </button>
        {error && (
          <p className="lf-hint lf-hint--error" role="alert" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <>
      <section className="lf-metric-grid">
        <Metric label="Dialled" value={state.dialed} />
        <Metric label="Connected" value={state.connected} />
        <Metric label="Skipped" value={state.skipped} />
        <Metric label="Callbacks" value={state.callbacks} />
        <Metric label="Left in queue" value={state.remaining} />
      </section>

      <section className="lf-card" style={{ padding: 24 }}>
        {error && (
          <p className="lf-hint lf-hint--error" role="alert">
            {error}
          </p>
        )}

        {!state.contact ? (
          <div style={{ textAlign: 'center' }}>
            <h2 className="lf-h2" style={{ marginTop: 0 }}>
              Queue empty
            </h2>
            <p className="lf-hint">
              Nobody is eligible right now. Numbers dialled recently are still cooling off, and callbacks are waiting
              for their time.
            </p>
            <button
              type="button"
              className="lf-btn lf-btn--secondary"
              disabled={busy !== null}
              onClick={() => void end()}
            >
              {busy === 'end' ? 'Ending…' : 'End session'}
            </button>
          </div>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <p className="lf-eyebrow">
                Attempt {state.contact.attempts + 1}
                {state.contact.leadId ? ' · ' : ''}
                {state.contact.leadId && <SalesLink href={`/leads/${state.contact.leadId}`}>Open the lead</SalesLink>}
              </p>
              <h2 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: '4px 0' }}>
                {state.contact.displayName ?? 'Unnamed'}
              </h2>
              <p className="lf-num" style={{ fontSize: 'var(--lf-text-xl)', margin: 0 }}>
                {state.contact.phone}
              </p>
              {state.contact.notes && (
                <p className="lf-hint" style={{ marginTop: 8 }}>
                  {state.contact.notes}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <button
                type="button"
                className="lf-btn lf-btn--lg"
                disabled={busy !== null || state.currentCallId !== null}
                onClick={() => void dial()}
              >
                {busy === 'dial'
                  ? 'Dialling…'
                  : state.currentCallId
                    ? 'Call placed — pick an outcome below'
                    : `Call ${state.contact.phone}`}
              </button>
            </div>

            <div className="lf-field" style={{ maxWidth: 560, margin: '0 auto 16px' }}>
              <label className="lf-label" htmlFor="dialer-notes">
                Notes
              </label>
              <input
                id="dialer-notes"
                className="lf-input"
                value={notes}
                placeholder="What was said"
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 16 }}
              role="group"
              aria-label="Call outcome"
            >
              {OUTCOMES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="lf-btn lf-btn--secondary lf-btn--sm"
                  disabled={busy !== null}
                  onClick={() => void act('next', value)}
                >
                  {busy === value ? 'Saving…' : label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                type="button"
                className="lf-btn lf-btn--secondary lf-btn--sm"
                disabled={busy !== null}
                onClick={() => void act('callback')}
              >
                {busy === 'callback' ? 'Saving…' : 'Call back in an hour'}
              </button>
              <button
                type="button"
                className="lf-btn lf-btn--ghost lf-btn--sm"
                disabled={busy !== null}
                onClick={() => void act('skip')}
              >
                {/* Skipping costs the number nothing: an agent passing on a row
                    must not burn one of its attempts. */}
                {busy === 'skip' ? 'Skipping…' : 'Skip'}
              </button>
              <button
                type="button"
                className="lf-btn lf-btn--danger lf-btn--sm"
                disabled={busy !== null}
                onClick={() => void end()}
              >
                {busy === 'end' ? 'Ending…' : 'End session'}
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <article className="lf-metric-card">
      <div className="lf-eyebrow">{label}</div>
      <div className="lf-metric-card__value">{value}</div>
    </article>
  );
}
