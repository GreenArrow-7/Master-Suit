'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import {
  appendEntry,
  forgetOtherOwners,
  keyFor,
  makeEntry,
  readEntries,
  writeEntries,
} from '@/lib/diagnostics/clientLog';

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
 *
 * shortcut: this looks once per navigation, a few seconds after arriving, so it
 * reports a screen that arrives blank and not one that empties later. That is
 * the reported fault. Upgrade to a MutationObserver if a report ever describes
 * a screen that was filled and then went blank without navigating.
 */
const BLANK_CHECK_DELAY_MS = 4_000;

/**
 * And again, before reporting.
 *
 * A phone on a slow connection can still be fetching at the first check. Two
 * observations a second apart separate "not arrived yet" from "arrived empty",
 * and only the second is a fault.
 */
const BLANK_CONFIRM_MS = 1_500;

/**
 * `owner` is `tenantId:userId` — the same value the offline outbox already uses
 * to keep one person's queued writes off another's device. Reusing it means
 * there is one idea of "whose data is this on this phone", not two.
 */
export default function ClientDiagnostics({ owner }: { owner: string }) {
  const pathname = usePathname();
  // Not state: writing it must never re-render the shell being measured.
  const recent = useRef<string[]>([]);
  const storageKey = keyFor(owner);

  useEffect(() => {
    // Somebody else's log must not be readable by whoever signs in next on a
    // shared phone or a branch tablet.
    forgetOtherOwners(typeof window === 'undefined' ? undefined : window.localStorage, storageKey);
  }, [storageKey]);

  useEffect(() => {
    const record = (kind: Parameters<typeof makeEntry>[0], detail: unknown) => {
      const entry = makeEntry(kind, window.location.pathname, detail);
      // The same handler can fire repeatedly for one fault; one line per fault
      // is what makes the report readable.
      const fingerprint = `${entry.kind}|${entry.path}|${entry.detail}`;
      if (recent.current.includes(fingerprint)) return;
      recent.current = [...recent.current, fingerprint].slice(-8);
      writeEntries(window.localStorage, storageKey, appendEntry(readEntries(window.localStorage, storageKey), entry));
    };

    const onError = (event: ErrorEvent) => record('error', event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => record('rejection', event.reason);

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [storageKey]);

  useEffect(() => {
    /**
     * The page region only — never `main`, which also holds the area tabs.
     * Their labels alone run to ~82 characters, so a threshold over `main`
     * can never see an empty page. Measured on the marker the layout puts
     * around `{children}`; without it there is nothing to measure honestly,
     * so nothing is reported.
     */
    const measure = () => {
      const root = document.querySelector<HTMLElement>('[data-content-root]');
      if (!root) return null;
      return { text: (root.innerText ?? '').trim().length, nodes: root.querySelectorAll('*').length };
    };

    let confirm: number | undefined;
    const first = window.setTimeout(() => {
      const before = measure();
      // Empty means empty: no text and no elements. A page that legitimately
      // says "No leads yet" has both, and a short empty state is not a fault.
      if (!before || before.text > 0 || before.nodes > 0) return;
      confirm = window.setTimeout(() => {
        const after = measure();
        if (!after || after.text > 0 || after.nodes > 0) return;
        if (document.visibilityState !== 'visible') return;
        writeEntries(
          window.localStorage,
          storageKey,
          appendEntry(
            readEntries(window.localStorage, storageKey),
            makeEntry(
              'blank-screen',
              window.location.pathname,
              `page region rendered nothing ${BLANK_CHECK_DELAY_MS + BLANK_CONFIRM_MS}ms after arriving, confirmed twice`,
            ),
          ),
        );
      }, BLANK_CONFIRM_MS);
    }, BLANK_CHECK_DELAY_MS);

    return () => {
      window.clearTimeout(first);
      if (confirm) window.clearTimeout(confirm);
    };
  }, [pathname, storageKey]);

  return null;
}
