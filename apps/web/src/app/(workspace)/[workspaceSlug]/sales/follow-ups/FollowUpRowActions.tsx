'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useHydrated } from '@/lib/useHydrated';
import { DateTimeInput } from '@/components/forms/DateInput';
import { sendOrQueue } from '@/lib/offline';

/**
 * Complete / reschedule a follow-up in place, against PATCH /api/v1/follow-ups/[id].
 * Without a connection the change waits on the device (lib/offline.ts) and the
 * offline notice says so; it is sent when the phone is back online.
 */
export default function FollowUpRowActions({
  id,
  status,
  title = 'Follow-up',
}: {
  id: string;
  status: string;
  /** Names the change in the offline notice. */
  title?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Until React has attached, these buttons are painted but inert; a tap would be
  // dropped silently. Treat "not hydrated yet" exactly like "already working".
  const hydrated = useHydrated();
  const blocked = busy || !hydrated;
  const [rescheduling, setRescheduling] = useState(false);
  const [dueAt, setDueAt] = useState('');

  async function patch(body: Record<string, unknown>, label: string) {
    setBusy(true);
    try {
      const res = await sendOrQueue(`/api/v1/follow-ups/${id}`, 'PATCH', body, `${title}: ${label}`);
      if (res === 'queued' || res.ok) setRescheduling(false);
      if (res !== 'queued' && res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (status === 'COMPLETED' || status === 'CANCELLED') {
    return (
      <button
        type="button"
        className="lf-btn lf-btn--secondary lf-btn--sm"
        disabled={blocked}
        onClick={() => patch({ status: 'OPEN' }, 'reopened')}
      >
        Reopen
      </button>
    );
  }

  if (rescheduling) {
    // Wraps: on a phone the date, the time and the buttons take two lines
    // rather than the table scrolling sideways.
    return (
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
        <DateTimeInput value={dueAt} onChange={setDueAt} aria-label="New due date" />
        <button
          type="button"
          className="lf-btn lf-btn--sm"
          disabled={blocked || !dueAt}
          onClick={() => patch({ dueAt: new Date(dueAt).toISOString() }, 'rescheduled')}
        >
          Save
        </button>
        <button
          type="button"
          className="lf-btn lf-btn--secondary lf-btn--sm"
          disabled={blocked}
          onClick={() => setRescheduling(false)}
        >
          Back
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', gap: 'var(--lf-space-2)', justifyContent: 'flex-end' }}>
      <button
        type="button"
        className="lf-btn lf-btn--sm"
        disabled={blocked}
        onClick={() => patch({ status: 'COMPLETED' }, 'completed')}
      >
        Complete
      </button>
      <button
        type="button"
        className="lf-btn lf-btn--secondary lf-btn--sm"
        disabled={blocked}
        onClick={() => setRescheduling(true)}
      >
        Reschedule
      </button>
      <button
        type="button"
        className="lf-btn lf-btn--secondary lf-btn--sm"
        disabled={blocked}
        onClick={() => patch({ status: 'CANCELLED' }, 'cancelled')}
      >
        Cancel
      </button>
    </span>
  );
}
