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
      [next[index], next[target]] = [next[target], next[index]];
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

  if (!open) {
    return (
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setOpen(true)}>Columns</button>
      </span>
    );
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setOpen(false)}>Columns</button>
      <div className="lf-card" style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, zIndex: 20, width: 320, padding: 'var(--lf-space-4)', boxShadow: 'var(--lf-shadow-2)', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--lf-space-3)' }}>
        <strong style={{ fontSize: 'var(--lf-text-sm)' }}>Grid columns</strong>
        <button className="lf-toast__action" onClick={() => setOpen(false)} aria-label="Close column editor">Close</button>
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 320, overflowY: 'auto' }}>
        {fixed.map((column) => (
          <li key={column.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
            <input type="checkbox" checked disabled aria-label={`${column.label} is always shown`} />
            {column.label}
            <span style={{ marginLeft: 'auto', fontSize: 'var(--lf-text-2xs)' }}>always</span>
          </li>
        ))}

        {chosen.map((key, index) => (
          <li key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 'var(--lf-text-sm)' }}>
            <input type="checkbox" checked onChange={() => toggle(key)} aria-label={`Hide ${label(key)}`} />
            {label(key)}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
              <button className="lf-toast__action" onClick={() => move(key, -1)} disabled={index === 0} aria-label={`Move ${label(key)} up`}>↑</button>
              <button className="lf-toast__action" onClick={() => move(key, 1)} disabled={index === chosen.length - 1} aria-label={`Move ${label(key)} down`}>↓</button>
            </span>
          </li>
        ))}

        {optional.filter((column) => !chosen.includes(column.key)).map((column) => (
          <li key={column.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
            <input type="checkbox" checked={false} onChange={() => toggle(column.key)} aria-label={`Show ${column.label}`} />
            {column.label}
          </li>
        ))}
      </ul>

      {error && <p style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-2xs)', marginTop: 8 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 'var(--lf-space-3)' }}>
        <button className="lf-btn lf-btn--sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save for workspace'}</button>
        <button className="lf-btn lf-btn--sm lf-btn--secondary" onClick={() => setChosen([])} disabled={busy}>Reset to default</button>
      </div>
      </div>
    </span>
  );
}
