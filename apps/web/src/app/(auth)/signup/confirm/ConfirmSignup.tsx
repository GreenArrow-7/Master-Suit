'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

type Result =
  | { state: 'working' }
  | { state: 'done'; slug: string; email: string; reusedExistingIdentity: boolean }
  | { state: 'failed'; message: string };

/**
 * Confirms on arrival, from the browser: a mail scanner fetching the link does
 * not run this, so it cannot spend the link before its owner does.
 */
export default function ConfirmSignup({ token }: { token: string }) {
  const [result, setResult] = useState<Result>(
    token
      ? { state: 'working' }
      : { state: 'failed', message: 'This link is incomplete. Open the one in your email again.' },
  );
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current || !token) return;
    sent.current = true;
    fetch('/api/v1/public/signup/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        setResult(
          res.ok
            ? { state: 'done', ...data }
            : {
                state: 'failed',
                message:
                  res.status === 404
                    ? 'This link has been used, has expired, or sign-up is closed. Sign up again for a new one.'
                    : (data.detail ?? 'The workspace could not be made. Try the link again in a minute.'),
              },
        );
      })
      .catch(() => setResult({ state: 'failed', message: 'Could not reach the server. Open the link again.' }));
  }, [token]);

  if (result.state === 'working') return <p className="lf-auth-lede">Making your workspace…</p>;
  if (result.state === 'failed') {
    return (
      <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
        <div className="lf-alert" role="alert">
          {result.message}
        </div>
        <Link className="lf-btn lf-btn--secondary" href="/signup">
          Sign up again
        </Link>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
      <div className="lf-alert" role="status">
        Your workspace is ready. Sign in as {result.email}
        {result.reusedExistingIdentity ? ' with the password you already use here.' : ' with the password you chose.'}
      </div>
      <Link className="lf-btn lf-btn--lg" href="/login">
        Sign in
      </Link>
    </div>
  );
}
