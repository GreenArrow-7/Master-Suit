'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Stage = 'loading' | 'scan' | 'saved' | 'error';

async function call(step: 'begin' | 'confirm', code?: string) {
  const res = await fetch('/api/v1/auth/enroll-2fa', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step, ...(code ? { code } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail ?? 'That did not work. Try again.');
  return data;
}

export default function EnrolForm() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('loading');
  const [secret, setSecret] = useState('');
  const [otpauth, setOtpauth] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  useEffect(() => {
    call('begin')
      .then((data) => {
        setSecret(data.secret);
        setOtpauth(data.otpauthUrl);
        setStage('scan');
      })
      .catch((err) => {
        setError(err.message);
        setStage('error');
      });
  }, []);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await call('confirm', code);
      setRecoveryCodes(data.recoveryCodes ?? []);
      setStage('saved');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'loading') return <p style={{ color: 'var(--lf-ink-3)' }}>Preparing your authenticator setup…</p>;

  if (stage === 'error') {
    return (
      <div className="lf-alert" role="alert">
        {error}
        <div style={{ marginTop: 12 }}>
          <Link className="lf-btn lf-btn--secondary lf-btn--sm" href="/login">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  if (stage === 'saved') {
    return (
      <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
        <div className="lf-alert" role="status" data-tone="success">
          Two-factor authentication is on.
        </div>
        <div>
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)' }}>
            Recovery codes
          </h2>
          <p style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)', margin: '4px 0 10px' }}>
            Shown once. Each works a single time, and they are the only way back in if you lose the authenticator. Store
            them somewhere other than the device running it.
          </p>
          <ul
            style={{
              listStyle: 'none',
              padding: 12,
              margin: 0,
              display: 'grid',
              gap: 4,
              gridTemplateColumns: '1fr 1fr',
              fontFamily: 'var(--lf-font-mono)',
              border: '1px solid var(--lf-line-2)',
              borderRadius: 'var(--lf-radius-sm)',
              background: 'var(--lf-surface-2)',
            }}
          >
            {recoveryCodes.map((recoveryCode) => (
              <li key={recoveryCode}>{recoveryCode}</li>
            ))}
          </ul>
        </div>
        <button
          className="lf-btn lf-btn--lg"
          onClick={() => {
            router.push('/login');
            router.refresh();
          }}
        >
          I have saved these — continue
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} style={{ display: 'grid', gap: 'var(--lf-space-4)' }} noValidate>
      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}

      <ol
        style={{
          margin: 0,
          paddingLeft: '1.2em',
          color: 'var(--lf-ink-2)',
          fontSize: 'var(--lf-text-sm)',
          display: 'grid',
          gap: 6,
        }}
      >
        <li>Open your authenticator app and add a new account.</li>
        <li>Enter this setup key:</li>
      </ol>

      <code
        style={{
          display: 'block',
          padding: '10px 12px',
          letterSpacing: '0.12em',
          wordBreak: 'break-all',
          border: '1px solid var(--lf-line-2)',
          borderRadius: 'var(--lf-radius-sm)',
          background: 'var(--lf-surface-2)',
          fontFamily: 'var(--lf-font-mono)',
        }}
      >
        {secret}
      </code>

      {otpauth && (
        <a href={otpauth} style={{ fontSize: 'var(--lf-text-sm)' }}>
          Open in an authenticator app on this device
        </a>
      )}

      <div className="lf-field">
        <label className="lf-label" htmlFor="code">
          Code from the app
        </label>
        <input
          id="code"
          className="lf-input lf-num"
          inputMode="numeric"
          maxLength={6}
          autoFocus
          required
          style={{ letterSpacing: '0.35em', fontSize: 'var(--lf-text-lg)', textAlign: 'center' }}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        />
        <span className="lf-hint">Six digits. It changes every thirty seconds.</span>
      </div>

      <button className="lf-btn lf-btn--lg" type="submit" disabled={busy || code.length !== 6}>
        {busy ? 'Checking…' : 'Turn on two-factor authentication'}
      </button>
    </form>
  );
}
