import { describe, expect, it } from 'vitest';
import { errorKey } from '@/components/forms/useFormErrors';

/**
 * A 422 row lands on the key the form renders its message under. Add lead
 * shows a custom field's error at `custom.<key>`, its control's name; a
 * nested path with no control of its own falls back to its head field.
 */
const formWith = (...names: string[]) =>
  ({ elements: { namedItem: (name: string) => (names.includes(name) ? {} : null) } }) as unknown as HTMLFormElement;

describe('errorKey', () => {
  it('keeps the full path when the form has a control by that name', () => {
    expect(errorKey('custom.emirates_id', formWith('fullName', 'custom.emirates_id'))).toBe('custom.emirates_id');
  });

  it('lands a nested path without its own control on its head field', () => {
    expect(errorKey('address.line1', formWith('address'))).toBe('address');
    expect(errorKey('custom.gone', formWith('fullName'))).toBe('custom');
    expect(errorKey('phone', null)).toBe('phone');
  });
});
