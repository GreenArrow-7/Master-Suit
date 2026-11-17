/**
 * The order of the day, as arithmetic.
 *
 * This is the part of the Today screen that must never be a model's opinion:
 * if a person asks "why is this first", the answer has to be a fact and a
 * timestamp, not a plausible sentence. So the ranking is a pure function and
 * these are its cases.
 */
import { describe, it, expect } from 'vitest';
import { rank, weigh, ago, MAX_ITEMS, type TodayItem } from '@/services/today/priorities';

const NOW = new Date('2026-11-16T09:00:00Z');

const item = (over: Partial<TodayItem> & Pick<TodayItem, 'kind' | 'leadId'>): TodayItem => ({
  title: over.leadId,
  reason: '',
  action: 'Call',
  at: null,
  weight: weigh(over.kind, over.at ?? null, NOW, 0),
  ...over,
});

describe('weighing one piece of work', () => {
  it('puts a broken rule above every judgement call', () => {
    const bands = (['sla', 'overdue', 'callback', 'untouched', 'idle'] as const).map((kind) =>
      weigh(kind, NOW, NOW, 100),
    );
    // Strictly decreasing: the bands do not overlap, by design.
    expect(bands).toEqual([...bands].sort((a, b) => b - a));
    expect(new Set(bands).size).toBe(bands.length);
  });

  it('cannot let a high score outrank a promise to a customer', () => {
    // The whole point of banding: a score of 100 on a quiet lead still sits
    // below a follow-up that is merely due today.
    expect(weigh('idle', NOW, NOW, 100)).toBeLessThan(weigh('callback', NOW, NOW));
  });

  it('is bounded, so one very old item cannot swamp a whole band', () => {
    const ancient = new Date('2019-01-01T00:00:00Z');
    expect(weigh('overdue', ancient, NOW)).toBeLessThan(weigh('sla', NOW, NOW));
  });
});

describe('ordering the day', () => {
  it('leads with the escalation, then the overdue promise', () => {
    const ordered = rank([
      item({ kind: 'idle', leadId: 'quiet' }),
      item({ kind: 'untouched', leadId: 'new', at: NOW }),
      item({ kind: 'sla', leadId: 'breached', at: NOW }),
      item({ kind: 'overdue', leadId: 'late', at: NOW }),
    ]);
    expect(ordered.map((i) => i.leadId)).toEqual(['breached', 'late', 'new', 'quiet']);
  });

  it('within a band, the thing that has waited longest comes first', () => {
    const ordered = rank([
      item({ kind: 'overdue', leadId: 'yesterday', at: new Date('2026-11-15T09:00:00Z') }),
      item({ kind: 'overdue', leadId: 'last-week', at: new Date('2026-11-09T09:00:00Z') }),
    ]);
    expect(ordered.map((i) => i.leadId)).toEqual(['last-week', 'yesterday']);
  });

  it('puts the earlier callback first', () => {
    const ordered = rank([
      item({ kind: 'callback', leadId: 'afternoon', at: new Date('2026-11-16T14:00:00Z') }),
      item({ kind: 'callback', leadId: 'morning', at: new Date('2026-11-16T10:00:00Z') }),
    ]);
    expect(ordered.map((i) => i.leadId)).toEqual(['morning', 'afternoon']);
  });

  it('says one thing about one lead, and says the most important one', () => {
    // The same person escalated, overdue and quiet: one row, the escalation.
    const ordered = rank([
      item({ kind: 'idle', leadId: 'rahul', title: 'Rahul Mehta' }),
      item({ kind: 'overdue', leadId: 'rahul', title: 'Rahul Mehta', at: NOW }),
      item({ kind: 'sla', leadId: 'rahul', title: 'Rahul Mehta', at: NOW }),
    ]);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]!.kind).toBe('sla');
  });

  it('deduplicates before capping, so one lead cannot eat the whole list', () => {
    // Three reasons each for three leads, plus five singles. Without
    // dedupe-before-cap the three noisy leads would take nine of seven places.
    const noisy = ['a', 'b', 'c'].flatMap((id) => [
      item({ kind: 'sla', leadId: id, at: NOW }),
      item({ kind: 'overdue', leadId: id, at: NOW }),
      item({ kind: 'idle', leadId: id }),
    ]);
    const singles = ['d', 'e', 'f', 'g', 'h'].map((id) => item({ kind: 'untouched', leadId: id, at: NOW }));
    const ordered = rank([...noisy, ...singles]);
    expect(ordered).toHaveLength(MAX_ITEMS);
    expect(new Set(ordered.map((i) => i.leadId)).size).toBe(MAX_ITEMS);
  });

  it('never shows more than a person can work through', () => {
    const many = Array.from({ length: 40 }, (_, n) => item({ kind: 'untouched', leadId: `lead-${n}`, at: NOW }));
    expect(rank(many)).toHaveLength(MAX_ITEMS);
  });

  it('is stable across two renders of the same data', () => {
    const items = ['z', 'a', 'm'].map((id) => item({ kind: 'untouched', leadId: id, at: NOW }));
    expect(rank(items).map((i) => i.leadId)).toEqual(rank([...items].reverse()).map((i) => i.leadId));
  });

  it('renders nothing rather than something, on a quiet day', () => {
    expect(rank([])).toEqual([]);
  });
});

describe('how the reason states its time', () => {
  it('reads in words a person would use', () => {
    expect(ago(new Date('2026-11-16T08:30:00Z'), NOW)).toBe('in the last hour');
    expect(ago(new Date('2026-11-16T05:00:00Z'), NOW)).toBe('4 hours ago');
    expect(ago(new Date('2026-11-15T09:00:00Z'), NOW)).toBe('yesterday');
    expect(ago(new Date('2026-11-09T09:00:00Z'), NOW)).toBe('7 days ago');
  });

  it('does not invent a future', () => {
    expect(ago(new Date('2026-11-20T09:00:00Z'), NOW)).toBe('in the last hour');
  });
});
