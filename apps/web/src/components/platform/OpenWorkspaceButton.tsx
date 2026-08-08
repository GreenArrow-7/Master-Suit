'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Points the platform session at a workspace, then navigates into it. The server
 * decides the destination so the slug is never trusted from the client.
 */
export default function OpenWorkspaceButton({
  workspaceId,
  label = 'Open',
  className = 'lf-btn lf-btn--ghost',
}: {
  workspaceId: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/platform/workspaces/${workspaceId}/enter`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? 'That workspace could not be opened.');
        return;
      }
      router.push(data.destination);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={open} disabled={busy}>
        {busy ? 'Opening…' : label}
      </button>
      {error && (
        <div role="alert" style={{ color: 'var(--lf-danger, #B00020)', fontSize: 'var(--lf-text-xs)' }}>
          {error}
        </div>
      )}
    </>
  );
}
