'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Two visual steps over one endpoint: credentials, then — only when the server
 * says so — the second factor, with the credentials collapsed to a summary and
 * kept in hidden inputs. Every state the endpoint can answer with has a screen:
 * signed in, MFA required, enrolment required, throttled, refused.
 */
export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaNeeded, setMfaNeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const submitting = useRef(false);

  async function submit(e?: React.FormEvent, codeOverride?: string) {
    e?.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    // React state lags one keystroke behind the change handler; the auto-submit
    // on the sixth digit passes the full code explicitly.
    const code = codeOverride ?? mfaCode;
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(useRecoveryCode ? recoveryCode && { recoveryCode } : code && { mfaCode: code }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.detail ??
            (mfaNeeded
              ? 'That code did not match. Check your authenticator and try again.'
              : "We couldn't sign you in. Check your email and password."),
        );
        return;
      }
      /**
       * A platform service identity signing in at the human door.
       *
       * The server refuses to mint a session for one here — that session would
       * be revoked on its first request — and answers with where to go instead.
       * Carrying the username across is not possible: this form collected an
       * email, and the service page signs in by username.
       */
      if (data.serviceIdentity) {
        router.push(data.destination ?? '/service-login');
        return;
      }
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
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  /** Auto-submit the moment the sixth digit lands; typing stays interruptible. */
  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setMfaCode(digits);
    if (digits.length === 6 && !submitting.current) void submit(undefined, digits);
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--lf-space-4)' }} noValidate>
      <div>
        <h1 className="lf-auth-title">{mfaNeeded ? 'Verify it’s you' : 'Welcome back'}</h1>
        <p className="lf-auth-lede">
          {mfaNeeded
            ? useRecoveryCode
              ? 'Enter one of your saved recovery codes.'
              : 'Enter the 6-digit code from your authenticator app.'
            : 'Sign in to your workspace.'}
        </p>
      </div>

      {error && (
        <div className="lf-auth-alert" role="alert">
          {error}
        </div>
      )}

      {!mfaNeeded ? (
        <>
          <div className="lf-field">
            <label className="lf-label" data-required htmlFor="email">
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
          </div>

          <div className="lf-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <label className="lf-label" data-required htmlFor="password">
                Password
              </label>
              <Link href="/forgot-password" style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-wine-700)' }}>
                Forgot password?
              </Link>
            </div>
            <div className="lf-auth-pwwrap">
              <input
                id="password"
                className="lf-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="lf-auth-eye"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
              >
                <EyeIcon off={showPassword} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Credentials stay in the request; on screen they collapse to this. */}
          <div className="lf-auth-summary">
            <span>{email}</span>
            <button
              type="button"
              onClick={() => {
                setMfaNeeded(false);
                setMfaCode('');
                setRecoveryCode('');
                setError(null);
              }}
            >
              Change
            </button>
          </div>

          {useRecoveryCode ? (
            <div className="lf-field">
              <label className="lf-label" htmlFor="recoveryCode">
                Recovery code
              </label>
              <input
                id="recoveryCode"
                className="lf-input lf-num"
                style={{ letterSpacing: '0.12em', textAlign: 'center' }}
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                autoComplete="one-time-code"
                autoFocus
                required
              />
              <span className="lf-hint">Each saved code works once.</span>
              <button
                type="button"
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
                className="lf-input lf-auth-otp"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => onCodeChange(e.target.value)}
                autoComplete="one-time-code"
                autoFocus
                required
              />
              <button
                type="button"
                style={LINK_BUTTON}
                onClick={() => {
                  setUseRecoveryCode(true);
                  setError(null);
                }}
              >
                Lost your authenticator? Use a recovery code
              </button>
            </div>
          )}
        </>
      )}

      <button
        className="lf-btn lf-auth-submit"
        type="submit"
        disabled={busy}
        style={{ marginTop: 'var(--lf-space-2)' }}
      >
        {busy && <span className="lf-auth-spin" aria-hidden="true" />}
        {busy ? 'Signing in…' : mfaNeeded ? 'Verify and sign in' : 'Sign in'}
      </button>
    </form>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.6" />
      {off && <path d="M4 20 20 4" />}
    </svg>
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
