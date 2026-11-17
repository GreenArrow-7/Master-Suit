/**
 * A wrong API key secret is rate-limited, and is limited before it is hashed.
 *
 * `verifyPassword` is Argon2: ARGON2_MEMORY_KIB of memory per call, 19 MB by
 * default. With `consume` after it, a wrong secret threw on the hash and never
 * reached the limiter, so nothing bounded how often that cost could be paid —
 * and nothing stands in front of this path either, because `route()` only
 * rate-limits a credential it has already accepted. Anyone holding a key's
 * prefix, which the keys screen shows, could spend the host's memory with
 * requests that never authenticate.
 *
 * The order is the point, not just the call: a limiter after the hash is the
 * bug this spec exists for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const order: string[] = [];

const key = {
  id: 'key-1',
  tenantId: 'tenant-1',
  prefix: 'abcd1234',
  keyHash: 'argon2-hash',
  revokedAt: null as Date | null,
  expiresAt: null as Date | null,
  ipAllowlist: [] as string[],
  rateLimitPerMin: 600,
  roleId: 'role-1',
  scopes: [] as string[],
  createdById: 'user-1',
  name: 'Reporting key',
};

const consume = vi.fn(async () => {
  order.push('consume');
});
const verifyPassword = vi.fn(async () => {
  order.push('verify');
  return false;
});

vi.mock('@/lib/db', () => ({
  prisma: {
    aPIKey: { findFirst: async () => key, update: () => ({ catch: () => undefined }) },
    role: { findFirst: async () => null },
  },
}));
vi.mock('@/lib/auth/password', () => ({ verifyPassword, hashPassword: async () => 'hash' }));
vi.mock('@/lib/auth/session', () => ({ clientIp: () => '203.0.113.9' }));
vi.mock('@/lib/security/ratelimit', () => ({
  consume,
  limits: { apiKey: (id: string, max: number) => ({ key: `apikey:${id}`, max, windowSeconds: 60 }) },
}));

const { authenticateApiKey } = await import('@/lib/auth/apiKey');

const req = new Request('https://example.test/api/v1/leads');

describe('authenticateApiKey', () => {
  beforeEach(() => {
    order.length = 0;
    consume.mockClear();
    verifyPassword.mockClear();
  });

  it('charges the limiter for a wrong secret', async () => {
    await expect(authenticateApiKey('lf_live_abcd1234_wrong', req, 'req-1')).rejects.toThrow('Invalid API key.');
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it('charges it before the Argon2 verification, not after', async () => {
    await expect(authenticateApiKey('lf_live_abcd1234_wrong', req, 'req-2')).rejects.toThrow('Invalid API key.');
    expect(order).toEqual(['consume', 'verify']);
  });

  it('spends nothing on an unknown prefix, which costs one indexed lookup', async () => {
    vi.resetModules();
    vi.doMock('@/lib/db', () => ({
      prisma: { aPIKey: { findFirst: async () => null }, role: { findFirst: async () => null } },
    }));
    const { authenticateApiKey: fresh } = await import('@/lib/auth/apiKey');
    await expect(fresh('lf_live_nosuchkey_wrong', req, 'req-3')).rejects.toThrow('Invalid API key.');
    expect(consume).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
  });
});
