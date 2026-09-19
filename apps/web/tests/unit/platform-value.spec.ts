import { describe, expect, it } from 'vitest';
import { MINUTES_PER_ACTION, valueSummary } from '@/lib/value/platformValue';

describe('front-door value summary', () => {
  it('turns counted work into hours with the stated assumptions, and zero work into zero', () => {
    const s = valueSummary({ leadsImported: 300, callsAnalysed: 60, automationSteps: 200, leadsAutoAssigned: 120 });
    expect(s.actions).toBe(680);
    const minutes =
      300 * MINUTES_PER_ACTION.leadsImported +
      60 * MINUTES_PER_ACTION.callsAnalysed +
      200 * MINUTES_PER_ACTION.automationSteps +
      120 * MINUTES_PER_ACTION.leadsAutoAssigned;
    expect(s.hoursSaved).toBe(Math.round(minutes / 60));

    const none = valueSummary({ leadsImported: 0, callsAnalysed: 0, automationSteps: 0, leadsAutoAssigned: 0 });
    expect(none.actions).toBe(0);
    expect(none.hoursSaved).toBe(0);
  });
});
