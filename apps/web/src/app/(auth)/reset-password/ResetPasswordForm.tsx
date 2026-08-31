'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const mismatch = confirm.length > 0 && password !== confirm;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The policy check returns one entry per unmet rule; show them all
        // rather than making the user discover them one at a time.
        const problems: string[] = Array.isArray(data.errors)
          ? data.errors.map((e: { message: string }) => e.message)
          : [data.detail ?? 'That did not work. Request a new link and try again.'];
        setErrors(problems);
        return;
      }
      setDone(true);
    } catch {
      setErrors(['Could not reach the server. Check your connection and try again.']);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
        <div className="lf-alert" role="status">
          Your password has been changed and every session has been signed out.
        </div>
        <Link className="lf-btn lf-btn--lg" href="/login">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--lf-space-4)' }} noValidate>
      {errors.length > 0 && (
        <div className="lf-alert" role="alert">
          {errors.length === 1 ? (
            errors[0]
          ) : (
            <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="lf-field">
        <label className="lf-label" data-required htmlFor="password">
          New password
        </label>
        <input
          id="password"
          className="lf-input"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <span className="lf-hint">At least 12 characters, with upper case, lower case and a number.</span>
      </div>

      <div className="lf-field">
        <label className="lf-label" data-required htmlFor="confirm">
          Confirm new password
        </label>
        <input
          id="confirm"
          className="lf-input"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={mismatch}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        {mismatch && (
          <span className="lf-hint" role="alert" style={{ color: 'var(--lf-danger)' }}>
            These do not match.
          </span>
        )}
      </div>

      <button className="lf-btn lf-btn--lg" type="submit" disabled={busy || !password || mismatch}>
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}
