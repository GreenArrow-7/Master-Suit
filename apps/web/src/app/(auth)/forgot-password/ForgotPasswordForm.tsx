'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      // 429 is the one case worth distinguishing: it is about the request, not
      // the account, so saying so leaks nothing.
      if (res.status === 429) {
        setError(data.detail ?? 'Too many attempts. Wait a few minutes and try again.');
        return;
      }
      setSent(true);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
        <div className="lf-alert" role="status">
          If that account exists, a reset link is on its way. Check your inbox and your spam folder.
        </div>
        <Link className="lf-btn lf-btn--secondary" href="/login">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--lf-space-4)' }} noValidate>
      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}

      <div className="lf-field">
        <label className="lf-label" htmlFor="email">
          Email
          <span className="lf-label__req" aria-hidden="true">
            {' '}
            *
          </span>
        </label>
        <input
          id="email"
          className="lf-input"
          type="email"
          autoComplete="username"
          required
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <button className="lf-btn lf-btn--lg" type="submit" disabled={busy || !email}>
        {busy ? 'Sending…' : 'Send reset link'}
      </button>

      <Link href="/login" style={{ fontSize: 'var(--lf-text-sm)', textAlign: 'center' }}>
        Back to sign in
      </Link>
    </form>
  );
}
