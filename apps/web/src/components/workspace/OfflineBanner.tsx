'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { flush, pending, type Pending } from '@/lib/offline';

const subscribe = (onChange: () => void) => {
  for (const event of ['outbox', 'storage', 'online', 'offline']) window.addEventListener(event, onChange);
  return () => {
    for (const event of ['outbox', 'storage', 'online', 'offline']) window.removeEventListener(event, onChange);
  };
};
const waitingCount = () => pending().length;
const online = () => navigator.onLine;

/**
 * What is waiting to be sent, and what could not be. Sends on reconnecting, on
 * coming back to the app, and on load; refreshes the screen once something went.
 */
export default function OfflineBanner() {
  const router = useRouter();
  const waiting = useSyncExternalStore(subscribe, waitingCount, () => 0);
  const connected = useSyncExternalStore(subscribe, online, () => true);
  const [refused, setRefused] = useState<(Pending & { reason: string })[]>([]);
  const [sent, setSent] = useState(0);

  const send = useCallback(async () => {
    if (!navigator.onLine || pending().length === 0) return;
    const result = await flush();
    if (result.sent) {
      setSent(result.sent);
      router.refresh();
    }
    if (result.refused.length) setRefused((r) => [...r, ...result.refused]);
  }, [router]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void send();
    window.addEventListener('online', send);
    document.addEventListener('visibilitychange', onVisible);
    // And once on arrival, after this render: what waited from an earlier visit.
    const first = setTimeout(() => void send(), 0);
    return () => {
      clearTimeout(first);
      window.removeEventListener('online', send);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [send]);

  if (!waiting && !refused.length && !sent && connected) return null;
  return (
    <div role="status" className="lf-toast lf-outbox">
      {!connected && <div>You are offline. Changes you make to leads are kept on this device.</div>}
      {waiting > 0 && (
        <div>
          {waiting} change{waiting === 1 ? '' : 's'} waiting to be sent
          {connected ? (
            <>
              {' '}
              —{' '}
              <button type="button" className="lf-toast__action" onClick={() => void send()}>
                Send now
              </button>
            </>
          ) : (
            ' when you are back online.'
          )}
        </div>
      )}
      {sent > 0 && waiting === 0 && (
        <div>
          Sent {sent} change{sent === 1 ? '' : 's'} made offline.{' '}
          <button type="button" className="lf-toast__action" onClick={() => setSent(0)}>
            Dismiss
          </button>
        </div>
      )}
      {refused.map((item) => (
        <div key={item.id} role="alert">
          {item.label} from {new Date(item.at).toLocaleString('en-GB')} could not be saved: {item.reason}
        </div>
      ))}
    </div>
  );
}
