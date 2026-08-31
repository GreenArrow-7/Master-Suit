'use client';

import type { ReactNode } from 'react';

/**
 * One labelled form field: label, required marker, control, error line.
 *
 * The complaint this exists to end: forms showed no required markers, submits
 * came back as "1 field failed validation", and the person filling the form
 * had no way to know which field. The API has always returned per-field errors
 * — `[{ field, message }]` on every 422 — and every form threw them away and
 * rendered `detail`, which is the generic count.
 *
 * The wrapper carries `data-invalid` so the CSS can paint the control inside
 * without this component reaching into its child; the message carries
 * role="alert" so a screen reader hears it when it appears. The `*` is
 * aria-hidden — the control's own `required` attribute is what assistive tech
 * reads, and hearing "star" adds nothing.
 */
export default function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  /** Mirrors the API schema. Renders the asterisk; the control should also carry `required`. */
  required?: boolean;
  /** The message for THIS field, from useFormErrors. */
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="lf-field" data-invalid={error ? '' : undefined}>
      <label className="lf-label" htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="lf-label__req" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && <span className="lf-field__hint">{hint}</span>}
      {error && (
        <span className="lf-field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
