import { describe, expect, it } from 'vitest';
import { dateProblem, formatTypedDate, parseTypedDate, toDateValue, toTimeValue } from '@/lib/dates';

/** The shared date field's rules: what a person may type, and what the form submits. */
describe('typed dates', () => {
  it('reads day first, whatever the separator, and 8 digits from a phone keypad', () => {
    expect(parseTypedDate('10/08/2026')).toBe('2026-08-10');
    expect(parseTypedDate('1/8/2026')).toBe('2026-08-01');
    expect(parseTypedDate('10-08-2026')).toBe('2026-08-10');
    expect(parseTypedDate('10.08.2026')).toBe('2026-08-10');
    expect(parseTypedDate('10082026')).toBe('2026-08-10');
    expect(parseTypedDate(' 2026-08-10 ')).toBe('2026-08-10');
  });

  it('refuses dates the calendar does not have, and implausible years', () => {
    for (const bad of [
      '31/04/2026',
      '29/02/2027',
      '00/01/2026',
      '12/13/2026',
      '10/10/26',
      '10/10/0026',
      '1/1/20226',
      'tomorrow',
      '',
    ]) {
      expect(parseTypedDate(bad), bad).toBeNull();
    }
    expect(parseTypedDate('29/02/2028')).toBe('2028-02-29');
  });

  it('shows YYYY-MM-DD as DD/MM/YYYY', () => {
    expect(formatTypedDate('2026-08-10')).toBe('10/08/2026');
    expect(formatTypedDate('')).toBe('');
    expect(formatTypedDate('2026-08-10T00:00:00.000Z')).toBe('');
  });

  it('turns any date-ish prefill into YYYY-MM-DD, so a timestamp no longer shows blank', () => {
    expect(toDateValue('2026-08-10')).toBe('2026-08-10');
    expect(toDateValue(new Date(2026, 7, 10, 23, 30))).toBe('2026-08-10');
    expect(toDateValue(new Date(2026, 7, 10, 9).toISOString())).toBe('2026-08-10');
    expect(toDateValue(null)).toBe('');
    expect(toDateValue('not a date')).toBe('');
  });

  it('reads the time of a local value or an instant', () => {
    expect(toTimeValue('2026-08-10T09:05')).toBe('09:05');
    expect(toTimeValue(new Date(2026, 7, 10, 14, 30))).toBe('14:30');
    expect(toTimeValue('')).toBe('');
  });

  it('says why a typed date cannot be used', () => {
    expect(dateProblem('')).toBeNull();
    expect(dateProblem('', { required: true })).toBe('Enter a date.');
    expect(dateProblem('31/04/2026')).toBe('Enter a real date as DD/MM/YYYY.');
    expect(dateProblem('09/10/2026', { min: '2026-10-10' })).toBe('Choose 10/10/2026 or later.');
    expect(dateProblem('11/10/2026', { max: '2026-10-10' })).toBe('Choose 10/10/2026 or earlier.');
    expect(dateProblem('10/10/2026', { min: '2026-10-10', max: '2026-10-10' })).toBeNull();
  });
});
