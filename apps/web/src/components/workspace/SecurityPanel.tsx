'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Your own password and authenticator.
 *
 * The one-time values — the enrolment secret and the recovery codes — are held
 * in component state and never re-fetched, because the server does not keep them
 * in readable form. If the page is closed before they are written down they are
 * gone, and the copy below says so rather than letting someone find out later.
 */
export default function SecurityPanel({ endpoint, status }: {
  endpoint: string;
  status: { enabled: boolean; pendingSecret: boolean; recoveryCodesRemaining: number };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [enrolment, setEnrolment] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  async function call(action: string, body: Record<string, unknown> = {}) {
    setBusy(action); setError(null); setNotice(null);
    try {
      const response = await fetch(`${endpoint}/${action}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const fields = Array.isArray(data.errors) ? data.errors.map((issue: { message: string }) => issue.message).join(' ') : '';
        setError(fields || data.detail || 'That did not work.');
        return null;
      }
      return data;
    } catch { setError('The server could not be reached.'); return null; }
    finally { setBusy(null); }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (data.newPassword !== data.confirmPassword) { setError('The two new passwords do not match.'); return; }
    const result = await call('password-change', { currentPassword: data.currentPassword, newPassword: data.newPassword });
    if (result) {
      form.reset();
      setNotice('Password changed. Every other session has been signed out.');
      router.refresh();
    }
  }

  return <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
    {error && <div className="lf-alert" role="alert">{error}</div>}
    {notice && <div role="status" style={{ color: 'var(--lf-ink-600)' }}>{notice}</div>}

    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>Password</h2>
      <p style={{ margin: '6px 0 14px', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
        Changing your password signs out every other session. The one you are using now stays open.
      </p>
      <form onSubmit={changePassword} className="lf-form-grid" style={{ maxWidth: 460 }}>
        <label className="lf-field"><span className="lf-label">Current password</span>
          <input className="lf-input" name="currentPassword" type="password" autoComplete="current-password" required /></label>
        <label className="lf-field"><span className="lf-label">New password</span>
          <input className="lf-input" name="newPassword" type="password" autoComplete="new-password" required minLength={8} /></label>
        <label className="lf-field"><span className="lf-label">Confirm new password</span>
          <input className="lf-input" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} /></label>
        <div><button className="lf-btn" type="submit" disabled={busy === 'password-change'}>{busy === 'password-change' ? 'Saving…' : 'Change password'}</button></div>
      </form>
    </section>

    <section className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 10 }}>
      <div>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>Sessions</h2>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
          If you think someone else has access to your account — a laptop left open, a lost phone — sign out everywhere.
          This signs out <em>this</em> device too, on purpose: leaving the current session alive would leave an attacker&apos;s alive as well.
        </p>
      </div>
      <div>
        <button className="lf-btn lf-btn--danger" type="button" disabled={busy === 'logout-all'} onClick={async () => {
          if (!window.confirm('Sign out of every device, including this one? You will need to sign in again.')) return;
          setBusy('logout-all'); setError(null);
          try {
            const response = await fetch('/api/v1/auth/logout-all', { method: 'POST' });
            if (!response.ok) { setError('Could not sign out everywhere.'); return; }
            window.location.href = '/login';
          } catch { setError('The server could not be reached.'); }
          finally { setBusy(null); }
        }}>{busy === 'logout-all' ? 'Signing out…' : 'Sign out of all devices'}</button>
      </div>
    </section>

    <section className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 12 }}>
      <div>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>
          Two-factor authentication <span className="lf-badge">{status.enabled ? 'on' : 'off'}</span>
        </h2>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
          A code from an authenticator app, in addition to your password. With it on, a stolen password is not enough to sign in as you.
          {status.enabled ? ` ${status.recoveryCodesRemaining} recovery code${status.recoveryCodesRemaining === 1 ? '' : 's'} remaining.` : ''}
        </p>
      </div>

      {!status.enabled && !enrolment && <div>
        <button className="lf-btn" type="button" disabled={busy === 'two-factor-begin'} onClick={async () => {
          const result = await call('two-factor-begin');
          if (result) setEnrolment({ secret: result.secret, otpauthUrl: result.otpauthUrl });
        }}>{busy === 'two-factor-begin' ? 'Starting…' : 'Set up two-factor authentication'}</button>
      </div>}

      {enrolment && !status.enabled && <div style={{ display: 'grid', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 'var(--lf-text-sm)' }}>
          Add this key to your authenticator app, then enter the six-digit code it shows. Two-factor authentication is <strong>not active</strong> until you confirm a code — so a mistyped key cannot lock you out.
        </p>
        <code style={{ display: 'block', padding: 10, background: 'var(--lf-surface-2)', borderRadius: 8, wordBreak: 'break-all', fontSize: 'var(--lf-text-sm)' }}>{enrolment.secret}</code>
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-600)' }}>Set-up URL, if your app takes one</summary>
          <code style={{ display: 'block', marginTop: 8, padding: 10, background: 'var(--lf-surface-2)', borderRadius: 8, wordBreak: 'break-all', fontSize: 'var(--lf-text-xs)' }}>{enrolment.otpauthUrl}</code>
        </details>
        <form style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }} onSubmit={async (event) => {
          event.preventDefault();
          const code = new FormData(event.currentTarget).get('code') as string;
          const result = await call('two-factor-confirm', { code });
          if (result) { setRecoveryCodes(result.recoveryCodes); setEnrolment(null); router.refresh(); }
        }}>
          <label className="lf-field" style={{ maxWidth: 160 }}><span className="lf-label">Code from your app</span>
            <input className="lf-input" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" /></label>
          <button className="lf-btn" type="submit" disabled={busy === 'two-factor-confirm'}>Confirm and turn on</button>
          <button className="lf-btn lf-btn--ghost" type="button" onClick={() => setEnrolment(null)}>Cancel</button>
        </form>
      </div>}

      {recoveryCodes && <div className="lf-alert" style={{ display: 'grid', gap: 8 }}>
        <strong>Save these recovery codes now.</strong>
        <span style={{ fontSize: 'var(--lf-text-sm)' }}>
          Each works once. They are shown only here, are not stored in readable form, and are the only way back into your account if you lose the authenticator.
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
          {recoveryCodes.map((code) => <code key={code} style={{ padding: '6px 8px', background: 'var(--lf-surface-2)', borderRadius: 6 }}>{code}</code>)}
        </div>
        <div><button className="lf-btn lf-btn--ghost" type="button" onClick={() => setRecoveryCodes(null)}>I have saved them</button></div>
      </div>}

      {status.enabled && !recoveryCodes && <div style={{ display: 'grid', gap: 10 }}>
        <form style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }} onSubmit={async (event) => {
          event.preventDefault();
          const code = new FormData(event.currentTarget).get('code') as string;
          const result = await call('two-factor-recovery-regenerate', { code });
          if (result) { setRecoveryCodes(result.recoveryCodes); router.refresh(); }
        }}>
          <label className="lf-field" style={{ maxWidth: 160 }}><span className="lf-label">Code from your app</span>
            <input className="lf-input" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required /></label>
          <button className="lf-btn lf-btn--secondary" type="submit" disabled={busy === 'two-factor-recovery-regenerate'}>Replace recovery codes</button>
        </form>

        <details>
          <summary style={{ cursor: 'pointer', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-600)' }}>Turn two-factor authentication off</summary>
          <form style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginTop: 10 }} onSubmit={async (event) => {
            event.preventDefault();
            const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
            const result = await call('two-factor-disable', { password: data.password, code: data.code });
            if (result) { setNotice('Two-factor authentication is off.'); router.refresh(); }
          }}>
            <label className="lf-field" style={{ maxWidth: 220 }}><span className="lf-label">Your password</span>
              <input className="lf-input" name="password" type="password" required autoComplete="current-password" /></label>
            <label className="lf-field" style={{ maxWidth: 160 }}><span className="lf-label">Code from your app</span>
              <input className="lf-input" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required /></label>
            <button className="lf-btn lf-btn--danger" type="submit" disabled={busy === 'two-factor-disable'}>Turn off</button>
          </form>
          <p style={{ margin: '8px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-xs)' }}>
            Both your password and a current code are needed, so a borrowed unlocked session cannot remove your second factor.
          </p>
        </details>
      </div>}
    </section>
  </div>;
}
