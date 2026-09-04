/**
 * The two new deterministic classifiers: where the conversation is, and how
 * warm the lead left it. Pure functions, no database, no provider.
 */
import { describe, it, expect } from 'vitest';
import { detectStage } from '@/lib/ai/liveCoach';
import { leadTemperature, temperatureFromAnalysis } from '@/lib/ai/temperature';

describe('detectStage', () => {
  it('opens in INTRODUCTION and defaults to DISCOVERY once underway', () => {
    expect(detectStage('Customer: Hello?', 1)).toBe('INTRODUCTION');
    expect(detectStage('Customer: Go on then, tell me more about it.', 6)).toBe('DISCOVERY');
  });

  it('classifies the obvious phases', () => {
    expect(detectStage('Customer: What budget works? I would use a mortgage.', 6)).toBe('QUALIFICATION');
    expect(detectStage('Customer: Honestly that is too expensive for us.', 6)).toBe('OBJECTION_HANDLING');
    expect(detectStage('Agent: The payment plan is 60-40 and handover is next year.', 6)).toBe('PRESENTATION');
    expect(detectStage('Customer: Can you do a better final price?', 6)).toBe('NEGOTIATION');
  });

  it('lets a viewing being booked outrank the objection before it', () => {
    const window = 'Customer: It felt expensive.\nAgent: Shall we book a viewing — Thursday or Saturday?';
    expect(detectStage(window, 10)).toBe('CLOSING');
  });
});

describe('leadTemperature', () => {
  it('reads READY_TO_ACT when signals, budget, timeline and a commitment line up', () => {
    const r = leadTemperature({
      buyingSignals: ['asked for payment plan', 'asked to see floor plan'],
      objections: [],
      commitments: ['book a viewing on Saturday'],
      sentimentScore: 0.5,
      budgetStated: true,
      timelineStated: true,
    });
    expect(r.temperature).toBe('READY_TO_ACT');
    expect(r.score).toBeGreaterThanOrEqual(75);
    // Every point on the board is a visible reason.
    expect(r.reasons.reduce((s, x) => s + x.delta, 0)).toBe(r.score);
  });

  it('stays COLD with objections and nothing learned', () => {
    const r = leadTemperature({
      buyingSignals: [],
      objections: ['price', 'location', 'trust'],
      commitments: [],
      sentimentScore: -0.4,
      budgetStated: false,
      timelineStated: false,
    });
    expect(r.temperature).toBe('COLD');
    expect(r.reasons.some((x) => x.delta < 0)).toBe(true);
  });

  it('is HOT, not READY_TO_ACT, without a concrete commitment', () => {
    const r = leadTemperature({
      buyingSignals: ['a', 'b', 'c'],
      objections: [],
      commitments: ['send the brochure'],
      sentimentScore: 0.5,
      budgetStated: true,
      timelineStated: true,
    });
    expect(r.temperature).toBe('HOT');
  });
});

describe('temperatureFromAnalysis', () => {
  it('reads budget and timeline out of the stored detectedRequirement', () => {
    const r = temperatureFromAnalysis({
      buyingSignals: ['asked about booking amount'],
      objections: [],
      commitments: ['arrange a viewing'],
      sentimentScore: 0.3,
      rawOutput: { detectedRequirement: { budgetMax: 1_800_000, timeline: 'next september' } },
    });
    expect(r.reasons.some((x) => x.text.includes('Budget stated'))).toBe(true);
    expect(r.reasons.some((x) => x.text.includes('timeline stated'))).toBe(true);
  });
});
