import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AI_TOKEN_LIMIT_KEY, USER_TOKEN_LIMIT_KEY, featureLimitKey } from '@/lib/ai/usage';
import { prisma, withPlatformTx } from '@/lib/db';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { PRODUCT_MODULE_KEYS } from '@/lib/modules/catalogue';
import { platformAudit } from '@/lib/security/audit';
import { bareRoute } from '@/lib/api/handler';

const planSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(2).max(120),
  modules: z.array(z.enum(PRODUCT_MODULE_KEYS)).min(1),
  maxUsers: z.number().int().positive().max(100000),
  maxEmployees: z.number().int().positive().max(100000),
  maxStorageMb: z.number().int().positive().max(10000000),
  /**
   * The monthly AI ceiling for this billing tier, in tokens on the shared
   * deployment key. Optional, and absent means unlimited rather than zero:
   * `monthlyLimit` treats a missing row as "no number has been decided", and a
   * platform that has not decided must not refuse work because of a default
   * somebody guessed. Sending 0 would be a decision to refuse every call, which
   * is why the floor is 1.
   */
  maxAiTokensMonthly: z.number().int().positive().max(1_000_000_000).optional(),
  /** §18: per-feature monthly ceilings on the shared key, keyed by the feature name the usage ledger records. */
  /** §18: a ceiling per person per month on the shared key. */
  maxAiTokensMonthlyPerUser: z.number().int().positive().optional(),
  aiTokensMonthlyByFeature: z.record(z.string().regex(/^[a-z0-9-]{2,40}$/), z.number().int().positive()).optional(),
});

export const GET = bareRoute('/api/v1/platform/plans', async (req, requestId) => {
  await requirePlatformOwner(req, requestId);
  const plans = await prisma.subscriptionPlan.findMany({
    include: { planModules: true, planLimits: true, _count: { select: { subscriptions: true } } },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json({ plans });
});

export const POST = bareRoute('/api/v1/platform/plans', async (req, requestId) => {
  const ctx = await requirePlatformOwner(req, requestId);
  const body = planSchema.parse(await req.json());
  const plan = await withPlatformTx(async (tx) => {
    const created = await tx.subscriptionPlan.create({
      data: {
        code: body.code,
        name: body.name,
        modules: body.modules,
        seatLimit: body.maxUsers,
        storageMb: body.maxStorageMb,
        featureLimits: { maxEmployees: body.maxEmployees },
        planModules: { create: body.modules.map((module) => ({ module, enabled: true })) },
        planLimits: {
          create: [
            { key: 'users', value: body.maxUsers },
            { key: 'employees', value: body.maxEmployees },
            { key: 'storage_mb', value: body.maxStorageMb },
            // Only when set. An absent row is what `monthlyLimit` reads as
            // unlimited; writing one unconditionally would cap every tier the
            // moment this shipped.
            ...(body.maxAiTokensMonthly === undefined
              ? []
              : [{ key: AI_TOKEN_LIMIT_KEY, value: body.maxAiTokensMonthly }]),
            ...(body.maxAiTokensMonthlyPerUser === undefined
              ? []
              : [{ key: USER_TOKEN_LIMIT_KEY, value: body.maxAiTokensMonthlyPerUser }]),
            ...Object.entries(body.aiTokensMonthlyByFeature ?? {}).map(([feature, value]) => ({
              key: featureLimitKey(feature),
              value,
            })),
          ],
        },
      },
      include: { planModules: true, planLimits: true },
    });
    await platformAudit(
      ctx,
      {
        event: 'PLAN_CREATED',
        objectType: 'subscription_plan',
        objectId: created.id,
        metadata: { code: created.code, modules: body.modules, aiTokensMonthly: body.maxAiTokensMonthly ?? null },
      },
      tx,
    );
    return created;
  });

  return NextResponse.json({ plan }, { status: 201 });
});
