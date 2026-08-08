'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaNeeded, setMfaNeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Recovery codes were issued at enrolment and accepted by the login endpoint,
   * but nothing here ever sent one — so losing the authenticator meant losing
   * the account, while holding ten codes that worked.
   */
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(useRecoveryCode ? recoveryCode && { recoveryCode } : mfaCode && { mfaCode }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? 'That did not work. Check your details and try again.');
        return;
      }
      // The workspace mandates 2FA and this account has not enrolled: the
      // server issued a restricted grant that reaches only the enrolment screen.
      if (data.mfaEnrolmentRequired) {
        router.push(data.destination ?? '/enroll-2fa');
        return;
      }
      if (data.mfaRequired) {
        setMfaNeeded(true);
        return;
      }
      router.push(data.destination ?? '/home');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--lf-space-4)' }} noValidate>
      {/* Errors explain what happened and what to do. They do not apologise. */}
      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}

      <div className="lf-field">
        <label className="lf-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          className="lf-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
          autoFocus
        />
        <span className="lf-hint">One account for every workspace you belong to.</span>
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="lf-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      {mfaNeeded &&
        (useRecoveryCode ? (
          <div className="lf-field">
            <label className="lf-label" htmlFor="recoveryCode">
              Recovery code
            </label>
            <input
              id="recoveryCode"
              className="lf-input lf-num"
              style={{ letterSpacing: '0.12em', fontSize: 'var(--lf-text-lg)', textAlign: 'center' }}
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
              autoComplete="one-time-code"
              autoFocus
              required
            />
            <span className="lf-hint">
              One of the codes saved when you set up two-factor authentication. Each works once.
            </span>
            <button
              type="button"
              className="lf-link-button"
              style={LINK_BUTTON}
              onClick={() => {
                setUseRecoveryCode(false);
                setError(null);
              }}
            >
              Use your authenticator app instead
            </button>
          </div>
        ) : (
          <div className="lf-field">
            <label className="lf-label" htmlFor="mfaCode">
              Authentication code
            </label>
            <input
              id="mfaCode"
              className="lf-input lf-num"
              inputMode="numeric"
              maxLength={6}
              style={{ letterSpacing: '0.35em', fontSize: 'var(--lf-text-lg)', textAlign: 'center' }}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
              required
            />
            <span className="lf-hint">Six digits from your authenticator app.</span>
            <button
              type="button"
              className="lf-link-button"
              style={LINK_BUTTON}
              onClick={() => {
                setUseRecoveryCode(true);
                setError(null);
              }}
            >
              Lost your authenticator? Use a recovery code
            </button>
          </div>
        ))}

      <button className="lf-btn lf-btn--lg" type="submit" disabled={busy} style={{ marginTop: 'var(--lf-space-2)' }}>
        {busy ? 'Signing in…' : mfaNeeded ? 'Verify and sign in' : 'Sign in'}
      </button>

      <Link href="/forgot-password" style={{ fontSize: 'var(--lf-text-sm)', textAlign: 'center' }}>
        Forgot your password?
      </Link>
    </form>
  );
}

const LINK_BUTTON: React.CSSProperties = {
  marginTop: 'var(--lf-space-2)',
  background: 'none',
  border: 0,
  padding: 0,
  color: 'var(--lf-wine-700)',
  font: 'inherit',
  fontSize: 'var(--lf-text-sm)',
  textAlign: 'left',
  textDecoration: 'underline',
  cursor: 'pointer',
};
