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
  readOnly = true,
}: {
  workspaceId: string;
  workspaceName: string;
  /** SUPPORT and SECURITY_AUDITOR are read-only; the OWNER has full control. */
  readOnly?: boolean;
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
        // Amber, not the brand gradient it used to wear. This banner says
        // "you are looking at someone else's data" — that is a warning, and a
        // warning painted in the brand colour stops reading as one.
        background: 'var(--yh-warning)',
        color: 'var(--yh-on-primary)',
        fontSize: 'var(--lf-text-sm)',
      }}
    >
      <span>
        {readOnly ? (
          <>
            <strong>Platform support view</strong> — viewing {workspaceName} as platform staff. Read-only; sensitive HR
            fields stay hidden.
          </>
        ) : (
          <>
            <strong>Platform owner view</strong> — administering {workspaceName} with full control. Every change is
            recorded in the audit log.
          </>
        )}
      </span>
      <button type="button" onClick={leave} disabled={busy} className="lf-btn lf-btn--ghost">
        {busy ? 'Leaving…' : 'Exit to platform'}
      </button>
    </div>
  );
}
