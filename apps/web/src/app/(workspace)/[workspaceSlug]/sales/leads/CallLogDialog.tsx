'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Field from '@/components/forms/Field';
import { DateTimeInput } from '@/components/forms/DateInput';
import { sendOrQueue } from '@/lib/offline';
import { CALL_LOG_OUTCOMES, tomorrowAtTen } from '@/lib/leads/callLog';

export interface CallLogLead {
  id: string;
  fullName: string;
}

/**
 * After a `tel:` link: when the page is visible again, the call log opens for
 * the lead just dialled (M4-27). Returns what the link calls on click.
 */
export function useAfterDial(open: (lead: CallLogLead) => void) {
  const dialled = useRef<CallLogLead | null>(null);
  useEffect(() => {
    const back = () => {
      if (document.visibilityState !== 'visible' || !dialled.current) return;
      open(dialled.current);
      dialled.current = null;
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [open]);
  return (lead: CallLogLead) => {
    dialled.current = { id: lead.id, fullName: lead.fullName };
  };
}

/**
 * The one-step call log (PROP-02.2, M4-27): what the call found, a note, the
 * minutes, and the next follow-up — tomorrow at 10:00 on the workspace's clock
 * unless changed — sent as one POST. A native modal dialog, which brings focus,
 * Escape and the backdrop with it. Kept on the device and sent later when there
 * is no connection, as the timeline's own log is.
 */
export default function CallLogDialog({
  lead,
  timeZone,
  onClose,
  onLogged,
}: {
  lead: CallLogLead;
  timeZone: string;
  onClose: () => void;
  onLogged: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [minutes, setMinutes] = useState('');
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
        ...(notes.trim() && { notes: notes.trim() }),
        ...(minutes && { durationMins: Number(minutes) }),
        ...(book && followUpAt && { followUpAt }),
        requestKey,
        occurredAt: new Date().toISOString(),
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
          Log call · {lead.fullName}
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
          />
        </Field>
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
            {busy ? 'Saving…' : 'Log call'}
          </button>
          <button className="lf-btn lf-btn--secondary lf-btn--sm" type="button" onClick={() => ref.current?.close()}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
