'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GRID_COLUMNS, type GridObject } from '@/lib/grid/columns';

/**
 * Lets an administrator choose which columns a list grid shows, and in what order.
 * Fixed columns are listed but locked — removing the reference or the name would
 * leave a row with no way through to its record.
 */
export default function ColumnEditor({ object, current }: { object: GridObject; current: string[] }) {
  const catalogue = GRID_COLUMNS[object];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>(current.filter((key) => !catalogue.find((c) => c.key === key)?.fixed));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const fixed = catalogue.filter((column) => column.fixed);
  const optional = catalogue.filter((column) => !column.fixed);
  const label = (key: string) => catalogue.find((column) => column.key === key)?.label ?? key;

  function toggle(key: string) {
    setChosen((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function move(key: string, delta: number) {
    setChosen((prev) => {
      const index = prev.indexOf(key);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError('');
    const res = await fetch('/api/v1/admin/grid-columns', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ object, columns: chosen }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.detail ?? data.title ?? 'Could not save columns');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <span className="lf-pop-anchor">
      <button type="button" className="lf-btn lf-btn--secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
        Columns
      </button>
      {open && (
        <div className="lf-pop lf-panelpop" role="dialog" aria-label="Grid columns">
          <div className="lf-panelpop__head">
            <strong className="lf-panelpop__title">Grid columns</strong>
            <button type="button" className="lf-linkbtn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          <ul className="lf-panelpop__list">
            {fixed.map((column) => (
              <li key={column.key} className="lf-panelpop__row" data-muted="">
                <input type="checkbox" checked disabled aria-label={`${column.label} is always shown`} />
                {column.label}
                <span className="lf-panelpop__note">Always shown</span>
              </li>
            ))}

            {chosen.map((key, index) => (
              <li key={key} className="lf-panelpop__row">
                <input type="checkbox" checked onChange={() => toggle(key)} aria-label={`Hide ${label(key)}`} />
                {label(key)}
                <span className="lf-panelpop__tools">
                  <button
                    type="button"
                    className="lf-btn lf-btn--ghost lf-btn--sm"
                    onClick={() => move(key, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${label(key)} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="lf-btn lf-btn--ghost lf-btn--sm"
                    onClick={() => move(key, 1)}
                    disabled={index === chosen.length - 1}
                    aria-label={`Move ${label(key)} down`}
                  >
                    ↓
                  </button>
                </span>
              </li>
            ))}

            {optional
              .filter((column) => !chosen.includes(column.key))
              .map((column) => (
                <li key={column.key} className="lf-panelpop__row" data-muted="">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => toggle(column.key)}
                    aria-label={`Show ${column.label}`}
                  />
                  {column.label}
                </li>
              ))}
          </ul>

          {error && (
            <p className="lf-hint lf-hint--error" role="alert">
              {error}
            </p>
          )}

          <div className="lf-panelpop__foot">
            <button type="button" className="lf-btn lf-btn--sm" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save for workspace'}
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--sm lf-btn--secondary"
              onClick={() => setChosen([])}
              disabled={busy}
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
