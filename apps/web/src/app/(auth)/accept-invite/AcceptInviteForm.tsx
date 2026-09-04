'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Preview {
  email: string;
  fullName: string;
  workspaceName: string;
  roleName: string;
  expiresAt: string;
}

export default function AcceptInviteForm({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<{ note: string } | null>(null);

  const mismatch = confirm.length > 0 && password !== confirm;

  useEffect(() => {
    fetch(`/api/v1/auth/accept-invite?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setErrors([data.detail ?? 'This invitation link is no longer valid.']);
          return;
        }
        setPreview(data);
        setFullName(data.fullName ?? '');
      })
      .catch(() => setErrors(['Could not reach the server. Check your connection and try again.']))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch('/api/v1/auth/accept-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password, fullName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(
          Array.isArray(data.errors)
            ? data.errors.map((e: { message: string }) => e.message)
            : [data.detail ?? 'That did not work. Ask for a new invitation.'],
        );
        return;
      }
      setDone({ note: data.note });
    } catch {
      setErrors(['Could not reach the server. Check your connection and try again.']);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p style={{ color: 'var(--lf-ink-3)' }}>Checking your invitation…</p>;

  if (done) {
    return (
      <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
          You are in
        </h1>
        <div className="lf-alert" role="status">
          {done.note}
        </div>
        <Link className="lf-btn lf-btn--lg" href="/login">
          Sign in
        </Link>
      </div>
    );
  }

  if (!preview) {
    return (
      <>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', marginTop: 4 }}>
          Invitation
        </h1>
        <div className="lf-alert" role="alert" style={{ marginTop: 'var(--lf-space-4)' }}>
          {errors[0] ?? 'This invitation link is no longer valid.'}
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', marginTop: 4 }}>
        Join {preview.workspaceName}
      </h1>
      <p style={{ margin: '4px 0 var(--lf-space-6)', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
        Invited as <strong>{preview.roleName}</strong>, for <strong>{preview.email}</strong>. Choose a password — nobody
        else will know it.
      </p>

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
          <label className="lf-label" data-required htmlFor="fullName">
            Your name
          </label>
          <input
            id="fullName"
            className="lf-input"
            required
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </div>

        <div className="lf-field">
          <label className="lf-label" data-required htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="lf-input"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span className="lf-hint">At least 12 characters, with upper case, lower case and a number.</span>
        </div>

        <div className="lf-field">
          <label className="lf-label" data-required htmlFor="confirm">
            Confirm password
          </label>
          <input
            id="confirm"
            className="lf-input"
            type="password"
            required
            autoComplete="new-password"
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

        <button className="lf-btn lf-btn--lg" type="submit" disabled={busy || !password || mismatch || !fullName}>
          {busy ? 'Creating your account…' : 'Create my account'}
        </button>
      </form>
    </>
  );
}
