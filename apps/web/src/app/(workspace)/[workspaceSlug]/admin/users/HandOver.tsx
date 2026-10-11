'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Field from '@/components/forms/Field';
import { authFetch } from '@/lib/auth/client';

interface OpenWork {
  leads: number;
  followUps: number;
  tasks: number;
  /** Whether this caller's leads:ASSIGN scope reaches the account; the server refuses otherwise. */
  mayHandOver: boolean;
  members: { id: string; fullName: string }[];
}

/** Where the departing account's open work goes, or null until that is decided. */
export type HandOverChoice = { handOverTo?: string; leadsToQueue?: boolean } | null;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The message a refusal carries: the field's own line on a 422, else `detail`. */
export async function problemText(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  const field = Array.isArray(data.errors) ? data.errors[0]?.message : undefined;
  return typeof field === 'string' ? field : typeof data.detail === 'string' ? data.detail : fallback;
}

/**
 * The step Deactivate and Remove both open before they act: the account's open
 * leads, follow-ups and tasks, and where they go — a member, or the allocation
 * queue for the leads. The server refuses without it; this is the screen's half
 * of that rule. `onChange` gets null until the choice is complete.
 */
export function HandOverStep({
  endpoint,
  userId,
  onChange,
}: {
  endpoint: string;
  userId: string;
  onChange: (choice: HandOverChoice) => void;
}) {
  const [work, setWork] = useState<OpenWork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [queue, setQueue] = useState(false);

  useEffect(() => {
    let live = true;
    authFetch(`${endpoint}/account-work?userId=${encodeURIComponent(userId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await problemText(res, 'Could not read their open work.'));
        const data = (await res.json()) as OpenWork;
        if (live) setWork(data);
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [endpoint, userId]);

  const others = work ? work.followUps + work.tasks : 0;
  const toQueue = queue && (work?.leads ?? 0) > 0;
  const needsMember = !!work && ((work.leads > 0 && !toQueue) || others > 0);
  const blocked = !!work && work.leads + others > 0 && !work.mayHandOver;

  useEffect(() => {
    if (!work || blocked || (needsMember && !to)) return onChange(null);
    onChange({ ...(to ? { handOverTo: to } : {}), ...(toQueue ? { leadsToQueue: true } : {}) });
  }, [work, blocked, to, toQueue, needsMember, onChange]);

  if (error) {
    return (
      <p className="lf-users__once" data-bad role="alert">
        {error}
      </p>
    );
  }
  if (!work) return <p>Checking their open work…</p>;
  if (work.leads + others === 0) return <p>They own no open leads, follow-ups or tasks.</p>;

  const counts = [
    work.leads && plural(work.leads, 'open lead'),
    work.followUps && plural(work.followUps, 'follow-up'),
    work.tasks && plural(work.tasks, 'task'),
  ].filter(Boolean) as string[];
  const listed = counts.length > 1 ? `${counts.slice(0, -1).join(', ')} and ${counts.at(-1)}` : counts[0];

  // Said before submit: the server would refuse with 403 after it.
  if (blocked) {
    return (
      <p className="lf-users__once" data-bad role="alert">
        They own {listed}, and your role cannot assign their work. Ask someone who can assign their leads to hand it
        over first.
      </p>
    );
  }

  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
      <legend style={{ fontWeight: 600, padding: 0 }}>Hand {listed} to</legend>
      {needsMember && (
        <Field label={toQueue ? 'Follow-ups and tasks go to' : 'Member'} htmlFor={`hand-to-${userId}`} required>
          <select
            id={`hand-to-${userId}`}
            className="lf-input"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            required
          >
            <option value="">Choose an active member</option>
            {work.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.fullName}
              </option>
            ))}
          </select>
        </Field>
      )}
      {work.leads > 0 && (
        <label className="lf-users__radio">
          <input type="checkbox" checked={queue} onChange={(event) => setQueue(event.target.checked)} />
          <span>or send the leads to the allocation queue</span>
        </label>
      )}
    </fieldset>
  );
}

/** The deactivate form: the hand-over step, an optional reason, and the action. */
export function DeactivateForm({
  endpoint,
  userId,
  userName,
  onClose,
}: {
  endpoint: string;
  userId: string;
  userName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<HandOverChoice>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deactivate(event: React.FormEvent) {
    event.preventDefault();
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`${endpoint}/account-active`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, active: false, ...(reason.trim() ? { reason: reason.trim() } : {}), ...choice }),
      });
      if (!res.ok) throw new Error(await problemText(res, 'Could not deactivate the account.'));
      onClose();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="lf-users__reset" onSubmit={deactivate}>
      <strong>Deactivate {userName}</strong>
      <p>
        Their sign-in ends immediately; restoring the account brings it back. Their open work goes where you choose, so
        nothing waits on an account that cannot sign in.
      </p>
      <HandOverStep endpoint={endpoint} userId={userId} onChange={setChoice} />
      <Field
        label={
          <>
            Reason <span style={{ color: 'var(--lf-ink-3)' }}>(optional, recorded in the audit log)</span>
          </>
        }
        htmlFor={`deactivate-reason-${userId}`}
      >
        <input
          id={`deactivate-reason-${userId}`}
          className="lf-input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={300}
        />
      </Field>
      <div className="lf-users__actions">
        <button
          className="lf-btn lf-btn--sm"
          type="submit"
          style={{ background: 'var(--lf-vermillion)' }}
          disabled={busy || !choice}
        >
          {busy ? 'Deactivating…' : 'Deactivate account'}
        </button>
        <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && (
        <span className="lf-users__temp" data-bad role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

/** A Deactivate button that opens the form, for the account page. */
export default function DeactivateAccount(props: { endpoint: string; userId: string; userName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ display: 'inline-grid', gap: 4 }}>
      <button type="button" className="lf-btn lf-btn--danger" onClick={() => setOpen((was) => !was)}>
        Deactivate
      </button>
      {open && <DeactivateForm {...props} onClose={() => setOpen(false)} />}
    </span>
  );
}
