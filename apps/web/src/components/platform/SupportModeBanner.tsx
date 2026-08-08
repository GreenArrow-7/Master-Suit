'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Shown while platform staff are viewing a customer workspace. It exists so the
 * viewer is never in any doubt that this is someone else's data and that they
 * are in a read-only mode, and so there is an obvious way back out.
 */
export default function SupportModeBanner({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function leave() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/platform/workspaces/${workspaceId}/enter`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      router.push(data.destination ?? '/platform');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '8px 20px',
        background: 'var(--lf-brass-edge, #B8860B)',
        color: '#1b1206',
        fontSize: 'var(--lf-text-sm)',
      }}
    >
      <span>
        <strong>Platform support view</strong> — viewing {workspaceName} as platform staff. Read-only; sensitive HR
        fields stay hidden.
      </span>
      <button type="button" onClick={leave} disabled={busy} className="lf-btn lf-btn--ghost">
        {busy ? 'Leaving…' : 'Exit to platform'}
      </button>
    </div>
  );
}
