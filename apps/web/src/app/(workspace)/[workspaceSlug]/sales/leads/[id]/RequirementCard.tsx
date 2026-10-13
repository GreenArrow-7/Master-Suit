'use client';

import { useState } from 'react';
import DateInput from '@/components/forms/DateInput';
import Field from '@/components/forms/Field';
import { send, useRun } from '@/components/forms/useRun';
import SalesLink from '@/components/workspace/SalesLink';
import { formatTypedDate } from '@/lib/dates';
import type { LeadRequirement } from '@/services/leads/requirement';

const PROPERTY_TYPES = ['APARTMENT', 'VILLA', 'TOWNHOUSE', 'PENTHOUSE', 'PLOT', 'OFFICE', 'RETAIL', 'WAREHOUSE'];
const named = (word: string) => word.charAt(0) + word.slice(1).toLowerCase();
const aed = (n: number | null) => (n == null ? null : n.toLocaleString('en-GB'));
/** "AED 1,500,000 – 2,500,000", "Up to AED 120,000"; null when no budget is stated. */
const band = (min: number | null, max: number | null, currency: string) =>
  min == null && max == null
    ? null
    : min == null
      ? `Up to ${currency} ${aed(max)}`
      : max == null
        ? `From ${currency} ${aed(min)}`
        : `${currency} ${aed(min)} – ${aed(max)}`;
/** "1,500,000" ⇄ 1500000; '' is none. */
const amount = (text: string) => (text.trim() ? Number(text.replace(/,/g, '')) : null);

/**
 * What the lead's client is looking for (M4-05, M4-08), on its Overview:
 * purpose, type and sub-type, bedrooms, budget in AED, areas and the date they
 * need it by, as the workspace's calendar reads it. Saving sends the whole
 * requirement; a different purpose starts a new one beside the old.
 */
export default function RequirementCard({
  leadId,
  requirement,
  canEdit,
  matchesHref,
}: {
  leadId: string;
  requirement: LeadRequirement | null;
  canEdit: boolean;
  /** The requirement's page, with the listings that match it, when the viewer may open it. */
  matchesHref: string | null;
}) {
  const { busy, run, note } = useRun();
  const [editing, setEditing] = useState(false);
  const start = {
    purpose: requirement?.purpose ?? 'BUY',
    propertyTypes: requirement?.propertyTypes ?? [],
    subType: requirement?.subType ?? '',
    bedroomsMin: requirement?.bedroomsMin?.toString() ?? '',
    bedroomsMax: requirement?.bedroomsMax?.toString() ?? '',
    budgetMin: requirement?.budgetMin?.toString() ?? '',
    budgetMax: requirement?.budgetMax?.toString() ?? '',
    locations: requirement?.locations.join(', ') ?? '',
    possessionBy: requirement?.possessionBy ?? '',
    notes: requirement?.notes ?? '',
  };
  const [form, setForm] = useState(start);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const beds = (min: number | null, max: number | null) =>
    min == null && max == null ? null : min === max ? String(min) : `${min ?? 'Any'}–${max ?? 'more'}`;
  const facts: [string, string | null][] = requirement
    ? [
        ['Looking to', requirement.purpose === 'RENT' ? 'Rent' : 'Buy'],
        [
          'Property',
          [requirement.propertyTypes.map(named).join(', '), requirement.subType].filter(Boolean).join(' · ') || null,
        ],
        ['Bedrooms', beds(requirement.bedroomsMin, requirement.bedroomsMax)],
        ['Budget', band(requirement.budgetMin, requirement.budgetMax, requirement.currency)],
        ['Areas', requirement.locations.join(', ') || null],
        ['Needed by', requirement.possessionBy ? formatTypedDate(requirement.possessionBy) : null],
        ['Notes', requirement.notes],
      ]
    : [];

  const save = () =>
    run(async () => {
      await send(`/api/v1/leads/${leadId}/requirement`, 'PUT', {
        purpose: form.purpose,
        propertyTypes: form.propertyTypes,
        subType: form.subType.trim() || null,
        bedroomsMin: amount(form.bedroomsMin),
        bedroomsMax: amount(form.bedroomsMax),
        budgetMin: amount(form.budgetMin),
        budgetMax: amount(form.budgetMax),
        locations: form.locations
          .split(',')
          .map((place) => place.trim())
          .filter(Boolean),
        possessionBy: form.possessionBy || null,
        notes: form.notes.trim() || null,
      });
      setEditing(false);
    }, 'Requirement saved.');

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }} aria-label="Requirement">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 'var(--lf-space-4)',
        }}
      >
        <div className="lf-eyebrow">Requirement</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {requirement && matchesHref && !editing && (
            <SalesLink className="lf-btn lf-btn--ghost lf-btn--sm" href={matchesHref}>
              Matching listings
            </SalesLink>
          )}
          {canEdit && !editing && (
            <button
              className="lf-btn lf-btn--secondary lf-btn--sm"
              onClick={() => {
                setForm(start);
                setEditing(true);
              }}
            >
              {requirement ? 'Edit requirement' : 'Add requirement'}
            </button>
          )}
        </div>
      </div>

      {!editing &&
        (requirement ? (
          <dl className="lf-facts" style={{ margin: 0 }}>
            {facts
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt className="lf-label">{label}</dt>
                  <dd style={{ margin: '3px 0 0', fontSize: 'var(--lf-text-sm)', overflowWrap: 'anywhere' }}>
                    {value}
                  </dd>
                </div>
              ))}
          </dl>
        ) : (
          <p style={{ margin: 0, fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            Nothing recorded about what they are looking for.
          </p>
        ))}

      {editing && (
        <form
          style={{ display: 'grid', gap: 'var(--lf-space-3)' }}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 'var(--lf-space-3)',
            }}
          >
            <Field label="Looking to" htmlFor="req-purpose">
              <select
                id="req-purpose"
                className="lf-input"
                value={form.purpose}
                onChange={(e) => set({ purpose: e.target.value as 'BUY' | 'RENT' })}
              >
                <option value="BUY">Buy</option>
                <option value="RENT">Rent</option>
              </select>
            </Field>
            <Field label="Sub-type" htmlFor="req-subtype">
              <input
                id="req-subtype"
                className="lf-input"
                maxLength={80}
                placeholder="e.g. Duplex"
                value={form.subType}
                onChange={(e) => set({ subType: e.target.value })}
              />
            </Field>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="lf-label">Property type</legend>
            <div style={{ display: 'flex', gap: '6px 14px', flexWrap: 'wrap', marginTop: 4 }}>
              {PROPERTY_TYPES.map((type) => (
                <label
                  key={type}
                  style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}
                >
                  <input
                    type="checkbox"
                    checked={form.propertyTypes.includes(type)}
                    onChange={(e) =>
                      set({
                        propertyTypes: e.target.checked
                          ? [...form.propertyTypes, type]
                          : form.propertyTypes.filter((t) => t !== type),
                      })
                    }
                  />
                  {named(type)}
                </label>
              ))}
            </div>
          </fieldset>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 'var(--lf-space-3)',
            }}
          >
            <Field label="Bedrooms from" htmlFor="req-beds-min">
              <input
                id="req-beds-min"
                className="lf-input"
                type="number"
                min={0}
                max={50}
                value={form.bedroomsMin}
                onChange={(e) => set({ bedroomsMin: e.target.value })}
              />
            </Field>
            <Field label="Bedrooms to" htmlFor="req-beds-max">
              <input
                id="req-beds-max"
                className="lf-input"
                type="number"
                min={0}
                max={50}
                value={form.bedroomsMax}
                onChange={(e) => set({ bedroomsMax: e.target.value })}
              />
            </Field>
            <Field label="Budget from (AED)" htmlFor="req-budget-min">
              <input
                id="req-budget-min"
                className="lf-input"
                inputMode="numeric"
                value={form.budgetMin}
                onChange={(e) => set({ budgetMin: e.target.value })}
              />
            </Field>
            <Field label="Budget to (AED)" htmlFor="req-budget-max">
              <input
                id="req-budget-max"
                className="lf-input"
                inputMode="numeric"
                value={form.budgetMax}
                onChange={(e) => set({ budgetMax: e.target.value })}
              />
            </Field>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 'var(--lf-space-3)',
            }}
          >
            <Field label="Areas, comma-separated" htmlFor="req-areas">
              <input
                id="req-areas"
                className="lf-input"
                placeholder="e.g. Dubai Marina, JLT"
                value={form.locations}
                onChange={(e) => set({ locations: e.target.value })}
              />
            </Field>
            <Field label="Needed by" htmlFor="req-possession">
              <DateInput
                id="req-possession"
                value={form.possessionBy}
                onChange={(possessionBy) => set({ possessionBy })}
              />
            </Field>
          </div>
          <Field label="Notes" htmlFor="req-notes">
            <textarea
              id="req-notes"
              className="lf-input"
              rows={2}
              maxLength={4000}
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </Field>
          <div style={{ display: 'flex', gap: 'var(--lf-space-2)' }}>
            <button className="lf-btn lf-btn--sm" disabled={busy}>
              {busy ? 'Saving…' : 'Save requirement'}
            </button>
            <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {note}
    </section>
  );
}
