import { describe, expect, it } from 'vitest';
import { detectColumns, prepareRows } from '@/lib/leads/importMapping';

describe('lead import column detection', () => {
  it('maps customer headers to lead fields and folds the rest into notes', () => {
    const headers = ['Name', 'Mobile Number', 'Email', 'Property', 'Budget', 'Location'];
    expect(detectColumns(headers)).toEqual(['fullName', 'phone', 'email', 'notes+', 'notes+', 'city']);
  });

  it('claims each field once and ignores empty headers', () => {
    expect(detectColumns(['phone', 'Phone', '', 'E-mail'])).toEqual(['phone', 'notes+', 'skip', 'email']);
  });
});

describe('lead import row preparation', () => {
  const headers = ['Name', 'Mobile', 'Email', 'Budget'];
  const mapping = detectColumns(headers);

  it('drops blank rows, reports problems, and marks in-file duplicates', () => {
    const rows = [
      ['Ayesha Khan', '050 123 4567', 'ayesha@example.com', '1.2M'],
      ['', '', '', ''],
      ['', '0501234567', '', ''],
      ['Omar', '12', '', ''],
      ['Sara', '', 'not-an-email', ''],
      ['Ayesha K', '+971501234567', '', '900k'],
    ];
    const prepared = prepareRows(rows, headers, mapping);
    expect(prepared.map((r) => r.line)).toEqual([2, 4, 5, 6, 7]);
    expect(prepared[0]).toEqual({ line: 2, values: { fullName: 'Ayesha Khan', phone: '050 123 4567', email: 'ayesha@example.com', notes: 'Budget: 1.2M' } });
    expect(prepared[1].problem).toBe('Full name is missing');
    expect(prepared[2].problem).toMatch(/Invalid phone/);
    expect(prepared[3].problem).toMatch(/Invalid email/);
    // Same number as line 2 once normalised (+971 50 123 4567).
    expect(prepared[4].duplicateOf).toBe(2);
  });
});
