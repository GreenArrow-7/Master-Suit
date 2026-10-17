/**
 * The deterministic half of the live sales assistant: the next-best-question
 * ladder, the buying-signal heuristics, and the keyword requirement extraction
 * that stages post-call CRM updates. Pure functions, no database, no provider.
 */
import { describe, it, expect } from 'vitest';
import { nextBestQuestion, heuristicHints, playbookHint } from '@/lib/ai/liveCoach';
import { extractRequirement, parseAmounts } from '@/lib/ai/simulated';

describe('nextBestQuestion', () => {
  it('starts with the buyer objective when nothing is known', () => {
    expect(nextBestQuestion(null).text).toMatch(/buy or rent/i);
  });

  it('asks for budget once the objective is recorded', () => {
    expect(nextBestQuestion({ purpose: 'BUY' }).text).toMatch(/budget/i);
  });

  it('moves to a viewing commitment when fully qualified', () => {
    const q = nextBestQuestion({
      purpose: 'BUY',
      budgetMax: 2_000_000,
      bedroomsMin: 2,
      micromarketIds: ['x'],
      possessionBy: new Date(),
    });
    expect(q.text).toMatch(/viewing/i);
  });
});

describe('heuristicHints', () => {
  it('flags a payment-plan question as a buying signal first', () => {
    const hints = heuristicHints('Customer: What is the payment plan for this unit?');
    expect(hints[0].kind).toBe('BUYING_SIGNAL');
  });
});

describe('parseAmounts', () => {
  it('reads digits and spelled-out millions', () => {
    expect(parseAmounts('around 1.8m, or one point five million, maybe 800k')).toEqual([1_800_000, 800_000, 1_500_000]);
  });
});

describe('extractRequirement', () => {
  const transcript = [
    'Agent: The two-bedrooms start at one point four five million with a 60-40 plan.',
    'Customer: We are looking for a two or three bedroom apartment to live in.',
    'Customer: Somewhere around one point five million, maybe stretching to one point eight.',
    'Customer: My daughter starts next september.',
  ].join('\n');

  it('takes budget from the customer, not the agent price quote', () => {
    const req = extractRequirement(transcript)!;
    expect(req.budgetMin).toBe(1_500_000);
    expect(req.budgetMax).toBe(1_800_000);
  });

  it('reads bedrooms, purpose, type and timeline', () => {
    const req = extractRequirement(transcript)!;
    expect(req.bedroomsMin).toBe(2);
    expect(req.bedroomsMax).toBe(3);
    expect(req.purpose).toBe('BUY');
    expect(req.propertyType).toBe('APARTMENT');
    expect(req.timeline).toMatch(/next september/);
  });

  it('returns null when nothing was stated', () => {
    expect(extractRequirement('Agent: Hello?\nCustomer: Wrong number, sorry.')).toBeNull();
  });
});

/** M21-01: the workspace's own objection cards, cited by the live coach. */
describe('playbookHint', () => {
  const cards = [
    {
      id: 'c1',
      name: 'Price',
      triggerPhrases: ['too expensive'],
      recommendedResponses: ['Compare it per square foot.'],
    },
    { id: 'c2', name: 'Spouse', triggerPhrases: ['ask my wife'], recommendedResponses: [] },
  ];

  it('answers what the customer said with the card that names it, citing the card', () => {
    expect(playbookHint('Agent: Here is the price.\nCustomer: Honestly it is too expensive.', cards)).toEqual({
      objectionId: 'c1',
      kind: 'OBJECTION',
      text: 'Price',
      say: 'Compare it per square foot.',
      why: 'From your playbook: Price',
      source: 'playbook',
    });
  });

  it('ignores the agent saying the phrase, a card already cited, and a window no card names', () => {
    expect(playbookHint('Agent: Some say it is too expensive.', cards)).toBeNull();
    expect(playbookHint('Customer: It is too expensive.', cards, new Set(['c1']))).toBeNull();
    expect(playbookHint('Customer: Is there parking?', cards)).toBeNull();
  });

  it('answers the objection just raised, not an earlier one, and gives way when the latest line names no card', () => {
    const answered = 'Customer: Honestly it is too expensive.\nAgent: Per square foot it is below the community.\n';
    expect(playbookHint(`${answered}Customer: I need to ask my wife.`, cards)).toMatchObject({ objectionId: 'c2' });
    expect(playbookHint(`${answered}Customer: Also the handover date is too late.`, cards)).toBeNull();
    // The customer's latest line counts even when the agent has spoken since.
    expect(playbookHint(`${answered}Customer: I need to ask my wife.\nAgent: Of course.`, cards)).toMatchObject({
      objectionId: 'c2',
    });
  });

  it('cites a card with no response yet without inventing one', () => {
    expect(playbookHint('Customer: I need to ask my wife.', cards)).toMatchObject({ text: 'Spouse', say: undefined });
  });
});
