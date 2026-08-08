'use client';

import { useState } from 'react';

const CHOICES = [
  ['CONFIRMED', "I'll be there"],
  ['TENTATIVE', 'Maybe'],
  ['DECLINED', "Can't make it"],
] as const;

/**
 * Three buttons and a link. Deliberately not a form with fields.
 *
 * The invitee is on a phone, in WhatsApp, with one thing to decide. Anything
 * that asks them to type is a reason not to answer at all, and an unanswered
 * invitation is indistinguishable from a declined one in the reporting the
 * organiser actually reads.
 */
export default function RsvpForm({
  token,
  name,
  initialStatus,
  answerable,
  eventStatus,
  meetingUrl,
}: {
  token: string;
  name: string | null;
  initialStatus: string;
  answerable: boolean;
  eventStatus: string;
  meetingUrl: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [link, setLink] = useState(meetingUrl);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(rsvpStatus: string) {
    setBusy(rsvpStatus);
    setError(null);
    try {
      const res = await fetch('/api/v1/public/rsvp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, rsvpStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? 'That could not be saved. Try again shortly.');
        return;
      }
      setStatus(data.rsvpStatus);
      setLink(data.event?.meetingUrl ?? null);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  if (!answerable) {
    return (
      <p className="lf-alert" role="status" style={{ marginTop: 24 }}>
        {eventStatus === 'CANCELLED'
          ? 'This event has been cancelled.'
          : eventStatus === 'COMPLETED'
            ? 'This event has already taken place.'
            : 'This invitation is not open for replies.'}
      </p>
    );
  }

  return (
    <div style={{ marginTop: 24 }}>
      <p style={{ margin: '0 0 10px', fontWeight: 500 }}>{name ? `${name}, will you join?` : 'Will you join?'}</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Your reply">
        {CHOICES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`lf-btn ${status === value ? '' : 'lf-btn--secondary'}`}
            aria-pressed={status === value}
            disabled={busy !== null}
            onClick={() => void answer(value)}
          >
            {busy === value ? 'Saving…' : label}
          </button>
        ))}
      </div>

      {status !== 'PENDING' && !error && (
        <p className="lf-hint" role="status" style={{ marginTop: 12 }}>
          {status === 'CONFIRMED'
            ? 'Thank you — we have you down as attending.'
            : status === 'TENTATIVE'
              ? 'Noted as a maybe. You can change this any time from this link.'
              : 'Thank you for letting us know.'}
        </p>
      )}

      {link && (
        <p style={{ marginTop: 16 }}>
          <a className="lf-btn lf-btn--lg" href={link} rel="noreferrer noopener" target="_blank">
            Join the meeting
          </a>
        </p>
      )}

      {error && (
        <p className="lf-hint lf-hint--error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
    </div>
  );
}
