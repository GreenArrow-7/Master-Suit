'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FURNISHINGS, LISTING_STATUSES, LISTING_TYPES, PROPERTY_TYPES } from '@/lib/inventory/listings';

/**
 * The same URL-driven facet bar the project catalogue uses.
 *
 * Everything is in the query string so a narrowed book can be sent to a
 * colleague, kept in a tab, and reached with the back button.
 */
export default function ListingFilters({
  micromarkets,
}: {
  micromarkets: { id: string; name: string; city: string }[];
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
            placeholder="Listing title"
            defaultValue={value('q')}
            onBlur={(e) => set('q', e.target.value.trim() || null)}
            onKeyDown={(e) => e.key === 'Enter' && set('q', (e.target as HTMLInputElement).value.trim() || null)}
          />
        </Field>

        <Field label="For">
          <select
            className="lf-select"
            value={value('listingType')}
            onChange={(e) => set('listingType', e.target.value || null)}
          >
            <option value="">Sale or rent</option>
            {LISTING_TYPES.map((t) => (
              <option key={t} value={t}>
                {title(t)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Property">
          <select
            className="lf-select"
            value={value('propertyType')}
            onChange={(e) => set('propertyType', e.target.value || null)}
          >
            <option value="">Any</option>
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {title(t)}
              </option>
            ))}
          </select>
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

        <Field label="Status">
          <select className="lf-select" value={value('status')} onChange={(e) => set('status', e.target.value || null)}>
            <option value="">Any</option>
            {LISTING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {title(s)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Furnishing">
          <select
            className="lf-select"
            value={value('furnishing')}
            onChange={(e) => set('furnishing', e.target.value || null)}
          >
            <option value="">Any</option>
            {FURNISHINGS.map((f) => (
              <option key={f} value={f}>
                {title(f)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Beds from">
          <input
            className="lf-input"
            type="number"
            min={0}
            max={50}
            style={{ width: 100 }}
            placeholder="Any"
            defaultValue={value('bedroomsMin')}
            onBlur={(e) => set('bedroomsMin', e.target.value || null)}
          />
        </Field>

        <Field label="Price up to">
          <input
            className="lf-input"
            type="number"
            min={0}
            step={50000}
            style={{ width: 140 }}
            placeholder="Any"
            defaultValue={value('maxPrice')}
            onBlur={(e) => set('maxPrice', e.target.value || null)}
          />
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        <Toggle
          label="Marketable only"
          on={value('marketableOnly') === 'true'}
          onChange={(v) => set('marketableOnly', v ? 'true' : null)}
        />
        <Toggle label="Mine" on={value('mine') === 'true'} onChange={(v) => set('mine', v ? 'true' : null)} />
        <Toggle
          label="Mandate ending in 30 days"
          on={value('expiringWithinDays') === '30'}
          onChange={(v) => set('expiringWithinDays', v ? '30' : null)}
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
