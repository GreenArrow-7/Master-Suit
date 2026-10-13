'use client';

import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Field from '@/components/forms/Field';
import { send, useRun } from '@/components/forms/useRun';

interface CustomField {
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[];
  isRequired: boolean;
  isActive: boolean;
  displayOrder: number;
}

const API = '/api/v1/custom-fields';
/** The four kinds offered (M4-13), by the enum the API takes. */
export const FIELD_TYPES = [
  ['TEXT', 'Text'],
  ['NUMBER', 'Number'],
  ['DATE', 'Date'],
  ['DROPDOWN', 'Select'],
] as const;
const typeLabel = (type: string) => FIELD_TYPES.find(([key]) => key === type)?.[1] ?? type;
/** "Resident, Visit, Golden" ⇄ the options list. */
const splitOptions = (text: string) =>
  text
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

export default function FieldEditor({ canEdit, fields }: { canEdit: boolean; fields: CustomField[] }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-3)' }}>
      {fields.length === 0 && (
        <p className="lf-card" style={{ padding: 'var(--lf-space-4)', margin: 0, color: 'var(--lf-ink-3)' }}>
          No custom fields yet.
        </p>
      )}
      {fields.map((field) => (
        <FieldRow key={field.id} field={field} canEdit={canEdit} />
      ))}
      {canEdit && <NewField />}
    </div>
  );
}

function FieldRow({ field, canEdit }: { field: CustomField; canEdit: boolean }) {
  const { busy, run, note } = useRun();
  const start = {
    label: field.label,
    options: field.options.join(', '),
    isRequired: field.isRequired,
    isActive: field.isActive,
    displayOrder: String(field.displayOrder),
  };
  const [form, setForm] = useState(start);
  const dirty = JSON.stringify(form) !== JSON.stringify(start);
  const select = field.type === 'DROPDOWN';
  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-4)' }} aria-label={`Field ${field.label}`}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {canEdit ? (
          <input
            className="lf-input"
            aria-label={`Label of ${field.label}`}
            value={form.label}
            maxLength={60}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            style={{ flex: '1 1 160px', minWidth: 0, fontWeight: 600 }}
          />
        ) : (
          <span style={{ flex: '1 1 160px', fontWeight: 600 }}>{field.label}</span>
        )}
        <Badge tone="slate">{typeLabel(field.type)}</Badge>
        <span style={{ fontFamily: 'var(--lf-font-mono)', fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
          {field.key}
        </span>
        {!canEdit && field.isRequired && <Badge tone="slate">Required</Badge>}
        {!canEdit && !field.isActive && <Badge tone="slate">Switched off</Badge>}
      </div>
      {select && !canEdit && (
        <p style={{ margin: '6px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
          {field.options.join(' · ')}
        </p>
      )}
      {canEdit && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--lf-space-3)',
            flexWrap: 'wrap',
            alignItems: 'center',
            marginTop: 'var(--lf-space-3)',
            fontSize: 'var(--lf-text-sm)',
          }}
        >
          {select && (
            <input
              className="lf-input"
              aria-label={`Options of ${field.label}, comma-separated`}
              value={form.options}
              onChange={(e) => setForm((f) => ({ ...f, options: e.target.value }))}
              style={{ flex: '1 1 220px', minWidth: 0 }}
            />
          )}
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            Order
            <input
              className="lf-input"
              type="number"
              min={0}
              max={1000}
              aria-label={`Order of ${field.label}`}
              value={form.displayOrder}
              onChange={(e) => setForm((f) => ({ ...f, displayOrder: e.target.value }))}
              style={{ width: 72 }}
            />
          </label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={form.isRequired}
              onChange={(e) => setForm((f) => ({ ...f, isRequired: e.target.checked }))}
            />
            Required
          </label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Shown on leads
          </label>
          <button
            className="lf-btn lf-btn--sm"
            disabled={busy || !dirty || !form.label.trim()}
            onClick={() =>
              run(
                () =>
                  send(`${API}?id=${field.id}`, 'PATCH', {
                    label: form.label.trim(),
                    isRequired: form.isRequired,
                    isActive: form.isActive,
                    displayOrder: Number(form.displayOrder) || 0,
                    ...(select && { options: splitOptions(form.options) }),
                  }),
                'Saved.',
              )
            }
          >
            Save
          </button>
        </div>
      )}
      {note}
    </section>
  );
}

function NewField() {
  const { busy, run, note } = useRun();
  const blank = { label: '', key: '', type: 'TEXT', options: '', isRequired: false };
  const [form, setForm] = useState(blank);
  return (
    <form
      className="lf-card"
      style={{ padding: 'var(--lf-space-4)', display: 'grid', gap: 'var(--lf-space-3)' }}
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await send(API, 'POST', {
            label: form.label.trim(),
            type: form.type,
            isRequired: form.isRequired,
            ...(form.key.trim() && { key: form.key.trim() }),
            ...(form.type === 'DROPDOWN' && { options: splitOptions(form.options) }),
          });
          setForm(blank);
        }, 'Added.');
      }}
    >
      <div className="lf-eyebrow">New field</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 'var(--lf-space-3)',
        }}
      >
        <Field label="Label" htmlFor="new-field-label" required>
          <input
            id="new-field-label"
            className="lf-input"
            required
            maxLength={60}
            placeholder="e.g. Visa status"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          />
        </Field>
        <Field label="Type" htmlFor="new-field-type">
          <select
            id="new-field-type"
            className="lf-input"
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
          >
            {FIELD_TYPES.map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Key (optional)" htmlFor="new-field-key">
          <input
            id="new-field-key"
            className="lf-input"
            maxLength={40}
            placeholder="From the label"
            pattern="[a-z][a-z0-9_]*"
            value={form.key}
            onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
          />
        </Field>
      </div>
      {form.type === 'DROPDOWN' && (
        <Field label="Options, comma-separated" htmlFor="new-field-options" required>
          <input
            id="new-field-options"
            className="lf-input"
            required
            placeholder="e.g. Resident, Visit, Golden"
            value={form.options}
            onChange={(e) => setForm((f) => ({ ...f, options: e.target.value }))}
          />
        </Field>
      )}
      <div style={{ display: 'flex', gap: 'var(--lf-space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 'var(--lf-text-sm)' }}>
          <input
            type="checkbox"
            checked={form.isRequired}
            onChange={(e) => setForm((f) => ({ ...f, isRequired: e.target.checked }))}
          />
          Required
        </label>
        <button className="lf-btn lf-btn--secondary lf-btn--sm" disabled={busy || !form.label.trim()}>
          Add field
        </button>
      </div>
      {note}
    </form>
  );
}
