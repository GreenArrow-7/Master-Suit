'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** A JSON write that throws the server's own sentence; nothing is saved when it cannot be reached. */
export async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }).catch(() => null);
  if (!res) throw new Error('Could not reach the server. Nothing was saved.');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.errors?.[0]?.message ?? data.detail ?? `Request failed (${res.status})`);
  }
}

/**
 * One write in flight per control, its outcome shown beneath it and the page
 * refreshed on success: the shape every settings editor uses (Lead Stages, Lead
 * Sources).
 */
export function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const run = async (write: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await write();
      setMessage({ text: done });
      router.refresh();
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
    setBusy(false);
  };
  const note = message && (
    <p className={message.error ? 'lf-hint lf-hint--error' : 'lf-hint'} role={message.error ? 'alert' : 'status'}>
      {message.text}
    </p>
  );
  return { busy, run, note };
}
