import { describe, expect, it } from 'vitest';
import { normalizePhone } from '@/services/leads/normalizePhone';

describe('normalizePhone', () => {
  it('writes every spelling of one UAE number the same way', () => {
    for (const input of ['+971 50 123 4567', '00971501234567', '971501234567', '0501234567', '501234567']) {
      expect(normalizePhone(input), input).toBe('+971501234567');
    }
  });

  it('keeps an explicit foreign code, and refuses what cannot be a number', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('12-34')).toBeNull();
  });
});
