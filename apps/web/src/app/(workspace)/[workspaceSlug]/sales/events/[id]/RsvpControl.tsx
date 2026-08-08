'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const OPTIONS = ['CONFIRMED', 'TENTATIVE', 'DECLINED'] as const;

/**
 * Records an RSVP taken by a caller during the event-calling flow. Once an invitee
 * is CONFIRMED the event's Google Meet link is shown next to them, so the caller can
 * read it out or send it on.
 */
export default function RsvpControl({
  eventId,
  inviteeId,
  current,
  meetingUrl,
}: {
  eventId: string;
  inviteeId: string;
  current: string;
  meetingUrl: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function record(rsvpStatus: string) {
    setBusy(true);
    setError('');
    const res = await fetch(`/api/v1/events/${eventId}/rsvp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inviteeId, rsvpStatus, channel: 'IN_APP' }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.detail ?? 'Could not record RSVP');
      return;
    }
    router.refresh();
  }

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      {OPTIONS.map((option) => (
        <button
          key={option}
          className="lf-btn lf-btn--sm lf-btn--ghost"
          disabled={busy || current === option}
          onClick={() => record(option)}
          style={{ opacity: current === option ? 0.45 : 1 }}
        >
          {option.charAt(0) + option.slice(1).toLowerCase()}
        </button>
      ))}
      {current === 'CONFIRMED' && meetingUrl && (
        <a href={meetingUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 'var(--lf-text-2xs)' }}>
          Meet link
        </a>
      )}
      {error && <span style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-vermillion)' }}>{error}</span>}
    </div>
  );
}
