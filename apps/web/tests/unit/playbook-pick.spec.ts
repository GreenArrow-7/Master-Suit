/** Which buyer playbook a lead sells under: tag overlap first, default second. */
import { describe, it, expect } from 'vitest';
import { pickPlaybook } from '@/services/leads/callContext';
import { extractRequirement } from '@/lib/ai/simulated';

const pb = (name: string, leadTags: string[], isDefault = false) => ({ name, leadTags, isDefault });

describe('pickPlaybook', () => {
  const books = [pb('Dubai Investor', ['investor', 'off-plan']), pb('First-Time Buyer', ['first-home']), pb('General', [], true)];

  it('matches on lead tags, case-insensitively', () => {
    expect(pickPlaybook(books, ['Investor'])?.name).toBe('Dubai Investor');
    expect(pickPlaybook(books, ['first-home', 'hot'])?.name).toBe('First-Time Buyer');
  });

  it('falls back to the default, and to nothing when there is none', () => {
    expect(pickPlaybook(books, ['unrelated'])?.name).toBe('General');
    expect(pickPlaybook([pb('A', ['x'])], ['y'])).toBeNull();
  });
});

describe('extractRequirement provenance', () => {
  it('carries confidence and the customer line it was read from', () => {
    const req = extractRequirement('Agent: Any budget?\nCustomer: Around 1.5 million for a 2 bedroom.')!;
    expect(req.confidence).toBeGreaterThan(0);
    expect(req.evidence).toContain('1.5 million');
  });

  it('still returns null when nothing was stated, despite metadata fields', () => {
    expect(extractRequirement('Agent: Hello?\nCustomer: Wrong number.')).toBeNull();
  });
});
