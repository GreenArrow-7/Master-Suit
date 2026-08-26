'use client';
import { useCallback, useEffect, useState } from 'react';

/**
 * Break-glass: taking and handing back write access into a customer workspace.
 *
 * The API for this has existed since platform owners stopped holding every
 * permission in every tenant permanently. The console had no button for it, so
 * an owner who needed to change something had to call the endpoint by hand — and
 * the assessment names the consequence (M-4): friction like that does not make
 * people more careful, it makes the control the thing that gets removed. This is
 * that button.
 *
 * Three things it is careful about:
 *
 *   * **It shows the clock, not just the state.** A grant self-expires, and the
 *     number that matters to the person holding it is how long is left. Ambient
 *     forever-access is what this replaced; a countdown is the visible opposite.
 *   * **It asks for the reason in the same breath as the access.** The reason is
 *     written to the customer's own audit trail. Asked afterwards it would be a
 *     formality; asked here it is the cost of the button.
 *   * **It refuses locally what the API refuses.** The minimum reason length
 *     comes from the API rather than being retyped here, so the form cannot
 *     accept something the server will reject — which is how a control teaches
 *     people it is broken.
 *
 * Only a platform OWNER ever renders this: the platform layout gates the whole
 * console on `requirePlatformOwner`, and so does every verb on the endpoint. So
 * there is no read-only variant of this component; a viewer who can see it can
 * always use it.
 */

interface Grant {
  id: string;
  reason: string;
  grantedAt: string;
  expiresAt: string;
}

interface AccessState {
  grant: Grant | null;
  defaultMinutes: number;
  maxMinutes: number;
  minReason: number;
}

/**
 * "12 minutes left", "1 minute left", "under a minute left" — never "0 minutes".
 *
 * Exported for its own tests. The countdown is the visible half of this control:
 * ambient forever-access is what break-glass replaced, so a number that says how
 * long is left is the part a person actually reads, and an off-by-one that
 * renders "0 minutes left" or a negative would undermine exactly that.
 */
export function remaining(expiresAt: string, now: number): string {
  const seconds = Math.round((Date.parse(expiresAt) - now) / 1000);
  if (seconds <= 0) return 'expired';
  if (seconds < 60) return 'under a minute left';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, '0')}m left`;
}

export default function BreakGlass({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const endpoint = `/api/v1/platform/workspaces/${workspaceId}/access`;

  const [state, setState] = useState<AccessState | null>(null);
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Ticks once a second so the countdown moves.
  //
  // Seeded during render rather than in an effect, which is safe here for a
  // reason worth stating: `state` is null until the fetch below resolves, and
  // that only happens after mount, so the server always renders the placeholder
  // branch. The countdown is never in the server's HTML, so a clock read cannot
  // be a hydration mismatch.
  const [now, setNow] = useState(() => Date.now());

  // A promise chain rather than async/await, so every setState below is
  // lexically inside a callback. `react-hooks/set-state-in-effect` rejects a
  // state update on an effect's synchronous path, and cannot tell that an async
  // function's first statement is an await — the rest of the codebase reads the
  // same way (components/nav/TopBar.tsx).
  const load = useCallback(
    () =>
      fetch(endpoint, { cache: 'no-store' })
        .then((response) =>
          response
            .json()
            .then((body) => {
              if (!response.ok) throw new Error(body.detail ?? 'Could not read the access state.');
              return body as AccessState;
            })
            .catch(() => {
              throw new Error('Could not read the access state.');
            }),
        )
        .then((data) => {
          setState(data);
          setMinutes((current) => current ?? data.defaultMinutes);
        })
        .catch((err: Error) => setError(err.message)),
    [endpoint],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // The grant ends on its own, whether or not this tab notices. Re-reading when
  // the countdown reaches zero replaces the "hand it back" button with the form
  // again, so the screen never claims access that the API has already stopped
  // honouring — enforcement is on read, server-side, in every case.
  const expired = Boolean(state?.grant) && Date.parse(state?.grant?.expiresAt ?? '') <= now;
  useEffect(() => {
    if (expired) void load();
  }, [expired, load]);

  async function send(method: 'POST' | 'DELETE') {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(endpoint, {
        method,
        ...(method === 'POST'
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason, minutes }) }
          : {}),
      });
      const data = await response.json();
      if (!response.ok) {
        // The API answers a bad reason with a field-level message that explains
        // what it is for. Show that, rather than replacing it with "failed".
        setError(data.errors?.[0]?.message ?? data.detail ?? 'The request was refused.');
        return;
      }
      if (method === 'POST') setReason('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <div className="lf-card" style={{ padding: 18 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--lf-text-lg)' }}>Write access</h2>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)' }}>{error || 'Reading the current state…'}</p>
      </div>
    );
  }

  const live = state.grant && !expired;
  const tooShort = reason.trim().length < state.minReason;

  return (
    <div className="lf-card" style={{ padding: 18, display: 'grid', gap: 12 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 'var(--lf-text-lg)' }}>Write access</h2>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
          Opening {workspaceName} to read it needs nothing — answering a customer&rsquo;s question is the ordinary case.
          Changing something in it needs a stated reason and a clock, and both are written to <strong>their</strong>{' '}
          audit trail, not ours.
        </p>
      </div>

      {live ? (
        <>
          <div className="lf-alert" role="status" style={{ display: 'grid', gap: 4 }} data-testid="break-glass-active">
            <strong>You currently have write access to this workspace.</strong>
            <span>
              {now === null ? 'Expires soon' : remaining(state.grant!.expiresAt, now)} · granted{' '}
              {new Date(state.grant!.grantedAt).toLocaleTimeString('en-AE')}
            </span>
            <span style={{ color: 'var(--lf-ink-600)' }}>Reason given: {state.grant!.reason}</span>
          </div>
          <div>
            <button className="lf-btn lf-btn--secondary" disabled={busy} onClick={() => void send('DELETE')}>
              {busy ? 'Handing it back…' : 'Hand it back now'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="lf-field">
            <label className="lf-label" htmlFor="bg-reason">
              Why do you need to change this customer&rsquo;s data?
            </label>
            <textarea
              id="bg-reason"
              className="lf-input"
              rows={2}
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ticket number and what you are going to change."
            />
            <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-600)' }}>
              At least {state.minReason} characters. This is what the customer reads on their audit trail.
            </span>
          </div>

          <div className="lf-field">
            <label className="lf-label" htmlFor="bg-minutes">
              For how long?
            </label>
            <select
              id="bg-minutes"
              className="lf-input"
              value={minutes ?? state.defaultMinutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            >
              {[15, 30, 60, 120, 240]
                .filter((option) => option <= state.maxMinutes)
                .map((option) => (
                  <option key={option} value={option}>
                    {option < 60 ? `${option} minutes` : `${option / 60} hour${option === 60 ? '' : 's'}`}
                    {option === state.defaultMinutes ? ' (default)' : ''}
                  </option>
                ))}
            </select>
            <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-600)' }}>
              It ends by itself. Asking again is cheap; a grant nobody closes is not.
            </span>
          </div>

          <div>
            <button className="lf-btn lf-btn--danger" disabled={busy || tooShort} onClick={() => void send('POST')}>
              {busy ? 'Opening…' : 'Take write access'}
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="lf-alert" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
