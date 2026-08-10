'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The two administrator actions the reference shows on each directory row.
 *
 * Reset password issues a temporary one the administrator reads out once — it
 * is never mailed and never stored in the clear. Face enrolment opens the
 * in-person enrolment screen, which is the only place templates are captured.
 */
export default function UserRowActions({
  endpoint,
  userId,
  employeeId,
  workspaceSlug,
}: {
  endpoint: string;
  userId: string;
  employeeId: string | null;
  workspaceSlug: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [temporary, setTemporary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resetPassword() {
    if (!window.confirm('Issue a temporary password? The current one stops working immediately.')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${endpoint}/password-reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not reset the password.');
      setTemporary(data.temporaryPassword ?? null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lf-users__actions">
      <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" disabled={busy} onClick={() => void resetPassword()}>
        Reset password
      </button>
      {employeeId && (
        <a className="lf-btn lf-btn--secondary lf-btn--sm" href={`/${workspaceSlug}/people/check-in?enrol=${employeeId}`}>
          Face enrolment
        </a>
      )}
      {temporary && (
        <span className="lf-users__temp" role="status">
          Temporary password: <code>{temporary}</code> — read it out once; it is not stored.
        </span>
      )}
      {error && (
        <span className="lf-users__temp" data-bad role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
