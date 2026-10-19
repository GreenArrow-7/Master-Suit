'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Field from '@/components/forms/Field';
import { DateTimeInput } from '@/components/forms/DateInput';
import { sendOrQueue } from '@/lib/offline';
import { CALL_LOG_OUTCOMES, afterDial, tomorrowAtTen } from '@/lib/leads/callLog';
import { callWatch, dialAndLog, type AutoLog } from '@/lib/leads/callWatch';

export interface CallLogLead {
  id: string;
  fullName: string;
  /** Back from the dialler (M20-06): the time away as the estimate, and when the call began. */
  dial?: { minutes: number; outcome?: string; at: string };
  /** The call the phone app logged by itself (M9-09): the log corrects it rather than adding one. */
  activityId?: string;
}

/** An automatic log as the dialog's prefill: whole minutes, at least one when it connected. */
const prefill = (log: AutoLog) => ({
  minutes: log.durationSecs ? Math.max(1, Math.round(log.durationSecs / 60)) : 0,
  outcome: log.outcome,
  at: log.occurredAt,
});

/**
 * After a `tel:` link: when the page is visible again, the call log opens for
 * the lead just dialled (M4-27), with the minutes estimated from the time away
 * and, back within 8 seconds, No answer picked (M20-06). In the phone app the
 * call logs itself instead (M9-09, `lib/leads/callWatch.ts`) and a notice says
 * so, with Edit; where it cannot (the phone permission refused), as before.
 *
 * Returns `dial`, for the link's click (true when it opened the dialler itself,
 * so a button does not open it again), and the notice to render.
 */
export function useAfterDial(open: (lead: CallLogLead) => void) {
  const dialled = useRef<{ lead: CallLogLead; at: number } | null>(null);
  const [auto, setAuto] = useState<CallLogLead | null>(null);
  useEffect(() => {
    const back = () => {
      if (document.visibilityState !== 'visible' || !dialled.current) return;
      const { lead, at } = dialled.current;
      open({ ...lead, dial: { ...afterDial(at, Date.now()), at: new Date(at).toISOString() } });
      dialled.current = null;
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [open]);
  const dial = (lead: CallLogLead, tel: string, event: { preventDefault: () => void }) => {
    const who = { id: lead.id, fullName: lead.fullName };
    const note = () => {
      dialled.current = { lead: who, at: Date.now() };
    };
    const watch = callWatch();
    if (!watch) {
      note();
      return false;
    }
    // Armed before the dialler opens, so the dialler is opened here.
    event.preventDefault();
    setAuto(null);
    const openDialler = () => {
      window.location.href = `tel:${tel}`;
    };
    void dialAndLog(watch, who, openDialler).then((watched) => {
      if (watched.status === 'unarmed') {
        note();
        openDialler();
      } else if (watched.status === 'logged' && watched.activityId) {
        setAuto({ ...who, activityId: watched.activityId, dial: prefill(watched.log) });
      } else if (watched.status === 'failed') {
        open({ ...who, dial: prefill(watched.log) });
      }
    });
    return true;
  };

  const talk = auto?.dial?.outcome === 'Connected' ? auto.dial.minutes : 0;
  const notice = auto && (
    <div role="status" className="lf-toast lf-outbox">
      <div>
        Call logged automatically: {auto.dial?.outcome}
        {talk ? `, ${talk} min` : ''}.{' '}
        <button
          type="button"
          className="lf-toast__action"
          onClick={() => {
            setAuto(null);
            open(auto);
          }}
        >
          Edit
        </button>{' '}
        <button type="button" className="lf-toast__action" onClick={() => setAuto(null)}>
          Dismiss
        </button>
      </div>
    </div>
  );
  return { dial, notice };
}

/**
 * The one-step call log (PROP-02.2, M4-27): what the call found, a note, the
 * minutes, and the next follow-up — tomorrow at 10:00 on the workspace's clock
 * unless changed — sent as one POST. A native modal dialog, which brings focus,
 * Escape and the backdrop with it. Kept on the device and sent later when there
 * is no connection, as the timeline's own log is. With `callId` (a provider
 * call that just ended, M9-02) it records that call's outcome: the provider
 * timed it, so there are no minutes to type.
 */
export default function CallLogDialog({
  lead,
  callId,
  timeZone,
  onClose,
  onLogged,
}: {
  lead: CallLogLead;
  callId?: string;
  timeZone: string;
  onClose: () => void;
  onLogged: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [outcome, setOutcome] = useState(lead.dial?.outcome ?? '');
  const [notes, setNotes] = useState('');
  const [minutes, setMinutes] = useState(lead.dial ? String(lead.dial.minutes) : '');
  const [book, setBook] = useState(true);
  const [followUpAt, setFollowUpAt] = useState(() => tomorrowAtTen(timeZone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One per dialog: pressing Log call again after an error replays the call, not doubles it.
  const [requestKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    // The request key lets a late or repeated send be replayed, not doubled.
    const res = await sendOrQueue(
      `/api/v1/leads/${lead.id}/call-log`,
      'POST',
      {
        outcome,
        ...(callId && { callId }),
        ...(notes.trim() && { notes: notes.trim() }),
        ...(lead.activityId && { activityId: lead.activityId }),
        // Correcting an automatic log, minutes left as prefilled keep the measured seconds.
        ...(minutes &&
          !callId &&
          !(lead.activityId && minutes === String(lead.dial?.minutes)) && { durationMins: Number(minutes) }),
        ...(book && followUpAt && { followUpAt }),
        requestKey,
        // Back from the dialler, the call began when the dialler opened.
        occurredAt: lead.dial?.at ?? new Date().toISOString(),
      },
      `${lead.fullName}: call`,
    );
    setBusy(false);
    if (res !== 'queued' && !res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.errors?.[0]?.message ?? data.detail ?? `Request failed (${res.status})`);
      return;
    }
    onLogged();
    ref.current?.close();
  }

  return (
    <dialog ref={ref} className="lf-calllog" aria-labelledby={`${id}-title`} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
        <h2 id={`${id}-title`} className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>
          {lead.activityId ? 'Edit call' : 'Log call'} · {lead.fullName}
        </h2>
        <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <legend className="lf-label" style={{ marginBottom: 6 }}>
            What happened
          </legend>
          <div className="lf-chips">
            {CALL_LOG_OUTCOMES.map((option) => (
              <label key={option} className="lf-chip">
                <input
                  type="radio"
                  name="outcome"
                  value={option}
                  required
                  checked={outcome === option}
                  onChange={() => setOutcome(option)}
                />
                {option}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Note" htmlFor={`${id}-notes`}>
          <textarea
            id={`${id}-notes`}
            className="lf-input"
            rows={2}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {!callId && (
          <Field label="Minutes on the call" htmlFor={`${id}-minutes`}>
            <input
              id={`${id}-minutes`}
              className="lf-input"
              type="number"
              min={0}
              max={600}
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              aria-describedby={lead.dial && !lead.activityId ? `${id}-estimate` : undefined}
            />
            {lead.dial && !lead.activityId && (
              <span id={`${id}-estimate`} className="lf-hint">
                Estimated from your time in the phone app; correct it if it is off.
              </span>
            )}
          </Field>
        )}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
          <input type="checkbox" checked={book} onChange={(e) => setBook(e.target.checked)} />
          Book the next follow-up
        </label>
        {book && <DateTimeInput value={followUpAt} onChange={setFollowUpAt} aria-label="Next follow-up" required />}
        {error && (
          <div className="lf-alert" role="alert" style={{ fontSize: 'var(--lf-text-sm)' }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
          <button className="lf-btn lf-btn--sm" type="submit" disabled={busy}>
            {busy ? 'Saving…' : lead.activityId ? 'Save' : 'Log call'}
          </button>
          <button className="lf-btn lf-btn--secondary lf-btn--sm" type="button" onClick={() => ref.current?.close()}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
