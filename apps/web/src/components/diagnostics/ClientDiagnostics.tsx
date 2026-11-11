'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { appendEntry, makeEntry, readEntries, writeEntries } from '@/lib/diagnostics/clientLog';

/**
 * Records what the browser saw, so a fault that only happens on somebody's
 * phone can be read back without a Mac and a cable.
 *
 * Mounted once in the workspace shell. It listens and it writes to this
 * browser's own storage. It sends nothing anywhere — People → Diagnostics shows
 * what was recorded and the person decides what to share.
 *
 * ── The blank screen detector ───────────────────────────────────────────────
 *
 * The reported fault is a screen with nothing on it after saving. That is a
 * symptom this can observe directly: a short while after a navigation settles,
 * if the main region has rendered no text, something went wrong that no error
 * handler caught. A soft navigation that resolves to an empty tree throws
 * nothing — which is exactly why it has been so hard to pin down.
 *
 * The delay is deliberate and generous. A page mid-render is legitimately
 * empty, and a false "blank screen" in the log would send the next person
 * chasing a phantom.
 */
const BLANK_CHECK_DELAY_MS = 2_500;

/** Below this, there is nothing a person could read or act on. */
const BLANK_TEXT_THRESHOLD = 40;

export default function ClientDiagnostics() {
  const pathname = usePathname();
  // Not state: writing it must never re-render the shell being measured.
  const recent = useRef<string[]>([]);

  useEffect(() => {
    const record = (kind: Parameters<typeof makeEntry>[0], detail: unknown) => {
      const entry = makeEntry(kind, window.location.pathname, detail);
      // The same handler can fire repeatedly for one fault; one line per fault
      // is what makes the report readable.
      const fingerprint = `${entry.kind}|${entry.path}|${entry.detail}`;
      if (recent.current.includes(fingerprint)) return;
      recent.current = [...recent.current, fingerprint].slice(-8);
      writeEntries(window.localStorage, appendEntry(readEntries(window.localStorage), entry));
    };

    const onError = (event: ErrorEvent) => record('error', event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => record('rejection', event.reason);

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const main = document.querySelector('main');
      const text = (main?.innerText ?? document.body.innerText ?? '').trim();
      if (text.length >= BLANK_TEXT_THRESHOLD) return;
      // Hidden tabs legitimately render nothing on some engines.
      if (document.visibilityState !== 'visible') return;
      const entry = makeEntry(
        'blank-screen',
        window.location.pathname,
        `main rendered ${text.length} characters ${BLANK_CHECK_DELAY_MS}ms after arriving`,
      );
      writeEntries(window.localStorage, appendEntry(readEntries(window.localStorage), entry));
    }, BLANK_CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  return null;
}
