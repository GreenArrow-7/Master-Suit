'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Sign-in for a platform service identity.
 *
 * A separate screen because it posts to a separate endpoint. `/login` posts to
 * `/api/v1/auth/login`, which issues FULL sessions — and `resolvePlatformCtx`
 * refuses an AI_SERVICE identity holding one, by design. So a service account
 * signing in there gets through the password and the code and is then bounced
 * on its first real request, which reads as "the login is broken" rather than
 * "that was the wrong door".
 *
 * The shape mirrors LoginForm deliberately — username then, only when the
 * server asks, the second factor — so the two screens behave the same way for
 * whoever has to use both.
 */
interface Workspace {
  id: string;
  slug: string;
  displayName: string;
}

export default function ServiceLoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaNeeded, setMfaNeeded] = useState(false);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const submitting = useRef(false);

  /** Points the session at a workspace, then goes there. */
  async function enter(workspaceId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/service-login', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? 'That workspace could not be opened.');
        return;
      }
      router.push(data.destination);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

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
      const res = await fetch('/api/v1/auth/service-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username,
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
              : "We couldn't sign you in. Check the username and password."),
        );
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
      /**
       * A service session holds no membership, so it lands nowhere by default.
       * The endpoint returns the workspaces it may open; one goes straight in,
       * several get a picker.
       */
      const list: Workspace[] = data.workspaces ?? [];
      if (list.length === 1) {
        await enter(list[0]!.id);
        return;
      }
      if (list.length === 0) {
        setError('Signed in, but this identity has no workspace it may open. Set one with set-session-scopes.');
        return;
      }
      setWorkspaces(list);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setMfaCode(digits);
    if (digits.length === 6 && !submitting.current) void submit(undefined, digits);
  }

  // Signed in, and more than one workspace to choose from.
  if (workspaces) {
    return (
      <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
        <div>
          <h1 className="lf-auth-title">Choose a workspace</h1>
          <p className="lf-auth-lede">
            Read-only. Opening one is recorded in the platform security log and in the workspace’s own audit trail.
          </p>
        </div>
        {error && (
          <div className="lf-auth-alert" role="alert">
            {error}
          </div>
        )}
        <div style={{ display: 'grid', gap: 'var(--lf-space-2)', maxHeight: 320, overflowY: 'auto' }}>
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              className="lf-btn lf-btn--ghost"
              disabled={busy}
              onClick={() => void enter(workspace.id)}
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
            >
              {workspace.displayName}
              <span style={{ marginLeft: 8, color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)' }}>
                /{workspace.slug}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--lf-space-4)' }} noValidate>
      <div>
        <h1 className="lf-auth-title">{mfaNeeded ? 'Verify it’s you' : 'Service sign-in'}</h1>
        <p className="lf-auth-lede">
          {mfaNeeded
            ? useRecoveryCode
              ? 'Enter one of the saved recovery codes.'
              : 'Enter the 6-digit code from the authenticator app.'
            : 'For platform service identities. Read-only, and every action is recorded.'}
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
            <label className="lf-label" htmlFor="username">
              Username or email
            </label>
            <input
              id="username"
              className="lf-input"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-describedby="username-hint"
              required
            />
            {/* The label said "Username" alone and the field was filled with the
                identity's email four times in a row, each answered as an unknown
                account. The route accepts both now; the label says so. */}
            <p
              id="username-hint"
              style={{ margin: '4px 0 0', fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}
            >
              Either the service username or the identity’s address.
            </p>
          </div>

          <div className="lf-field">
            <label className="lf-label" htmlFor="password">
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                className="lf-input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--lf-ink-3)',
                  fontSize: 12,
                }}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="lf-field">
            <label className="lf-label" htmlFor="identity">
              Signing in as
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-3)' }}>
              <input id="identity" className="lf-input" value={username} readOnly />
              <button
                type="button"
                className="lf-btn lf-btn--ghost"
                onClick={() => {
                  setMfaNeeded(false);
                  setMfaCode('');
                  setError(null);
                }}
              >
                Change
              </button>
            </div>
          </div>

          {!useRecoveryCode ? (
            <div className="lf-field">
              <label className="lf-label" htmlFor="mfaCode">
                Authentication code
              </label>
              <input
                id="mfaCode"
                className="lf-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={mfaCode}
                onChange={(e) => onCodeChange(e.target.value)}
                style={{ letterSpacing: '0.4em', textAlign: 'center', fontSize: 20 }}
                required
              />
            </div>
          ) : (
            <div className="lf-field">
              <label className="lf-label" htmlFor="recoveryCode">
                Recovery code
              </label>
              <input
                id="recoveryCode"
                className="lf-input"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                required
              />
            </div>
          )}

          <button
            type="button"
            className="lf-link"
            onClick={() => {
              setUseRecoveryCode((value) => !value);
              setError(null);
            }}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
          >
            {useRecoveryCode ? 'Use the authenticator instead' : 'Lost the authenticator? Use a recovery code'}
          </button>
        </>
      )}

      <button className="lf-btn" type="submit" disabled={busy}>
        {busy ? 'Working…' : mfaNeeded ? 'Verify and sign in' : 'Continue'}
      </button>

      <p style={{ margin: 0, fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
        Signing in to a person’s account? <Link href="/login">Use the normal sign-in</Link>.
      </p>
    </form>
  );
}
