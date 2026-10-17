import { describe, expect, it } from 'vitest';
import { afterDial } from '@/lib/leads/callLog';

/**
 * Back from the phone's dialler (audit M20-06): the time away is the call's
 * estimate, since no CRM may read the phone's own call log. Under 8 seconds
 * nobody answered; otherwise whole minutes, at least one.
 */
describe('afterDial', () => {
  const left = Date.UTC(2026, 9, 18, 9, 0, 0);
  const back = (seconds: number) => afterDial(left, left + seconds * 1000);

  it('reads a return under 8 seconds as no answer', () => {
    expect(back(0)).toEqual({ minutes: 0, outcome: 'No answer' });
    expect(back(7.9)).toEqual({ minutes: 0, outcome: 'No answer' });
  });

  it('estimates the minutes from the time away, at least one, and picks no outcome', () => {
    expect(back(8)).toEqual({ minutes: 1 });
    expect(back(125)).toEqual({ minutes: 2 });
    expect(back(150)).toEqual({ minutes: 3 });
  });

  it('caps the estimate at what the call log accepts', () => {
    expect(back(24 * 3600)).toEqual({ minutes: 600 });
  });
});
