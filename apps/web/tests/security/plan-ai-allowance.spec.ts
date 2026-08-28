/**
 * Setting a billing tier's AI ceiling.
 *
 * The enforcement existed and was tested — `assertAiBudget` refuses a workspace
 * over its monthly allowance and never caps one spending its own key. What was
 * missing is the other half: no plan carried an `ai_tokens_monthly` limit and
 * nothing could set one, so `monthlyLimit` always returned null and the ceiling
 * never engaged for anybody. A control that cannot be configured is not a
 * control.
 *
 * The distinction these tests exist to protect is between *unset* and *zero*.
 * Absent means "no ceiling has been decided" and the AI runs unrestricted;
 * writing a row unconditionally would have capped every tier the moment this
 * shipped.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { AI_TOKEN_LIMIT_KEY } from '@/lib/ai/usage';
import { createPlatformSessionToken } from '../helpers/session';
import { post } from '../helpers/request';
import { POST as createPlan } from '@/app/api/v1/platform/plans/route';

const suffix = randomBytes(4).toString('hex');
let ownerCookie = '';
let plainCookie = '';

const planBody = (extra: Record<string, unknown> = {}) => ({
  code: `tier-${suffix}-${Math.random().toString(36).slice(2, 7)}`,
  name: `Tier ${suffix}`,
  modules: ['SALES'],
  maxUsers: 10,
  maxEmployees: 10,
  maxStorageMb: 1024,
  ...extra,
});

const limitOf = async (planId: string) =>
  prisma.planLimit.findFirst({ where: { planId, key: AI_TOKEN_LIMIT_KEY }, select: { value: true } });

beforeAll(async () => {
  const owner = await prisma.platformUser.create({
    data: {
      email: `plan.owner.${suffix}@platform.test`,
      normalizedEmail: `plan.owner.${suffix}@platform.test`,
      fullName: 'Plan Owner',
      passwordHash: 'x',
      status: 'ACTIVE',
      platformRole: 'OWNER',
    },
  });
  ownerCookie = await createPlatformSessionToken(owner.id);

  const plain = await prisma.platformUser.create({
    data: {
      email: `plan.plain.${suffix}@platform.test`,
      normalizedEmail: `plan.plain.${suffix}@platform.test`,
      fullName: 'Plan Plain',
      passwordHash: 'x',
      status: 'ACTIVE',
      platformRole: 'USER',
    },
  });
  plainCookie = await createPlatformSessionToken(plain.id);
});

afterAll(async () => {
  await prisma.subscriptionPlan.deleteMany({ where: { name: { contains: suffix } } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
});

describe('a plan’s monthly AI allowance', () => {
  it('is written when the operator sets one', async () => {
    const res = await post(
      createPlan,
      '/api/v1/platform/plans',
      planBody({ maxAiTokensMonthly: 500_000 }),
      ownerCookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await limitOf(res.body.plan.id)).toEqual({ value: 500_000 });
  });

  it('is absent when omitted, which reads as no ceiling rather than zero', async () => {
    const res = await post(createPlan, '/api/v1/platform/plans', planBody(), ownerCookie);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // The row must not exist. A `0` here would refuse every AI call on the tier.
    expect(await limitOf(res.body.plan.id)).toBeNull();
    // The other limits are still written, so absence is specific to this one.
    const others = await prisma.planLimit.findMany({ where: { planId: res.body.plan.id }, select: { key: true } });
    expect(others.map((l) => l.key).sort()).toEqual(['employees', 'storage_mb', 'users']);
  });

  it('refuses zero rather than treating it as unlimited', async () => {
    const res = await post(createPlan, '/api/v1/platform/plans', planBody({ maxAiTokensMonthly: 0 }), ownerCookie);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('is owner-only, like every other platform write', async () => {
    const res = await post(createPlan, '/api/v1/platform/plans', planBody({ maxAiTokensMonthly: 1000 }), plainCookie);
    expect(res.status).toBe(403);
  });
});
