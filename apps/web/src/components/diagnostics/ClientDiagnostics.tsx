'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import {
  appendEntry,
  forgetOtherOwners,
  keyFor,
  makeEntry,
  readEntries,
  redactPath,
  setLogKey,
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
/**
 * How often the page region is looked at, and for how long after arriving.
 *
 * One look a few seconds in only catches a screen that *arrives* blank. The
 * reported journey is a save followed by a screen that is not there, and the
 * screen can empty, or fail to fill, at any point in that sequence — so the
 * region is sampled for a while instead, and the first fault that holds for two
 * consecutive samples is recorded.
 */
const SAMPLE_MS = 2_000;
const WATCH_MS = 30_000;

/**
 * Nothing is reported before this, because a page mid-render is legitimately
 * empty and a false blank screen sends the next person chasing a phantom.
 */
const EMPTY_AFTER_MS = 4_000;

/**
 * A skeleton is the right thing to show while a page loads. It is a fault only
 * when it is still there long after the page should have arrived, which is its
 * own finding: the boundary never resolved and nothing threw. Held well clear
 * of the empty threshold so a slow phone is not called a stuck one.
 */
const BUSY_AFTER_MS = 12_000;

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
    // Published before anything can write: a save can finish before the
    // listeners below are attached.
    setLogKey(storageKey);
    // Somebody else's log must not be readable by whoever signs in next on a
    // shared phone or a branch tablet.
    forgetOtherOwners(typeof window === 'undefined' ? undefined : window.localStorage, storageKey);
  }, [storageKey]);

  /**
   * One line per fault, wherever it came from.
   *
   * Shared by the error listeners and the request instrument, because both can
   * fire repeatedly for one underlying problem and a report is only readable if
   * it says each thing once.
   */
  const record = useCallback(
    (kind: Parameters<typeof makeEntry>[0], detail: unknown) => {
      const entry = makeEntry(kind, window.location.pathname, detail);
      const fingerprint = `${entry.kind}|${entry.path}|${entry.detail}`;
      if (recent.current.includes(fingerprint)) return;
      recent.current = [...recent.current, fingerprint].slice(-8);
      writeEntries(window.localStorage, storageKey, appendEntry(readEntries(window.localStorage, storageKey), entry));
    },
    [storageKey],
  );

  useEffect(() => {
    const onError = (event: ErrorEvent) => record('error', event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => record('rejection', event.reason);

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [record]);

  useEffect(() => {
    /**
     * The page region only — never `main`, which also holds the area tabs.
     * Their labels alone run to ~62 characters, so a threshold over `main`
     * can never see an empty page. Measured on the marker the layout puts
     * around `{children}`; without it there is nothing to measure honestly,
     * so nothing is reported.
     */
    const look = (): { state: 'empty' | 'busy' | 'ok'; nodes: number } | null => {
      const root = document.querySelector<HTMLElement>('[data-content-root]');
      if (!root) return null;
      const nodes = root.querySelectorAll('*').length;
      // A skeleton says so itself. Checked first: it has both text and
      // elements, so the empty test below would never see it.
      if (root.querySelector('[aria-busy="true"]')) return { state: 'busy', nodes };
      const text = (root.innerText ?? '').trim().length;
      if (text > 0) return { state: 'ok', nodes };
      // No text, but a page can legitimately be a chart or an image.
      if (root.querySelector('img, svg, canvas, video')) return { state: 'ok', nodes };
      // No text and nothing to look at. Wrapper elements do not count as
      // content: an empty region nested in three divs is still empty, which a
      // "no elements at all" rule missed.
      return { state: 'empty', nodes };
    };

    const started = Date.now();
    let previous: 'empty' | 'busy' | 'ok' | null = null;
    let done = false;

    const sample = () => {
      if (done) return;
      const elapsed = Date.now() - started;
      if (elapsed > WATCH_MS) {
        done = true;
        return;
      }
      // A backgrounded tab renders nothing and proves nothing.
      if (document.visibilityState !== 'visible') {
        previous = null;
        return;
      }
      const seen = look();
      if (!seen) return;

      const ripe =
        (seen.state === 'empty' && elapsed >= EMPTY_AFTER_MS) || (seen.state === 'busy' && elapsed >= BUSY_AFTER_MS);
      // Two consecutive samples, so "not arrived yet" is not read as
      // "arrived empty".
      if (ripe && previous === seen.state) {
        done = true;
        const detail =
          seen.state === 'busy'
            ? `page region still loading ${Math.round(elapsed / 1000)}s after arriving, confirmed twice`
            : `page region rendered no content ${Math.round(elapsed / 1000)}s after arriving, confirmed twice (${seen.nodes} wrapper elements)`;
        writeEntries(
          window.localStorage,
          storageKey,
          appendEntry(
            readEntries(window.localStorage, storageKey),
            makeEntry(seen.state === 'busy' ? 'stuck-skeleton' : 'blank-screen', window.location.pathname, detail),
          ),
        );
        return;
      }
      previous = seen.state;
    };

    const timer = window.setInterval(sample, SAMPLE_MS);
    return () => window.clearInterval(timer);
  }, [pathname, storageKey]);

  useEffect(() => {
    /**
     * The reported journey is a save. When the screen that follows is not
     * there, the first question is whether the save itself failed — so a
     * request that did not succeed is recorded, and nothing else.
     *
     * Status and redacted path only. No request body, no response body, no
     * query string: those carry the customer's details, which is exactly what
     * must never reach a log somebody copies out.
     *
     * Re-asserted on a timer rather than installed once, because the framework
     * installs its own `fetch` wrapper and whichever of us assigns last wins.
     * Installing once looked right in a browser and recorded nothing under the
     * test harness, which is the only reason this is known. Wrapping twice is
     * harmless: `record` reports a given fault once.
     */
    const ensure = () => {
      const current = window.fetch as typeof window.fetch & { __lfDiagnostics?: true };
      if (current.__lfDiagnostics) return;
      const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await current(input, init);
        try {
          if (!response.ok) {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            const method = (init?.method ?? 'GET').toUpperCase();
            record('request-failed', `${method} ${redactPath(url)} returned ${response.status}`);
          }
        } catch {
          // A diagnostic must never be the reason a request fails.
        }
        return response;
      };
      (wrapped as typeof wrapped & { __lfDiagnostics?: true }).__lfDiagnostics = true;
      window.fetch = wrapped as typeof window.fetch;
    };

    ensure();
    const timer = window.setInterval(ensure, 1_000);
    return () => window.clearInterval(timer);
  }, [record]);

  return null;
}
