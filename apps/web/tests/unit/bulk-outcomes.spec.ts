/**
 * `summarizeBulk` is what the lead grid's bulk bar says when some of the
 * selected leads were refused: the leads that worked are counted, each server
 * sentence appears once with the leads it names, and nothing but that sentence
 * is repeated from the response.
 */
import { describe, expect, it } from 'vitest';
import { summarizeBulk } from '@/lib/grid/bulkOutcomes';

const rows = [
  { id: 'a', reference: 'LD-1', fullName: 'Sara' },
  { id: 'b', reference: 'LD-2', fullName: 'Omar' },
  { id: 'c', reference: 'LD-3', fullName: 'Priya' },
];

describe('summarizeBulk', () => {
  it('groups identical reasons, in the order they first appeared', () => {
    const out = summarizeBulk(
      3,
      [
        { id: 'a', detail: 'Viewing booked needs: email.' },
        { id: 'c', detail: 'Viewing booked needs: email.' },
        { id: 'b', detail: 'Your role does not allow this action.' },
      ],
      rows,
    );
    expect(out.summary).toBe('3 of 3 could not be completed.');
    expect(out.groups).toHaveLength(2);
    expect(out.groups[0]).toEqual({ detail: 'Viewing booked needs: email.', refs: ['LD-1 (Sara)', 'LD-3 (Priya)'] });
    expect(out.groups[1]!.refs).toEqual(['LD-2 (Omar)']);
  });

  it('says how many did go through', () => {
    expect(summarizeBulk(3, [{ id: 'a', detail: 'x' }], rows).summary).toBe(
      '1 of 3 could not be completed; the other 2 were.',
    );
    expect(summarizeBulk(2, [{ id: 'a', detail: 'x' }], rows).summary).toBe(
      '1 of 2 could not be completed; the other 1 was.',
    );
  });

  it('repeats only the server sentence for a 404', () => {
    const out = summarizeBulk(1, [{ id: 'a', detail: 'Lead not found.' }], rows);
    expect(out.groups).toEqual([{ detail: 'Lead not found.', refs: ['LD-1 (Sara)'] }]);
  });

  it('names a lead the list no longer shows without inventing anything about it', () => {
    expect(summarizeBulk(1, [{ id: 'gone', detail: 'Lead not found.' }], rows).groups[0]!.refs).toEqual([
      'a lead no longer listed',
    ]);
  });
});
