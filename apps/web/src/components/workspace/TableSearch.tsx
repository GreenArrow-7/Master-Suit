'use client';

import { useCallback, useId, useRef, useState, type ReactNode } from 'react';

/**
 * Search over the rows already on screen.
 *
 * Every list in the product is server-rendered, and most of them are small
 * enough that one round trip fetched the whole thing. For those, a server-side
 * `?q=` would be a page reload to hide rows the browser is already holding —
 * so this filters the DOM instead, and the box responds on the keystroke.
 *
 * It is deliberately NOT a replacement for the `?q=` filters on the large
 * lists (leads, accounts, contacts, opportunities, users). Those paginate, so
 * searching only what is loaded would quietly lie about what exists. Where both
 * are present the server filter runs first and this narrows the result.
 *
 * Rows are hidden with an inline `display: none` rather than the `hidden`
 * attribute: below 760px `.lf-table tbody tr` is set to `display: block` for the
 * card layout, and that rule beats `[hidden]`.
 */
export default function TableSearch({
  children,
  placeholder = 'Search this list…',
  label = 'Search',
  /** Column indexes to match against. Omit to search the whole row. */
  columns,
}: {
  children: ReactNode;
  placeholder?: string;
  label?: string;
  columns?: number[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const id = useId();
  const [count, setCount] = useState<{ shown: number; total: number } | null>(null);

  const filter = useCallback(
    (raw: string) => {
      const rows = host.current?.querySelectorAll<HTMLTableRowElement>('tbody tr');
      if (!rows) return;
      const needle = raw.trim().toLowerCase();
      let shown = 0;
      for (const row of rows) {
        const haystack = columns
          ? columns.map((index) => row.cells[index]?.textContent ?? '').join(' ')
          : (row.textContent ?? '');
        const match = !needle || haystack.toLowerCase().includes(needle);
        row.style.display = match ? '' : 'none';
        if (match) shown += 1;
      }
      setCount(needle ? { shown, total: rows.length } : null);
    },
    [columns],
  );

  return (
    <div ref={host} style={{ display: 'grid', gap: 'var(--lf-space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-3)', flexWrap: 'wrap' }}>
        <div className="lf-field" style={{ margin: 0, flex: '1 1 240px', maxWidth: 420 }}>
          <label className="lf-label" htmlFor={id}>
            {label}
          </label>
          <input
            id={id}
            className="lf-input"
            type="search"
            placeholder={placeholder}
            onInput={(event) => filter(event.currentTarget.value)}
          />
        </div>
        {count && (
          <span
            aria-live="polite"
            style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)', paddingTop: 18 }}
          >
            {count.shown} of {count.total} shown
          </span>
        )}
      </div>
      {children}
      {count?.shown === 0 && (
        <p style={{ margin: 0, color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
          Nothing on this page matches. Clear the box to see every row again.
        </p>
      )}
    </div>
  );
}
