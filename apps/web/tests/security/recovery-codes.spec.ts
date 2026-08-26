import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { consumeRecoveryCode } from '@/services/identity/twoFactor';

/**
 * A recovery code bypasses the second factor outright, and the stored form is a
 * plain SHA-256 digest — so the whole of its strength is the entropy of the code
 * itself. At the original five bytes that was 2^40 against a fast, unsalted hash:
 * minutes on one GPU, and one pass covers every account in the table because
 * there is no salt to separate them.
 *
 * These cases exist to make a regression in that number fail loudly. A future
 * edit that shortens the code for readability, or reintroduces a fast hash over
 * a short input, breaks the first test here rather than quietly weakening every
 * enrolled account.
 */
const suffix = randomBytes(4).toString('hex');
const created: string[] = [];

/** Mirrors the storage form in twoFactor.ts: normalise, uppercase, SHA-256. */
async function storeCodes(platformUserId: string, codes: string[]) {
  const { createHash } = await import('node:crypto');
  const hash = (c: string) => createHash('sha256').update(c.replace(/\s|-/g, '').toUpperCase()).digest('hex');
  await prisma.platformUser.update({
    where: { id: platformUserId },
    data: { mfaEnabled: true, mfaRecoveryCodes: codes.map(hash) },
  });
}

async function makeUser() {
  const user = await prisma.platformUser.create({
    data: {
      email: `recovery-${suffix}-${created.length}@example.test`,
      normalizedEmail: `recovery-${suffix}-${created.length}@example.test`,
      fullName: 'Recovery Subject',
      status: 'ACTIVE',
    },
  });
  created.push(user.id);
  return user;
}

let sample: string[];

beforeAll(() => {
  /**
   * `generateRecoveryCodes` is private and its only public door needs a verified
   * TOTP code, which cannot be produced here. So the redemption cases below run
   * against a local mirror of the format, and the *generator itself* is pinned
   * by the source assertions above — that pairing is what stops the mirror and
   * the product drifting apart silently.
   */
  sample = Array.from({ length: 10 }, () => {
    const raw = randomBytes(10).toString('hex').toUpperCase();
    return (raw.match(/.{1,5}/g) ?? [raw]).join('-');
  });
});

afterAll(async () => {
  for (const id of created) await prisma.platformUser.delete({ where: { id } }).catch(() => {});
});

describe('recovery code strength', () => {
  it('issues codes with at least 80 bits of entropy', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/identity/twoFactor.ts', 'utf8');

    // The constant is the thing under test: it is what decides whether a leaked
    // digest is brute-forceable.
    const declared = source.match(/const RECOVERY_CODE_BYTES = (\d+)/);
    expect(declared, 'RECOVERY_CODE_BYTES should be a named constant').not.toBeNull();
    expect(Number(declared![1]) * 8).toBeGreaterThanOrEqual(80);

    // And the generator must actually use it, not a literal beside it.
    expect(source).toMatch(/randomBytes\(RECOVERY_CODE_BYTES\)/);
  });

  it('produces codes that are unique and normalise to the full length', () => {
    expect(new Set(sample).size).toBe(sample.length);
    for (const code of sample) {
      expect(code.replace(/-/g, '')).toHaveLength(20); // 10 bytes as hex
      expect(code).toMatch(/^[0-9A-F]{5}(-[0-9A-F]{5}){3}$/);
    }
  });
});

describe('recovery code redemption', () => {
  it('accepts a code with or without its grouping hyphens, then burns it', async () => {
    const user = await makeUser();
    await storeCodes(user.id, sample);

    // Typed back without the hyphens, as somebody reading it off a card would.
    expect(await consumeRecoveryCode(user.id, sample[0].replace(/-/g, '').toLowerCase())).toBe(true);

    const after = await prisma.platformUser.findUniqueOrThrow({
      where: { id: user.id },
      select: { mfaRecoveryCodes: true },
    });
    expect(after.mfaRecoveryCodes).toHaveLength(sample.length - 1);

    // Single use: the same code must not work twice.
    expect(await consumeRecoveryCode(user.id, sample[0])).toBe(false);
  });

  it('rejects a code that was never issued', async () => {
    const user = await makeUser();
    await storeCodes(user.id, sample);
    expect(await consumeRecoveryCode(user.id, 'AAAAA-BBBBB-CCCCC-DDDDD')).toBe(false);
  });

  it('still honours codes issued under the old short format', async () => {
    /**
     * Existing enrolments hold digests of five-byte codes and cannot be
     * distinguished from new ones — a SHA-256 digest is 64 characters whatever
     * went in. Locking those users out to close the weakness would be worse than
     * the weakness, so they keep working and are upgraded by regenerating.
     */
    const user = await makeUser();
    const legacy = '1A2B3-C4D5E';
    await storeCodes(user.id, [legacy]);
    expect(await consumeRecoveryCode(user.id, legacy)).toBe(true);
  });
});
