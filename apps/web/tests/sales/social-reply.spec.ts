import { describe, it, expect } from 'vitest';
import { queueRank } from '@/services/social/sla';
import { templateDraft } from '@/services/social/draftReply';
import * as draftModule from '@/services/social/draftReply';

/**
 * The rules around answering an enquiry that do not need a database.
 *
 * The one worth reading twice is the last: drafting must have no way of
 * reaching Meta. That is a property of the module graph, not of a code path, so
 * it is asserted rather than trusted.
 */
describe('queue order', () => {
  const rank = (intent: string, sla: string, due: string) =>
    queueRank({ intent, sla: sla as never, slaDueAt: new Date(due) });
  const before = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;

  it('puts a breached high-intent enquiry at the top', () => {
    const high = rank('HIGH', 'BREACHED', '2026-08-17T10:00:00Z');
    const rest = [
      rank('HIGH', 'AT_RISK', '2026-08-17T09:00:00Z'),
      rank('MEDIUM', 'BREACHED', '2026-08-17T08:00:00Z'),
      rank('LOW', 'BREACHED', '2026-08-17T07:00:00Z'),
    ];
    for (const other of rest) expect(before(high, other)).toBeLessThan(0);
  });

  /**
   * The rule that motivated ranking at all: a hot buyer two minutes from their
   * deadline is more winnable than a lukewarm one twenty minutes past it, so
   * sorting on lateness alone had it backwards.
   */
  it('ranks high intent above lower intent that is later', () => {
    const highAtRisk = rank('HIGH', 'AT_RISK', '2026-08-17T12:00:00Z');
    const mediumBreached = rank('MEDIUM', 'BREACHED', '2026-08-17T06:00:00Z');
    expect(before(highAtRisk, mediumBreached)).toBeLessThan(0);
  });

  it('sinks answered work below everything still owed', () => {
    const met = rank('HIGH', 'MET', '2026-08-17T06:00:00Z');
    const onTrack = rank('HIGH', 'ON_TRACK', '2026-08-17T23:00:00Z');
    expect(before(onTrack, met)).toBeLessThan(0);
  });

  it('breaks ties on the nearest deadline', () => {
    const sooner = rank('HIGH', 'AT_RISK', '2026-08-17T10:00:00Z');
    const later = rank('HIGH', 'AT_RISK', '2026-08-17T10:30:00Z');
    expect(before(sooner, later)).toBeLessThan(0);
  });

  it('leaves praise and spam at the bottom', () => {
    const spam = rank('SPAM', 'PAUSED', '2026-08-17T01:00:00Z');
    const low = rank('LOW', 'ON_TRACK', '2026-08-17T23:00:00Z');
    expect(before(low, spam)).toBeLessThan(0);
  });
});

describe('reply drafting', () => {
  const context = {
    provider: 'instagram',
    authorName: '@priya.k',
    commentText: 'Interested — what is the price?',
    intent: 'HIGH',
    mediaType: 'REELS',
    kind: 'PUBLIC' as const,
    businessName: 'Manath Homes',
  };

  it('never invents a price, a date or contact details', () => {
    const both = [templateDraft(context), templateDraft({ ...context, kind: 'PRIVATE' })].join('\n');
    expect(both).not.toMatch(/AED|\$|\d{3,}|call us on|\+971/i);
  });

  it('keeps a public reply short and moves detail to a direct message', () => {
    const draft = templateDraft(context);
    expect(draft.length).toBeLessThan(300);
    expect(draft).toMatch(/direct message/i);
  });

  it('greets by handle without inventing a name', () => {
    expect(templateDraft(context)).toContain('priya.k');
    expect(templateDraft({ ...context, authorName: null })).toContain('Hi there');
  });

  /**
   * The guarantee behind "AI must never auto-send": the drafting module cannot
   * reach the sender at all. A future edit that wires them together fails here
   * rather than in production.
   */
  it('has no way to send anything', () => {
    const exported = Object.keys(draftModule);
    expect(exported.sort()).toEqual(['draftReply', 'templateDraft']);
    const source = draftModule.draftReply.toString() + templateDraft.toString();
    expect(source).not.toMatch(/sendMetaReply|graph\.facebook\.com/);
  });
});
