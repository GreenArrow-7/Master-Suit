/**
 * Malformed input to the hand-rolled auth routes is a client error, not a server
 * crash. Before the fix, `schema.parse(await req.json())` let a ZodError or a
 * JSON SyntaxError fall through to the generic 500 branch, so an empty email or
 * an empty body answered `500 Internal error`. Every case here must be a 4xx.
 *
 * The genuine-credential paths are left alone: an unknown-but-well-formed login
 * still answers 401 with the same generic message (no account enumeration).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it, beforeAll } from 'vitest';
import { clear as clearLimit, limits } from '@/lib/security/ratelimit';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { POST as forgot } from '@/app/api/v1/auth/forgot-password/route';
import { POST as reset } from '@/app/api/v1/auth/reset-password/route';
import { POST as retention } from '@/app/api/v1/admin/retention/route';
import { createPlatformSessionToken } from '../helpers/session';
import { post } from '../helpers/request';
import { prisma } from '@/lib/db';

/** POST a raw (possibly malformed) body straight to a route handler. */
async function raw(handler: (r: Request) => Promise<Response>, path: string, body: string) {
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  // The one well-formed login below reaches the rate limiter; keep the shared
  // dev 'unknown' bucket clear so a full run does not answer 429 here.
  await clearLimit(limits.loginPerIp('unknown'));
});

describe('AUTH-001: auth routes reject malformed input with 4xx, never 500', () => {
  const cases: [string, string][] = [
    ['empty body', ''],
    ['empty JSON object', '{}'],
    ['empty email and password', '{"email":"","password":""}'],
    ['invalid email format', '{"email":"notanemail","password":"x"}'],
    ['malformed JSON', '{bad json'],
  ];

  for (const [name, body] of cases) {
    it(`login: ${name} -> 422, not 500`, async () => {
      const res = await raw(login, '/api/v1/auth/login', body);
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.status).not.toBe(500);
    });
  }

  it('forgot-password: empty body -> 422', async () => {
    expect((await raw(forgot, '/api/v1/auth/forgot-password', '')).status).toBe(422);
  });

  it('reset-password: empty newPassword -> 422 (was 500)', async () => {
    const res = await raw(reset, '/api/v1/auth/reset-password', '{"token":"x","newPassword":""}');
    expect(res.status, JSON.stringify(res.body)).toBe(422);
  });

  it('login: well-formed unknown account still answers 401, not 422/500 (no enumeration)', async () => {
    await clearLimit(limits.loginPerIp('unknown'));
    const res = await raw(
      login,
      '/api/v1/auth/login',
      JSON.stringify({ email: `nobody.${randomBytes(4).toString('hex')}@example.test`, password: 'whatever123' }),
    );
    expect(res.status).toBe(401);
  });
});

describe('Retention landmine: platform-owner only', () => {
  it('a non-owner platform session cannot trigger retention (403)', async () => {
    const suffix = randomBytes(4).toString('hex');
    const plain = await prisma.platformUser.create({
      data: {
        email: `ret.plain.${suffix}@platform.test`,
        normalizedEmail: `ret.plain.${suffix}@platform.test`,
        fullName: 'Retention Plain',
        passwordHash: 'x',
        status: 'ACTIVE',
        platformRole: 'USER',
      },
    });
    try {
      const cookie = await createPlatformSessionToken(plain.id);
      const res = await post(retention, '/api/v1/admin/retention', { dryRun: true }, cookie);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    } finally {
      await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
    }
  });

  it('an unauthenticated request cannot trigger retention', async () => {
    const res = await raw(retention, '/api/v1/admin/retention', '{"dryRun":true}');
    expect([401, 403]).toContain(res.status);
  });
});
