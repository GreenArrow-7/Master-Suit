'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useModuleBase } from '@/components/workspace/SalesLink';

type Field = { key: string; label: string; kept: string; other: string; choosable: boolean };

/**
 * One row per field, the two leads' values side by side (stacked on a phone):
 * where they differ, the person picks the one that stays. A value only the
 * other lead has is picked for them; nothing is ever blanked.
 */
export default function MergeForm({
  keptId,
  otherId,
  keptRef,
  otherRef,
  fields,
}: {
  keptId: string;
  otherId: string;
  keptRef: string;
  otherRef: string;
  fields: Field[];
}) {
  const router = useRouter();
  const base = useModuleBase();
  const offered = (field: Field) => field.choosable && !!field.other && field.other !== field.kept;
  const [take, setTake] = useState(() => new Set(fields.filter((f) => offered(f) && !f.kept).map((f) => f.key)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function merge() {
    setBusy(true);
    setError('');
    const res = await fetch(`/api/v1/leads/${keptId}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ otherId, take: [...take] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(data.detail ?? data.title ?? `The leads could not be merged (HTTP ${res.status}).`);
      return;
    }
    router.push(`${base}/leads/${keptId}`);
    router.refresh();
  }

  const pick = (key: string, fromOther: boolean) =>
    setTake((current) => {
      const next = new Set(current);
      if (fromOther) next.add(key);
      else next.delete(key);
      return next;
    });

  const option = (field: Field, fromOther: boolean) => {
    const value = fromOther ? field.other : field.kept;
    const chosen = take.has(field.key) === fromOther;
    return (
      <label
        style={{
          display: 'flex',
          gap: 'var(--lf-space-2)',
          alignItems: 'flex-start',
          padding: 'var(--lf-space-2) var(--lf-space-3)',
          border: `1px solid ${chosen ? 'var(--lf-ink-3)' : 'var(--lf-line)'}`,
          borderRadius: 'var(--lf-radius-sm)',
          background: chosen ? 'var(--lf-surface-2)' : 'transparent',
          minWidth: 0,
        }}
      >
        <input
          type="radio"
          name={field.key}
          checked={chosen}
          disabled={busy || (fromOther && !offered(field))}
          onChange={() => pick(field.key, fromOther)}
          aria-label={`${field.label} from ${fromOther ? otherRef : keptRef}`}
        />
        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <span style={{ display: 'block', fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>
            {fromOther ? otherRef : keptRef}
          </span>
          {value || <em style={{ color: 'var(--lf-ink-3)' }}>none</em>}
        </span>
      </label>
    );
  };

  return (
    <div className="lf-card" style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
      {fields.map((field) => (
        <fieldset key={field.key} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <legend style={{ fontSize: 'var(--lf-text-sm)', fontWeight: 600, marginBottom: 'var(--lf-space-1)' }}>
            {field.label}
          </legend>
          {offered(field) ? (
            <div
              style={{
                display: 'grid',
                gap: 'var(--lf-space-2)',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              }}
            >
              {option(field, false)}
              {option(field, true)}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 'var(--lf-text-sm)', overflowWrap: 'anywhere' }}>
              {field.kept || <em style={{ color: 'var(--lf-ink-3)' }}>none</em>}
              {!field.choosable && field.other && field.other !== field.kept && (
                <span style={{ color: 'var(--lf-ink-3)' }}> ({keptRef}’s stays: your role cannot change it)</span>
              )}
            </p>
          )}
        </fieldset>
      ))}
      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-sm)' }}>
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
        <button className="lf-btn lf-btn--sm" disabled={busy} onClick={() => void merge()}>
          {busy ? 'Merging…' : `Merge into ${keptRef}`}
        </button>
      </div>
    </div>
  );
}
