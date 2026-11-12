'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { formatReport, keyFor, readEntries, type DiagnosticEntry } from '@/lib/diagnostics/clientLog';

/**
 * What this browser recorded, for somebody to read on the device it happened
 * on and send to whoever is fixing it.
 *
 * The log lives in `localStorage`, which the server cannot see, so this reads it
 * through `useSyncExternalStore`: the server snapshot is empty, the client's is
 * the stored string, and React reconciles the two without a hydration mismatch
 * and without setting state inside an effect.
 *
 * The snapshot is the **raw string** rather than a parsed array on purpose —
 * `getSnapshot` must return a stable value, and parsing afresh each call would
 * hand React a new array every render and spin forever.
 */
const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
};
const announce = () => listeners.forEach((listener) => listener());

export default function DiagnosticsReport({ build, owner }: { build: string; owner: string }) {
  const storageKey = keyFor(owner);
  const [copied, setCopied] = useState(false);

  const raw = useSyncExternalStore(
    subscribe,
    useCallback(() => {
      try {
        return window.localStorage.getItem(storageKey) ?? '';
      } catch {
        return '';
      }
    }, [storageKey]),
    () => '',
  );
  const entries = useMemo<DiagnosticEntry[]>(
    () => (raw === '' ? [] : readEntries({ getItem: () => raw }, storageKey)),
    [raw, storageKey],
  );

  const report = formatReport(entries, build);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Some WebViews refuse the clipboard. The text is on screen and
      // selectable, which is why it is rendered rather than only copied.
      setCopied(false);
    }
  };

  const clear = () => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Nothing to do; the list below will simply not change.
    }
    announce();
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
      <div style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
        <button className="lf-btn lf-btn--sm" onClick={copy} disabled={entries.length === 0}>
          {copied ? 'Copied' : 'Copy report'}
        </button>
        <button className="lf-btn lf-btn--secondary lf-btn--sm" onClick={clear} disabled={entries.length === 0}>
          Clear
        </button>
      </div>

      {entries.length === 0 ? (
        <p style={{ color: 'var(--lf-ink-2)' }}>
          Nothing recorded on this device. If a screen goes blank or something fails, come back here afterwards —
          without closing the app first, which would be fine too, since this survives a restart.
        </p>
      ) : (
        <pre
          style={{
            margin: 0,
            padding: 'var(--lf-space-3)',
            background: 'var(--lf-surface-2)',
            border: '1px solid var(--lf-line-2)',
            borderRadius: 'var(--lf-radius-sm)',
            fontFamily: 'var(--lf-font-mono)',
            fontSize: 'var(--lf-text-xs)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            // Selectable on a phone, which is the fallback when the clipboard
            // is refused.
            userSelect: 'text',
          }}
        >
          {report}
        </pre>
      )}
    </div>
  );
}
