'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Action = 'set-monitoring' | 'revoke-monitoring' | 'change-admin-password';

/**
 * The signed-in owner's own two passwords.
 *
 * Each form names its target. Every change asks again for the administration
 * password and a current authenticator code — the server refuses without both,
 * so a session left open on an unattended machine cannot set or remove either
 * credential. Nothing typed here is kept after the request.
 */
export default function CredentialManager({
  hasMonitoringCredential,
  monitoringCredentialSetAt,
  eligible,
  ineligibleReason,
}: {
  hasMonitoringCredential: boolean;
  monitoringCredentialSetAt: string | null;
  eligible: boolean;
  ineligibleReason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function start(action: Action) {
    setOpen(action);
    setError(null);
    setNotice(null);
    clear();
  }

  function clear() {
    setCurrentPassword('');
    setMfaCode('');
    setNewPassword('');
    setConfirmPassword('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!open) return;
    const needsNew = open !== 'revoke-monitoring';
    if (needsNew && newPassword !== confirmPassword) {
      setError('The two new password fields do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/platform/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: open, currentPassword, mfaCode, ...(needsNew ? { newPassword } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? data.title ?? 'That did not work.');
        return;
      }
      clear();
      if (open === 'change-admin-password') {
        // Every session ends with the old administration password, this one included.
        router.push('/login');
        return;
      }
      setNotice(
        open === 'revoke-monitoring'
          ? 'Monitoring password removed. Its sessions have ended; your administration sessions are unaffected.'
          : data.replaced
            ? 'Monitoring password changed. Sessions signed in with the old one have ended.'
            : 'Monitoring password set. Sign in with it to open read-only monitoring.',
      );
      setOpen(null);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const title =
    open === 'set-monitoring'
      ? hasMonitoringCredential
        ? 'Change the monitoring password'
        : 'Set a monitoring password'
      : open === 'revoke-monitoring'
        ? 'Remove the monitoring password'
        : 'Change the administration password';

  return (
    <div className="lf-page-stack">
      {notice && (
        <div className="lf-card" role="status" style={{ padding: 'var(--lf-space-4)' }}>
          {notice}
        </div>
      )}

      <section className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 12 }}>
        <h2 className="lf-h2" style={{ margin: 0 }}>
          Monitoring password
        </h2>
        <p className="lf-muted" style={{ margin: 0 }}>
          A second password for this account. Signing in with it — and your authenticator — opens read-only monitoring
          of the workspaces you are authorised for, and nothing else: no console, no break-glass, no changes, no
          exports. It cannot be the same as your administration password.
        </p>
        <p style={{ margin: 0 }} data-testid="monitoring-credential-state">
          {hasMonitoringCredential
            ? `Set${monitoringCredentialSetAt ? ` on ${new Date(monitoringCredentialSetAt).toLocaleString('en-GB')}` : ''}.`
            : 'Not set.'}
        </p>
        {!eligible && ineligibleReason && <p className="lf-muted">{ineligibleReason}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="lf-btn" disabled={!eligible} onClick={() => start('set-monitoring')}>
            {hasMonitoringCredential ? 'Change monitoring password' : 'Set monitoring password'}
          </button>
          {hasMonitoringCredential && (
            <button type="button" className="lf-btn lf-btn--secondary" onClick={() => start('revoke-monitoring')}>
              Remove monitoring password
            </button>
          )}
        </div>
      </section>

      <section className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 12 }}>
        <h2 className="lf-h2" style={{ margin: 0 }}>
          Administration password
        </h2>
        <p className="lf-muted" style={{ margin: 0 }}>
          The password that opens the platform console. Changing it signs out every session on this account, in both
          modes.
        </p>
        <div>
          <button type="button" className="lf-btn lf-btn--secondary" onClick={() => start('change-admin-password')}>
            Change administration password
          </button>
        </div>
      </section>

      {open && (
        <form
          className="lf-card"
          onSubmit={submit}
          style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 12, maxWidth: 460 }}
          noValidate
        >
          <h2 className="lf-h2" style={{ margin: 0 }}>
            {title}
          </h2>
          <p className="lf-muted" style={{ margin: 0 }}>
            Confirm it is you: your current administration password and a code from your authenticator.
          </p>
          <div className="lf-field">
            <label className="lf-label" htmlFor="currentPassword">
              Current administration password
            </label>
            <input
              id="currentPassword"
              className="lf-input"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </div>
          <div className="lf-field">
            <label className="lf-label" htmlFor="mfaCode">
              Authentication code
            </label>
            <input
              id="mfaCode"
              className="lf-input lf-num"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
          </div>
          {open !== 'revoke-monitoring' && (
            <>
              <div className="lf-field">
                <label className="lf-label" htmlFor="newPassword">
                  {open === 'set-monitoring' ? 'New monitoring password' : 'New administration password'}
                </label>
                <input
                  id="newPassword"
                  className="lf-input"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
                <span className="lf-hint">At least 12 characters, with upper and lower case letters and a number.</span>
              </div>
              <div className="lf-field">
                <label className="lf-label" htmlFor="confirmPassword">
                  Repeat the new password
                </label>
                <input
                  id="confirmPassword"
                  className="lf-input"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </div>
            </>
          )}
          {error && (
            <div className="lf-auth-alert" role="alert">
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="lf-btn" disabled={busy}>
              {busy ? 'Working…' : open === 'revoke-monitoring' ? 'Remove it' : 'Save'}
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--secondary"
              disabled={busy}
              onClick={() => {
                clear();
                setOpen(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
