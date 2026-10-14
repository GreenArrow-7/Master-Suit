'use client';

import { useEffect } from 'react';

/** Tokens already reported by this tab: React runs an effect twice in development. */
const reported = new Set<string>();

/**
 * Tells the lead's timeline the page was opened (api/v1/public/share-view),
 * from the browser once it shows: a link preview fetches the page but runs no
 * script, so it is not counted as the client opening it.
 */
export default function Opened({ token }: { token: string }) {
  useEffect(() => {
    if (reported.has(token)) return;
    reported.add(token);
    fetch('/api/v1/public/share-view', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      keepalive: true,
    }).catch(() => {});
  }, [token]);
  return null;
}
