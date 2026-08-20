'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The two administrator actions the reference shows on each directory row.
 *
 * Reset password issues a temporary one the administrator reads out once — it
 * is never mailed and never stored in the clear, and there is no endpoint that
 * will hand it back afterwards. Face enrolment opens the supervised enrolment
 * console, which is the only place templates are captured.
 */
export default function UserRowActions({
  endpoint,
  userId,
  userName,
  employeeId,
  workspaceSlug,
  mayDelete = false,
}: {
  endpoint: string;
  userId: string;
  userName: string;
  employeeId: string | null;
  workspaceSlug: string;
  /** Whether the viewer holds `users:DELETE`. The server checks again. */
  mayDelete?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'generate' | 'set'>('generate');
  const [chosen, setChosen] = useState('');
  const [confirmed, setConfirmed] = useState('');
  const [temporary, setTemporary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [reason, setReason] = useState('');

  const mismatch = mode === 'set' && confirmed.length > 0 && chosen !== confirmed;
  const tooShort = mode === 'set' && chosen.length > 0 && chosen.length < 12;
  const ready = mode === 'generate' || (chosen.length >= 12 && chosen === confirmed);

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${endpoint}/password-reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, ...(mode === 'set' ? { temporaryPassword: chosen } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not reset the password.');
      setTemporary(data.temporaryPassword ?? null);
      setOpen(false);
      setChosen('');
      setConfirmed('');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Typing the name to confirm, rather than a yes/no dialog.
   *
   * Removing an account is not undoable from this screen, and the row that gets
   * clicked by mistake is the one next to the one that was meant. Making the
   * administrator reproduce the name means the account they remove is the
   * account they were looking at.
   */
  async function removeAccount(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const query = new URLSearchParams({ userId });
      if (reason.trim()) query.set('reason', reason.trim());
      const res = await fetch(`${endpoint}/account-delete?${query}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not remove the account.');
      setConfirmingDelete(false);
      setTypedName('');
      setReason('');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lf-users__actions">
      <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" disabled={busy} onClick={() => setOpen((was) => !was)}>
        Reset password
      </button>
      {employeeId && (
        <a className="lf-btn lf-btn--secondary lf-btn--sm" href={`/${workspaceSlug}/people/employees/${employeeId}/face`}>
          Face enrolment
        </a>
      )}
      {mayDelete && (
        <button
          type="button"
          className="lf-btn lf-btn--ghost lf-btn--sm"
          style={{ color: 'var(--lf-vermillion)' }}
          disabled={busy}
          onClick={() => setConfirmingDelete((was) => !was)}
        >
          Remove
        </button>
      )}

      {confirmingDelete && (
        <form className="lf-users__reset" onSubmit={removeAccount}>
          <strong>Remove {userName} from this workspace</strong>
          <p style={{ margin: '4px 0 0', color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
            Their sign-in ends immediately and they disappear from every list. Records they own — leads, activities,
            audit history — are kept and still name them. Their HR record, if they have one, is untouched: end
            employment through offboarding. To suspend someone temporarily, deactivate the account instead.
          </p>
          <div className="lf-field">
            <label className="lf-label" htmlFor={`confirm-name-${userId}`}>
              Type <b>{userName}</b> to confirm
            </label>
            <input
              id={`confirm-name-${userId}`}
              className="lf-input"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              autoComplete="off"
              required
            />
          </div>
          <div className="lf-field">
            <label className="lf-label" htmlFor={`remove-reason-${userId}`}>
              Reason <span style={{ color: 'var(--lf-ink-3)' }}>(optional, recorded in the audit log)</span>
            </label>
            <input
              id={`remove-reason-${userId}`}
              className="lf-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
            />
          </div>
          <div className="lf-users__actions">
            <button
              className="lf-btn lf-btn--sm"
              type="submit"
              style={{ background: 'var(--lf-vermillion)' }}
              disabled={busy || typedName.trim() !== userName}
            >
              {busy ? 'Removing…' : 'Remove account'}
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--secondary lf-btn--sm"
              onClick={() => {
                setConfirmingDelete(false);
                setTypedName('');
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {open && (
        <form className="lf-users__reset" onSubmit={resetPassword}>
          <strong>Reset the password for {userName}</strong>
          <p>
            Their current password stops working immediately and every signed-in session is revoked. They must set their
            own before anything else opens.
          </p>
          <label className="lf-users__radio">
            <input type="radio" checked={mode === 'generate'} onChange={() => setMode('generate')} />
            <span>Generate a temporary password</span>
          </label>
          <label className="lf-users__radio">
            <input type="radio" checked={mode === 'set'} onChange={() => setMode('set')} />
            <span>Set one myself</span>
          </label>

          {mode === 'set' && (
            <>
              <div className="lf-field">
                <label className="lf-label" htmlFor={`pw-${userId}`}>
                  Temporary password
                </label>
                <input
                  id={`pw-${userId}`}
                  className="lf-input"
                  type="password"
                  value={chosen}
                  onChange={(event) => setChosen(event.target.value)}
                  minLength={12}
                  required
                />
                <p className="lf-users__once">At least 12 characters.</p>
              </div>
              <div className="lf-field">
                <label className="lf-label" htmlFor={`pw2-${userId}`}>
                  Confirm
                </label>
                <input
                  id={`pw2-${userId}`}
                  className="lf-input"
                  type="password"
                  value={confirmed}
                  onChange={(event) => setConfirmed(event.target.value)}
                  required
                />
                {tooShort && <p className="lf-users__once" data-bad>Too short — 12 characters minimum.</p>}
                {mismatch && <p className="lf-users__once" data-bad>The two entries do not match.</p>}
              </div>
            </>
          )}

          <div className="lf-users__actions">
            <button className="lf-btn lf-btn--sm" type="submit" disabled={busy || !ready}>
              {busy ? 'Resetting…' : 'Reset password'}
            </button>
            <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {temporary && (
        <span className="lf-users__temp" role="status">
          Temporary password: <code>{temporary}</code> — read it out once; it is not stored and cannot be shown again.
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
