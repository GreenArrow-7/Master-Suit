'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The HR policy editor. Every field here is generated from the registry in
 * `src/services/hr/settings.ts` — the same definitions the server validates
 * against — so a parameter cannot exist in one and be missing from the other.
 *
 * Each field shows its default and can be cleared to return to it, because an
 * admin who has tuned a threshold badly needs a way back that does not depend on
 * remembering what the number used to be.
 */
export type Definition = {
  key: string;
  group: string;
  label: string;
  help: string;
  statutory?: boolean;
} & (
  | { type: 'number'; default: number; min: number; max: number; step?: number; unit?: string }
  | { type: 'boolean'; default: boolean }
  | { type: 'select'; default: string; options: { value: string; label: string }[] }
  | { type: 'days'; default: number[] }
  | { type: 'strings'; default: string[] }
);

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function HrPolicyForm({ endpoint, groups, policy, readOnly }: {
  endpoint: string;
  groups: { key: string; label: string; definitions: Definition[] }[];
  policy: Record<string, unknown>;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, unknown>>(policy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function set(key: string, value: unknown) {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null); setSaved(null);
    try {
      const response = await fetch(`${endpoint}/settings-update`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const fields = Array.isArray(data.errors) ? data.errors.map((issue: { message: string }) => issue.message).join(' ') : '';
        setError(fields || data.detail || 'The policy could not be saved.');
        return;
      }
      setSaved(data.changed?.length ? `Saved ${data.changed.length} change${data.changed.length === 1 ? '' : 's'}.` : 'No changes to save.');
      if (data.policy) setValues(data.policy);
      router.refresh();
    } catch { setError('The server could not be reached.'); }
    finally { setBusy(false); }
  }

  return <form onSubmit={save} style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
    {error && <div className="lf-alert" role="alert">{error}</div>}
    {saved && <div role="status" style={{ color: 'var(--lf-ink-600)' }}>{saved}</div>}

    {groups.map((group) => <section className="lf-card" key={group.key} style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 'var(--lf-space-4)' }}>
      <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>{group.label}</h2>

      {group.definitions.map((definition) => {
        const value = values[definition.key];
        const isDefault = JSON.stringify(value) === JSON.stringify(definition.default);
        return <div key={definition.key} style={{ display: 'grid', gap: 6, paddingBottom: 'var(--lf-space-4)', borderBottom: '1px solid var(--lf-border-subtle)' }}>
          <label htmlFor={definition.key} style={{ fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {definition.label}
            {definition.statutory && <span className="lf-badge" title="This figure has legal weight. Changing it below the statutory minimum is not lawful in the UAE.">statutory</span>}
            {!isDefault && <span className="lf-badge">changed</span>}
          </label>
          <p style={{ margin: 0, color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)', maxWidth: '68ch' }}>{definition.help}</p>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {definition.type === 'number' && <>
              <input
                id={definition.key} className="lf-input" type="number" disabled={readOnly}
                min={definition.min} max={definition.max} step={definition.step ?? 1}
                value={value === undefined || value === null ? '' : String(value)}
                onChange={(event) => set(definition.key, event.target.value === '' ? '' : Number(event.target.value))}
                style={{ maxWidth: 160 }}
              />
              {definition.unit && <span style={{ color: 'var(--lf-ink-500)', fontSize: 'var(--lf-text-sm)' }}>{definition.unit}</span>}
              <span style={{ color: 'var(--lf-ink-500)', fontSize: 'var(--lf-text-xs)' }}>allowed {definition.min}–{definition.max}</span>
            </>}

            {definition.type === 'select' && <select
              id={definition.key} className="lf-input" disabled={readOnly} style={{ maxWidth: 280 }}
              value={String(value ?? definition.default)}
              onChange={(event) => set(definition.key, event.target.value)}
            >{definition.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}

            {definition.type === 'boolean' && <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input id={definition.key} type="checkbox" disabled={readOnly}
                checked={Boolean(value)} onChange={(event) => set(definition.key, event.target.checked)} />
              <span style={{ fontSize: 'var(--lf-text-sm)' }}>{value ? 'On' : 'Off'}</span>
            </label>}

            {definition.type === 'days' && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {DAY_NAMES.map((name, day) => {
                const selected = Array.isArray(value) && (value as number[]).includes(day);
                return <label key={name} style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
                  <input type="checkbox" disabled={readOnly} checked={selected} onChange={(event) => {
                    const current = new Set(Array.isArray(value) ? value as number[] : []);
                    if (event.target.checked) current.add(day); else current.delete(day);
                    set(definition.key, [...current].sort((a, b) => a - b));
                  }} />
                  {name.slice(0, 3)}
                </label>;
              })}
            </div>}

            {definition.type === 'strings' && <input
              id={definition.key} className="lf-input" disabled={readOnly} style={{ maxWidth: 460 }}
              value={Array.isArray(value) ? (value as string[]).join(', ') : String(value ?? '')}
              placeholder="comma separated"
              onChange={(event) => set(definition.key, event.target.value.split(',').map((part) => part.trim()).filter(Boolean))}
            />}

            {!readOnly && !isDefault && <button className="lf-btn lf-btn--ghost" type="button" onClick={() => set(definition.key, definition.default)}>
              Reset to {formatDefault(definition)}
            </button>}
          </div>
        </div>;
      })}
    </section>)}

    {!readOnly && <div style={{ display: 'flex', gap: 10 }}>
      <button className="lf-btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save policy'}</button>
      <button className="lf-btn lf-btn--ghost" type="button" disabled={busy} onClick={() => { setValues(policy); setSaved(null); setError(null); }}>Discard changes</button>
    </div>}
  </form>;
}

function formatDefault(definition: Definition): string {
  if (definition.type === 'days') return (definition.default as number[]).map((day) => DAY_NAMES[day]!.slice(0, 3)).join('/') || 'none';
  if (definition.type === 'strings') return (definition.default as string[]).join(', ') || 'none';
  return String(definition.default);
}
