'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface DetectedRequirementView {
  purpose: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  bedroomsMin: number | null;
  bedroomsMax: number | null;
  propertyType: string | null;
  locations: string[];
  timeline: string | null;
  confidence?: number | null;
  evidence?: string | null;
}

const PROPERTY_TYPES = ['APARTMENT', 'VILLA', 'TOWNHOUSE', 'PENTHOUSE', 'PLOT', 'OFFICE', 'RETAIL', 'WAREHOUSE'];

/**
 * What the AI heard on the call, staged for the agent to review. Nothing is
 * written to the CRM until the agent applies it — the spec's rule that critical
 * fields are never silently overwritten. Every field is editable first.
 */
export default function RequirementSuggestion({
  leadId,
  existingRequirementId,
  detected,
}: {
  leadId: string;
  existingRequirementId: string | null;
  detected: DetectedRequirementView;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    purpose: detected.purpose ?? 'BUY',
    budgetMin: detected.budgetMin?.toString() ?? '',
    budgetMax: detected.budgetMax?.toString() ?? '',
    bedroomsMin: detected.bedroomsMin?.toString() ?? '',
    bedroomsMax: detected.bedroomsMax?.toString() ?? '',
    propertyType: detected.propertyType ?? '',
    notes: [
      detected.locations.length ? `Locations mentioned: ${detected.locations.join(', ')}` : '',
      detected.timeline ? `Timeline: ${detected.timeline}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  });

  if (dismissed) return null;

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function apply() {
    setSaving(true);
    setError(null);
    const fields = {
      ...(form.budgetMin !== '' ? { budgetMin: Number(form.budgetMin) } : {}),
      ...(form.budgetMax !== '' ? { budgetMax: Number(form.budgetMax) } : {}),
      ...(form.bedroomsMin !== '' ? { bedroomsMin: Number(form.bedroomsMin) } : {}),
      ...(form.bedroomsMax !== '' ? { bedroomsMax: Number(form.bedroomsMax) } : {}),
      ...(form.propertyType ? { propertyTypes: [form.propertyType] } : {}),
      ...(form.notes ? { notes: form.notes } : {}),
    };
    const res = existingRequirementId
      ? await fetch(`/api/v1/requirements/${existingRequirementId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(fields),
        })
      : await fetch('/api/v1/requirements', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ leadId, purpose: form.purpose, ...fields }),
        });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? 'Could not save the requirement.');
    }
  }

  const num = (label: string, key: 'budgetMin' | 'budgetMax' | 'bedroomsMin' | 'bedroomsMax') => (
    <label style={{ display: 'grid', gap: 2, fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
      {label}
      <input className="lf-input" type="number" value={form[key]} onChange={set(key)} disabled={saved} />
    </label>
  );

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-2)' }}>
        AI detected — suggested CRM update
      </div>
      <p style={{ margin: '0 0 var(--lf-space-3)', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
        Heard on this call. Review and edit before applying — nothing is saved to the{' '}
        {existingRequirementId ? 'requirement' : 'lead'} until you apply it.
      </p>
      {(detected.evidence || detected.confidence != null) && (
        <p style={{ margin: '0 0 var(--lf-space-3)', fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
          {detected.evidence && (
            <>
              Heard as: <em>“{detected.evidence}”</em>
            </>
          )}
          {detected.confidence != null && (
            <span style={{ marginLeft: detected.evidence ? 8 : 0 }}>
              · {Math.round(detected.confidence * 100)}% confidence
            </span>
          )}
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--lf-space-2)' }}>
        {!existingRequirementId && (
          <label style={{ display: 'grid', gap: 2, fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
            Purpose
            <select className="lf-input" value={form.purpose} onChange={set('purpose')} disabled={saved}>
              <option value="BUY">Buy</option>
              <option value="RENT">Rent</option>
            </select>
          </label>
        )}
        <label style={{ display: 'grid', gap: 2, fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
          Property type
          <select className="lf-input" value={form.propertyType} onChange={set('propertyType')} disabled={saved}>
            <option value="">—</option>
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        {num('Budget min', 'budgetMin')}
        {num('Budget max', 'budgetMax')}
        {num('Bedrooms min', 'bedroomsMin')}
        {num('Bedrooms max', 'bedroomsMax')}
      </div>

      <label
        style={{
          display: 'grid',
          gap: 2,
          fontSize: 'var(--lf-text-xs)',
          color: 'var(--lf-ink-3)',
          marginTop: 'var(--lf-space-2)',
        }}
      >
        Notes
        <textarea className="lf-input" rows={2} value={form.notes} onChange={set('notes')} disabled={saved} />
      </label>

      <div style={{ display: 'flex', gap: 'var(--lf-space-2)', alignItems: 'center', marginTop: 'var(--lf-space-3)' }}>
        {saved ? (
          <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-viridian, #16a34a)' }}>
            Applied to the CRM.
          </span>
        ) : (
          <>
            <button type="button" className="lf-btn lf-btn--sm" onClick={apply} disabled={saving}>
              {saving ? 'Saving…' : existingRequirementId ? 'Update requirement' : 'Create requirement'}
            </button>
            <button type="button" className="lf-btn lf-btn--sm lf-btn--secondary" onClick={() => setDismissed(true)}>
              Reject
            </button>
          </>
        )}
        {error && <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-vermillion)' }}>{error}</span>}
      </div>
    </section>
  );
}
