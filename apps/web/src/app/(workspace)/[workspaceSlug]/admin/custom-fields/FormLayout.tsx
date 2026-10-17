'use client';

import { useState } from 'react';
import { send, useRun } from '@/components/forms/useRun';
import type { LayoutField } from '@/lib/leads/formLayout';

/**
 * The Add lead form's order and hidden fields (M18-04): up and down buttons and
 * a Shown box per field, saved whole. Full name always comes first; the phone
 * and the source are always shown.
 */
export default function FormLayout({ fields, canEdit }: { fields: LayoutField[]; canEdit: boolean }) {
  const { busy, run, note } = useRun();
  const [rows, setRows] = useState(fields);
  const dirty = JSON.stringify(rows) !== JSON.stringify(fields);
  const move = (index: number, by: number) =>
    setRows((current) => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by]!, next[index]!];
      return next;
    });

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-4)' }} aria-label="Lead form layout">
      <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-2)' }}>
        Lead form
      </div>
      <p className="lf-hint" style={{ margin: '0 0 var(--lf-space-3)' }}>
        The order of the Add lead form after Full name. A hidden field leaves the form and the lead&apos;s Details card;
        values already on leads are kept. Custom fields follow these, in their own order.
      </p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {rows.map((field, index) => (
          <li key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 140px', minWidth: 0, color: field.hidden ? 'var(--lf-ink-3)' : undefined }}>
              {field.label}
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--lf-text-sm)' }}>
              <input
                type="checkbox"
                checked={!field.hidden}
                disabled={!canEdit || field.fixed}
                onChange={(e) =>
                  setRows((current) =>
                    current.map((row) => (row.key === field.key ? { ...row, hidden: !e.target.checked } : row)),
                  )
                }
              />
              Shown
            </label>
            {canEdit && (
              <span style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  className="lf-btn lf-btn--ghost lf-btn--sm"
                  aria-label={`Move ${field.label} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="lf-btn lf-btn--ghost lf-btn--sm"
                  aria-label={`Move ${field.label} down`}
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {canEdit && (
        <div style={{ marginTop: 'var(--lf-space-3)' }}>
          <button
            className="lf-btn lf-btn--sm"
            disabled={busy || !dirty}
            onClick={() =>
              run(
                () =>
                  send('/api/v1/lead-form-layout', 'PUT', {
                    fields: rows.map(({ key, hidden }) => ({ key, hidden })),
                  }),
                'Saved.',
              )
            }
          >
            {busy ? 'Saving…' : 'Save layout'}
          </button>
          {note}
        </div>
      )}
    </section>
  );
}
