'use client';

import { useEffect, useState } from 'react';
import { DIAGNOSTIC_KEY, formatReport, readEntries, type DiagnosticEntry } from '@/lib/diagnostics/clientLog';

/**
 * What this browser recorded, for somebody to read on the device it happened
 * on and send to whoever is fixing it.
 *
 * Read from `localStorage` in an effect rather than on the server, because that
 * is where it lives — nothing was ever uploaded.
 */
export default function DiagnosticsReport({ build }: { build: string }) {
  const [entries, setEntries] = useState<DiagnosticEntry[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEntries(readEntries(window.localStorage));
  }, []);

  if (entries === null) return <p style={{ color: 'var(--lf-ink-3)' }}>Reading…</p>;

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
      window.localStorage.removeItem(DIAGNOSTIC_KEY);
    } catch {
      // Nothing to do; the list below will simply not change.
    }
    setEntries([]);
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
