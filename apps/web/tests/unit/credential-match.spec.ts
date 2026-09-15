/**
 * Both credential slots are checked with the same work on every attempt.
 *
 * If an empty monitoring slot cost less than a filled one, response time would
 * say which accounts hold a second password; if a refused account (unknown,
 * locked, suspended) cost less than a real check, it would say which addresses
 * exist. The count of Argon2id verifications is what decides both, so this pins
 * it: exactly two, whatever the slots hold and whatever matched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ verify: 0, burn: 0 }));
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/auth/password')>();
  return {
    ...real,
    burnTiming: async () => {
      calls.burn++;
      return false;
    },
    verifyOrBurn: async (digest: string | null | undefined, plain: string) => {
      if (!digest) {
        calls.burn++;
        return false;
      }
      calls.verify++;
      return digest === `hash:${plain}`;
    },
  };
});

import { burnCredentialCheck, credentialRefusal, matchCredential } from '@/lib/auth/credentials';

beforeEach(() => {
  calls.verify = 0;
  calls.burn = 0;
});

const work = () => calls.verify + calls.burn;

describe('matchCredential', () => {
  it.each([
    ['both slots set, primary matches', { passwordHash: 'hash:A', monitoringPasswordHash: 'hash:B' }, 'A', 'PRIMARY'],
    [
      'both slots set, monitoring matches',
      { passwordHash: 'hash:A', monitoringPasswordHash: 'hash:B' },
      'B',
      'MONITORING',
    ],
    ['both slots set, neither matches', { passwordHash: 'hash:A', monitoringPasswordHash: 'hash:B' }, 'C', 'NONE'],
    ['no monitoring slot, primary matches', { passwordHash: 'hash:A', monitoringPasswordHash: null }, 'A', 'PRIMARY'],
    ['no monitoring slot, nothing matches', { passwordHash: 'hash:A', monitoringPasswordHash: null }, 'C', 'NONE'],
    ['both slots accept it', { passwordHash: 'hash:A', monitoringPasswordHash: 'hash:A' }, 'A', 'AMBIGUOUS'],
  ] as const)('%s → %s, with exactly two verifications', async (_label, identity, plain, expected) => {
    expect(await matchCredential(identity, plain)).toBe(expected);
    expect(work()).toBe(2);
  });

  it('a refusal before the password check burns the same two verifications', async () => {
    await burnCredentialCheck();
    expect(work()).toBe(2);
  });
});

describe('credentialRefusal', () => {
  const staff = {
    platformRole: 'OWNER',
    passwordVersion: 3,
    monitoringPasswordHash: 'hash:B',
    monitoringPasswordVersion: 2,
  };

  it('accepts a current administration or monitoring session', () => {
    expect(
      credentialRefusal({ purpose: 'FULL', credentialPurpose: 'PLATFORM_ADMIN', credentialVersion: 3 }, staff),
    ).toBeNull();
    expect(
      credentialRefusal({ purpose: 'FULL', credentialPurpose: 'MONITORING', credentialVersion: 2 }, staff),
    ).toBeNull();
  });

  it('refuses a staff session without a purpose rather than reading it as administration', () => {
    expect(credentialRefusal({ purpose: 'FULL', credentialPurpose: null, credentialVersion: null }, staff)).toBe(
      'LEGACY_SESSION_WITHOUT_CREDENTIAL_PURPOSE',
    );
  });

  it('refuses a stale version for either credential', () => {
    expect(
      credentialRefusal({ purpose: 'FULL', credentialPurpose: 'PLATFORM_ADMIN', credentialVersion: 2 }, staff),
    ).toBe('CREDENTIAL_CHANGED');
    expect(credentialRefusal({ purpose: 'FULL', credentialPurpose: 'MONITORING', credentialVersion: 1 }, staff)).toBe(
      'CREDENTIAL_CHANGED',
    );
  });

  it('refuses a monitoring session once the credential is gone, and never as an enrolment grant', () => {
    expect(
      credentialRefusal(
        { purpose: 'FULL', credentialPurpose: 'MONITORING', credentialVersion: 2 },
        { ...staff, monitoringPasswordHash: null },
      ),
    ).toBe('MONITORING_CREDENTIAL_REVOKED');
    expect(
      credentialRefusal({ purpose: 'MFA_ENROLMENT', credentialPurpose: 'MONITORING', credentialVersion: 2 }, staff),
    ).toBe('MONITORING_SESSION_PURPOSE_INVALID');
  });

  it('leaves workspace users and machine sessions exactly as they were', () => {
    const member = { ...staff, platformRole: 'USER' };
    expect(credentialRefusal({ purpose: 'FULL', credentialPurpose: null, credentialVersion: null }, member)).toBeNull();
    expect(credentialRefusal({ purpose: 'FULL', credentialPurpose: 'MONITORING', credentialVersion: 2 }, member)).toBe(
      'CREDENTIAL_PURPOSE_ROLE_MISMATCH',
    );
    expect(
      credentialRefusal(
        { purpose: 'AI_SERVICE', credentialPurpose: null, credentialVersion: null },
        { ...staff, platformRole: 'AI_SERVICE' },
      ),
    ).toBeNull();
  });
});

describe('the application defines no server actions', () => {
  it('has none, so every mutation goes through a route that enforces the session mode', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const path = await import('node:path');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry) && /^\s*['"]use server['"]/m.test(readFileSync(full, 'utf8')))
          offenders.push(full);
      }
    };
    walk(path.resolve(__dirname, '../../src'));
    // A server action added later must be reviewed for monitoring sessions — this
    // fails until it is, and until it carries the same read-only guard.
    expect(offenders).toEqual([]);
  });
});
