import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';

/**
 * The secret validator, exercised directly.
 *
 * `z.string().min(32)` counts characters, and a 32-byte secret is 44 characters
 * in base64 — so the original check was loose exactly where it mattered. Every
 * case below passed it.
 */
const { b64 } = await import('@/lib/env');

const valid = randomBytes(32).toString('base64');

describe('32-byte secret validation', () => {
  it('accepts a real 32-byte base64 secret', () => {
    expect(b64.safeParse(valid).success).toBe(true);
  });

  it('accepts base64url, which deployment tooling often rewrites to', () => {
    expect(b64.safeParse(randomBytes(32).toString('base64url')).success).toBe(true);
  });

  it('rejects 32 characters that decode to fewer than 32 bytes', () => {
    // 32 chars of base64 → 24 bytes. The old min(32) passed this.
    const short = randomBytes(24).toString('base64');
    expect(short.length).toBeGreaterThanOrEqual(32);
    expect(b64.safeParse(short).success).toBe(false);
  });

  it('rejects a long run of one character', () => {
    expect(b64.safeParse('a'.repeat(44)).success).toBe(false);
  });

  it('rejects known placeholders', () => {
    for (const placeholder of ['CHANGE_ME', 'changeme', 'placeholder', 'xxxxxxxx', 'TODO']) {
      expect(b64.safeParse(placeholder).success, placeholder).toBe(false);
    }
  });

  it('rejects a non-base64 string of sufficient length', () => {
    expect(b64.safeParse('not a secret at all, but certainly long enough!!').success).toBe(false);
  });

  it('names the remedy rather than only the fault', () => {
    const result = b64.safeParse('CHANGE_ME');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message).join(' ')).toMatch(/npm run secrets/);
    }
  });
});
