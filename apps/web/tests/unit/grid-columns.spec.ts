/**
 * `resolveColumns` stands between a stored administrator preference and what the
 * grid renders. Every branch here is a way a workspace could otherwise end up with
 * an unusable grid: no columns at all, a column that no longer exists rendering as
 * a blank strip, or a lead row with no link back to its record.
 */
import { describe, expect, it } from 'vitest';
import { GRID_COLUMNS, resolveColumns, optionalColumns, storedColumnsFor } from '@/lib/grid/columns';

const keys = (stored: unknown) => resolveColumns('LEAD', stored).map((column) => column.key);
const FIXED = GRID_COLUMNS.LEAD.filter((column) => column.fixed).map((column) => column.key);

describe('resolveColumns', () => {
  it('falls back to the product default when nothing is stored', () => {
    const expected = [...FIXED, ...GRID_COLUMNS.LEAD.filter((c) => c.byDefault).map((c) => c.key)];
    expect(keys(null)).toEqual(expected);
    expect(keys(undefined)).toEqual(expected);
    expect(keys([])).toEqual(expected);
    expect(keys('not an array')).toEqual(expected);
  });

  it('honours the stored order for optional columns', () => {
    expect(keys(['phone', 'stage', 'score'])).toEqual([...FIXED, 'phone', 'stage', 'score']);
  });

  it('always leads with the fixed columns, however they were stored', () => {
    // A stored list that puts a fixed column last must not push the record link
    // to the end of the row, and must not duplicate it either.
    const resolved = keys(['stage', 'reference', 'fullName']);
    expect(resolved.slice(0, FIXED.length)).toEqual(FIXED);
    expect(resolved.filter((key) => key === 'reference')).toHaveLength(1);
  });

  it('drops keys that are no longer in the catalogue rather than rendering blanks', () => {
    expect(keys(['stage', 'a-column-that-was-removed', 'score'])).toEqual([...FIXED, 'stage', 'score']);
  });

  it('falls back to the default when every stored key has gone stale', () => {
    // Otherwise a catalogue rename would leave the workspace with fixed columns only.
    expect(keys(['gone', 'also-gone'])).toEqual(keys(null));
  });

  it('deduplicates repeated keys', () => {
    expect(keys(['stage', 'stage', 'score'])).toEqual([...FIXED, 'stage', 'score']);
  });

  it('never offers a fixed column as removable', () => {
    expect(optionalColumns('LEAD').some((column) => column.fixed)).toBe(false);
  });
});

describe('storedColumnsFor', () => {
  it('reads one object out of the settings blob and tolerates junk', () => {
    expect(storedColumnsFor({ LEAD: ['stage'] }, 'LEAD')).toEqual(['stage']);
    expect(storedColumnsFor({}, 'LEAD')).toBeNull();
    expect(storedColumnsFor(null, 'LEAD')).toBeNull();
    expect(storedColumnsFor('nonsense', 'LEAD')).toBeNull();
  });
});
