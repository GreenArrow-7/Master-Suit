'use client';

import { useState } from 'react';
import { authFetch } from '@/lib/auth/client';

/**
 * One tap to check phone notifications end to end. Each answer names the link
 * that is missing, so "nothing arrived" is never the only clue.
 */
export default function PushTest({ configured, devices }: { configured: boolean; devices: number }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await authFetch('/api/v1/notification-preferences/test', { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) setStatus(data.detail ?? data.title ?? 'The test could not be sent. Try again shortly.');
      else if (!data.configured) setStatus('Phone notifications are not set up on the server yet.');
      else if (!data.devices)
        setStatus('No phone is registered to you. Open the YOUHAN ONE app and allow notifications.');
      else if (!data.sent)
        setStatus('Sent to your phone, but it was not accepted. Reinstall the app or allow notifications again.');
      else
        setStatus(`Sent to ${data.sent} device${data.sent === 1 ? '' : 's'}. It should arrive within a few seconds.`);
    } catch {
      setStatus('The server could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-4)', display: 'grid', gap: 'var(--lf-space-2)' }}>
      <strong>Check phone notifications</strong>
      <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
        Server: {configured ? 'set up' : 'not set up yet'} · Your phones registered: {devices}
      </span>
      <div>
        <button id="push-test" type="button" className="lf-btn lf-btn--sm" disabled={busy} onClick={send}>
          Send a test notification
        </button>
      </div>
      {status && (
        <p role="status" style={{ margin: 0, fontSize: 'var(--lf-text-sm)' }}>
          {status}
        </p>
      )}
    </section>
  );
}
