'use client';

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, ...(mfaCode ? { mfaCode } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail ?? 'That did not work. Check your details and try again.'); return; }
      if (data.mfaRequired) { setMfaNeeded(true); return; }
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
      {error && <div className="lf-alert" role="alert">{error}</div>}

      <div className="lf-field">
        <label className="lf-label" htmlFor="email">Email</label>
        <input id="email" className="lf-input" type="email" value={email}
               onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
        <span className="lf-hint">One account for every workspace you belong to.</span>
      </div>

      <div className="lf-field">
        <label className="lf-label" htmlFor="password">Password</label>
        <input id="password" className="lf-input" type="password" value={password}
               onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </div>

      {mfaNeeded && (
        <div className="lf-field">
          <label className="lf-label" htmlFor="mfaCode">Authentication code</label>
          <input id="mfaCode" className="lf-input lf-num" inputMode="numeric" maxLength={6}
                 style={{ letterSpacing: '0.35em', fontSize: 'var(--lf-text-lg)', textAlign: 'center' }}
                 value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))} autoFocus required />
          <span className="lf-hint">Six digits from your authenticator app.</span>
        </div>
      )}

      <button className="lf-btn lf-btn--lg" type="submit" disabled={busy} style={{ marginTop: 'var(--lf-space-2)' }}>
        {busy ? 'Signing in…' : mfaNeeded ? 'Verify and sign in' : 'Sign in'}
      </button>

      <a href="/forgot-password" style={{ fontSize: 'var(--lf-text-sm)', textAlign: 'center' }}>Forgot your password?</a>
    </form>
  );
}
