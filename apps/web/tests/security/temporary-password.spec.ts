import { describe, it, expect } from 'vitest';
import { generateTemporaryPassword } from '@/services/identity/accounts';
import { checkPolicy, DEFAULT_POLICY } from '@/lib/auth/password';

/**
 * A generated password must pass the check the same request is about to run it
 * through.
 *
 * The old generator was random base64url plus random hex, so roughly one call
 * in three thousand contained no digit and the reset failed its own policy with
 * "Include a number." That is rare enough to read as a flaky test and common
 * enough to break CI, which is exactly what it did. The iteration count here is
 * what makes the difference visible: a handful of samples would have passed
 * against the broken version too.
 */
const SAMPLES = 20_000;

describe('temporary password', () => {
  it('always satisfies the default policy', () => {
    const failures: { password: string; problems: string[] }[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const password = generateTemporaryPassword();
      const problems = checkPolicy(password, DEFAULT_POLICY);
      if (problems.length) failures.push({ password, problems });
    }
    expect(failures.slice(0, 3)).toEqual([]);
  });

  it('satisfies the strictest policy a workspace can configure', () => {
    // Every toggle on, including the symbol requirement the default leaves off.
    const strict = { ...DEFAULT_POLICY, requireSymbol: true, minLength: 16 };
    for (let i = 0; i < SAMPLES; i += 1) {
      expect(checkPolicy(generateTemporaryPassword(), strict)).toEqual([]);
    }
  });

  /**
   * It gets read down a phone line, so the characters that get misheard are
   * left out on purpose.
   */
  it('avoids characters that are ambiguous when dictated', () => {
    for (let i = 0; i < 2_000; i += 1) {
      expect(generateTemporaryPassword()).not.toMatch(/[O0Il1]/);
    }
  });

  it('does not put the guaranteed characters in the same place every time', () => {
    // A generator that always opens lower/upper/digit/symbol would pass the
    // policy checks above while being trivially predictable in shape.
    const firstChars = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()[0]));
    expect(firstChars.size).toBeGreaterThan(4);
  });

  it('never repeats itself', () => {
    const seen = new Set(Array.from({ length: 5_000 }, () => generateTemporaryPassword()));
    expect(seen.size).toBe(5_000);
  });
});
