'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

/**
 * Resets someone's password and shows the temporary value once.
 *
 * It gets its own component because the returned password must be displayed and
 * then deliberately lost: it is not stored in readable form, so there is no
 * screen to come back to. Anything that renders it has to make that plain at the
 * moment it is on screen, not in documentation somewhere.
 */
export default function TemporaryPasswordButton({ endpoint, userId, userName }: {
  endpoint: string;
  userId: string;
  userName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);

  async function reset() {
    if (!window.confirm(`Reset the password for ${userName}? Every session they have open will be signed out, and they must set their own password before anything else opens.`)) return;
    setBusy(true); setError(null);
    try {
      const response = await authFetch(`${endpoint}/password-reset`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.detail ?? 'The password could not be reset.'); return; }
      setIssued(data.temporaryPassword);
      router.refresh();
    } catch { setError('The server could not be reached.'); }
    finally { setBusy(false); }
  }

  if (issued) {
    return <div className="lf-alert" style={{ display: 'grid', gap: 8 }}>
      <strong>Temporary password for {userName}</strong>
      <code style={{ padding: '8px 10px', background: 'var(--lf-surface-2)', borderRadius: 6, fontSize: 'var(--lf-text-md)', letterSpacing: '0.02em' }}>{issued}</code>
      <span style={{ fontSize: 'var(--lf-text-sm)' }}>
        Shown once — it is not stored in readable form and cannot be retrieved. Hand it over in person or by phone, not by email or chat.
      </span>
      <div><button className="lf-btn lf-btn--ghost" type="button" onClick={() => setIssued(null)}>Done</button></div>
    </div>;
  }

  return <span style={{ display: 'inline-grid', gap: 4 }}>
    <button className="lf-btn lf-btn--secondary" type="button" disabled={busy} onClick={reset}>{busy ? 'Resetting…' : 'Reset password'}</button>
    {error && <span className="lf-alert" role="alert" style={{ fontSize: 'var(--lf-text-xs)' }}>{error}</span>}
  </span>;
}
