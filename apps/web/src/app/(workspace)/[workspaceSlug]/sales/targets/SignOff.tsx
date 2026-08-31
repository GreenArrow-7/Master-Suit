'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth/signOut';

/**
 * Ends the working day. Offered once every active target is met, but never
 * withheld — an employee may always sign out, target or no target, so this is a
 * convenience button rather than a gate.
 */
export default function SignOff({ complete, remaining }: { complete: boolean; remaining: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function endSession() {
    setBusy(true);
    await signOut();
    router.push('/login');
  }

  return (
    <div
      className="lf-card"
      style={{
        padding: 'var(--lf-space-5)',
        marginTop: 'var(--lf-space-5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--lf-space-4)',
        flexWrap: 'wrap',
      }}
    >
      <div>
        <div style={{ fontWeight: 600 }}>{complete ? 'All targets met for today' : 'Targets still open'}</div>
        <div style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)', marginTop: 2 }}>
          {complete
            ? 'Nothing outstanding. You can finish for the day.'
            : `${remaining} more to go before today's targets are met.`}
        </div>
      </div>
      <button className={complete ? 'lf-btn' : 'lf-btn lf-btn--ghost'} onClick={endSession} disabled={busy}>
        {busy ? 'Signing out…' : complete ? 'Finish for the day and sign out' : 'Sign out anyway'}
      </button>
    </div>
  );
}
