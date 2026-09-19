import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectStage, heuristicHints, type SalesStage } from '@/lib/ai/liveCoach';

/**
 * §17: the live-coach golden set. Each scenario is a transcript window with the
 * stage a sales lead would name and the hint kinds that must appear. This spec
 * runs the deterministic layer (stage rules, heuristic hints) so a rule change
 * that breaks a known scenario fails here; `scripts/ai-eval.ts` runs the same
 * set through the model. Acceptance: every expected hint kind present, stage
 * accuracy at or above the floor below.
 */
interface Scenario {
  id: string;
  lines: number;
  transcript: string;
  expectedStage: SalesStage;
  expectedHintKinds: string[];
}
const STAGE_ACCURACY_FLOOR = 0.9;
const scenarios: Scenario[] = JSON.parse(readFileSync(path.join(__dirname, 'golden', 'live-coach.json'), 'utf8'));

describe('live coach golden set (deterministic layer)', () => {
  it('names the sales stage on at least 90% of scenarios', () => {
    const results = scenarios.map((s) => ({ id: s.id, ok: detectStage(s.transcript, s.lines) === s.expectedStage }));
    const accuracy = results.filter((r) => r.ok).length / results.length;
    expect(
      results.filter((r) => !r.ok).map((r) => r.id),
      `stage accuracy ${accuracy}`,
    ).toEqual(accuracy >= STAGE_ACCURACY_FLOOR ? results.filter((r) => !r.ok).map((r) => r.id) : []);
    expect(accuracy).toBeGreaterThanOrEqual(STAGE_ACCURACY_FLOOR);
  });

  it.each(scenarios.filter((s) => s.expectedHintKinds.length))('$id raises $expectedHintKinds', (s) => {
    const kinds = heuristicHints(s.transcript).map((h) => h.kind);
    for (const expected of s.expectedHintKinds) expect(kinds).toContain(expected);
  });

  it('never returns more than two hints, and every hint is labelled simulated', () => {
    for (const s of scenarios) {
      const hints = heuristicHints(s.transcript);
      expect(hints.length).toBeLessThanOrEqual(2);
      for (const h of hints) expect(h.source).toBe('simulated');
    }
  });
});
