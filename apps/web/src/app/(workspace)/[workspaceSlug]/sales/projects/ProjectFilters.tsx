'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { POSSESSION_STATUSES, PROJECT_STATUSES } from '@/lib/inventory/catalogue';

/**
 * The facet bar.
 *
 * Every control writes to the URL and nothing else. A salesperson who has
 * narrowed to "Dubai Marina, ready to move, under 2M" wants to send that to a
 * colleague or keep it open in a tab — both of which need the query in the
 * address bar, not in a component's state. It also means the back button does
 * what a user expects, which client-held filter state never manages.
 */
export default function ProjectFilters({
  micromarkets,
  developers,
}: {
  micromarkets: { id: string; name: string; city: string }[];
  developers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value: string | null) {
    // Blur commits unconditionally, so tabbing through untouched inputs was a
    // fresh server render per field. Same value → no navigation.
    if ((params.get(key) ?? '') === (value ?? '')) return;
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  }

  const value = (key: string) => params.get(key) ?? '';
  const active = [...params.keys()].filter((k) => params.get(k)).length > 0;

  return (
    <div className="lf-card" style={{ padding: 14, marginBottom: 'var(--lf-space-4)' }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Search">
          <input
            className="lf-input"
            type="search"
            placeholder="Project name"
            defaultValue={value('q')}
            // Committed on blur or Enter rather than per keystroke: each change is
            // a server round trip and a history entry.
            onBlur={(e) => set('q', e.target.value.trim() || null)}
            onKeyDown={(e) => e.key === 'Enter' && set('q', (e.target as HTMLInputElement).value.trim() || null)}
          />
        </Field>

        <Field label="Micromarket">
          <select
            className="lf-select"
            value={value('micromarket')}
            onChange={(e) => set('micromarket', e.target.value || null)}
          >
            <option value="">Any</option>
            {micromarkets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}, {m.city}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Developer">
          <select
            className="lf-select"
            value={value('developer')}
            onChange={(e) => set('developer', e.target.value || null)}
          >
            <option value="">Any</option>
            {developers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Possession">
          <select
            className="lf-select"
            value={value('possession')}
            onChange={(e) => set('possession', e.target.value || null)}
          >
            <option value="">Any</option>
            {POSSESSION_STATUSES.map((p) => (
              <option key={p} value={p}>
                {title(p)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Status">
          <select className="lf-select" value={value('status')} onChange={(e) => set('status', e.target.value || null)}>
            <option value="">Any</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {title(s)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Budget up to">
          <input
            className="lf-input"
            type="number"
            min={0}
            step={100000}
            style={{ width: 140 }}
            placeholder="Any"
            defaultValue={value('maxPrice')}
            onBlur={(e) => set('maxPrice', e.target.value || null)}
          />
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        <Toggle
          label="Available only"
          on={value('availableOnly') === 'true'}
          onChange={(v) => set('availableOnly', v ? 'true' : null)}
        />
        <Toggle
          label="Priority"
          on={value('priority') === 'true'}
          onChange={(v) => set('priority', v ? 'true' : null)}
        />
        <Toggle
          label="My favourites"
          on={value('favourites') === 'true'}
          onChange={(v) => set('favourites', v ? 'true' : null)}
        />

        {active && (
          <button type="button" className="lf-btn lf-btn--ghost lf-btn--sm" onClick={() => router.push(pathname)}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="lf-field" style={{ margin: 0 }}>
      <span className="lf-label">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--lf-text-sm)' }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const title = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');
