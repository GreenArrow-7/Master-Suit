'use client';

import DateInput from '@/components/forms/DateInput';
import type { LeadField } from '@/services/leads/customFields';

/**
 * A custom field's control, by its type (M4-13), on the lead's Overview and
 * the Add lead form; the server checks the value again.
 */
export default function CustomFieldInput({
  field,
  value,
  onChange,
  id,
}: {
  field: LeadField;
  value: string;
  onChange: (v: string) => void;
  /** Also the control's `name`, so a form's label and its 422 reach it. */
  id?: string;
}) {
  const common = {
    id,
    name: id,
    'aria-label': id ? undefined : field.label,
    required: field.isRequired,
    style: { width: '100%', fontSize: 'var(--lf-text-sm)' },
  };
  if (field.type === 'DATE') return <DateInput {...common} value={value} onChange={onChange} />;
  if (field.type === 'DROPDOWN') {
    return (
      <select className="lf-input" {...common} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className="lf-input"
      {...common}
      type={field.type === 'NUMBER' ? 'number' : 'text'}
      step={field.type === 'NUMBER' ? 'any' : undefined}
      maxLength={500}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
