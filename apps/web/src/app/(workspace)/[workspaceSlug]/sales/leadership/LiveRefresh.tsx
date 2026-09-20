'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-reads the page on an interval while it is visible, so the board follows
 * the calls as they are logged without anyone pressing reload. Paused in a
 * background tab; the numbers come from the server, never from this component.
 */
export default function LiveRefresh({ everyMs = 30_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = setInterval(tick, everyMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, everyMs]);
  return null;
}
