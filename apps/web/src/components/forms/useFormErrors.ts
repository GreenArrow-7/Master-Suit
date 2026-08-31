'use client';

import { useCallback, useState } from 'react';

/**
 * Per-field validation state for a hand-rolled form.
 *
 * Three jobs, all from the same complaint ("the system says one field is
 * required and I cannot tell which"):
 *
 *   1. `validateRequired` checks the form's own `[required]` controls before
 *      the network round trip, writing a message per empty field. Forms here
 *      set `noValidate` — the design system supplies the error presentation,
 *      not the browser's bubble — which previously meant no pre-submit check
 *      at all.
 *   2. `applyProblem` reads the per-field list the API has always returned on
 *      a 422 (`errors: [{ field, message }]` — see lib/errors.ts `Invalid`)
 *      instead of the generic `detail` count every form was showing.
 *   3. `clear(field)` removes a field's error the moment it is edited, so the
 *      red state does not outlive the correction.
 *
 * Both validate paths focus the first offending control, which also scrolls
 * it into view — on a phone the failed field is often off-screen.
 */

interface ProblemLike {
  detail?: string;
  errors?: { field?: string; message?: string }[];
}

/** The label text for a control, for "<Label> is required." messages. */
function labelFor(control: HTMLElement): string {
  const field = control.closest('.lf-field');
  const label = field?.querySelector('label');
  const text = (label?.textContent ?? '').replace(/\s*\*\s*$/, '').trim();
  return text || 'This field';
}

function focusControl(form: HTMLFormElement | null, name: string) {
  if (!form) return;
  const control = form.querySelector<HTMLElement>(`[name="${name}"], #${CSS.escape(name)}`);
  if (control) {
    control.focus({ preventScroll: false });
    control.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

/**
 * The problem document as sentences that name their fields, for forms still on
 * a single banner: "1 field failed validation" becomes "Phone number is
 * required." A stop-gap next to the full per-field treatment in Field.tsx —
 * it names the field, which is what the complaint was — until each form is
 * migrated.
 */
export function problemSummary(data: ProblemLike, fallback: string): string {
  const rows = (data.errors ?? []).filter((row) => row.field && row.message);
  if (!rows.length) return data.detail ?? fallback;
  return rows
    .map((row) => {
      const label = row
        .field!.split('.')[0]!
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase();
      const capitalised = label.charAt(0).toUpperCase() + label.slice(1);
      // Zod's bare "Required" earns the field name; richer messages keep it too.
      return `${capitalised}: ${row.message}`;
    })
    .join(' ');
}

export function useFormErrors() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setFieldErrors({});
    setFormError(null);
  }, []);

  const clear = useCallback((field: string) => {
    setFieldErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }, []);

  /** True when every `[required]` control has a value; writes errors otherwise. */
  const validateRequired = useCallback((form: HTMLFormElement): boolean => {
    const missing: Record<string, string> = {};
    let first: string | null = null;
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[required]').forEach((el) => {
      if (el.disabled || el.value.trim() !== '') return;
      const key = el.name || el.id;
      if (!key) return;
      missing[key] = `${labelFor(el)} is required.`;
      first ??= key;
    });
    if (first) {
      setFieldErrors((current) => ({ ...current, ...missing }));
      focusControl(form, first);
      return false;
    }
    return true;
  }, []);

  /**
   * Maps a 422 problem document onto fields. Returns true when at least one
   * error landed on a field; false means the caller should show `detail` as a
   * form-level message instead (a conflict, a rate limit, a plain failure).
   */
  const applyProblem = useCallback((data: ProblemLike, form?: HTMLFormElement | null): boolean => {
    const rows = (data.errors ?? []).filter((row) => row.field && row.message);
    if (!rows.length) {
      setFormError(data.detail ?? 'That did not work.');
      return false;
    }
    const mapped: Record<string, string> = {};
    for (const row of rows) {
      // Nested paths ("custom.budget") land on their head field.
      const key = row.field!.split('.')[0]!;
      if (!(key in mapped)) mapped[key] = row.message!;
    }
    setFieldErrors(mapped);
    setFormError(null);
    focusControl(form ?? null, rows[0]!.field!.split('.')[0]!);
    return true;
  }, []);

  return { fieldErrors, formError, setFormError, reset, clear, validateRequired, applyProblem };
}
