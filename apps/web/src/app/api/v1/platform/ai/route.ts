import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma, withPlatformTx } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { resetPriceCache } from '@/lib/ai/pricing';
import { validateSteps, FALLBACK_TRIGGERS } from '@/lib/ai/routing';
import { GUARDRAIL_BY_KEY, type GuardrailKey } from '@/lib/ai/guardrails';
import { AI_FEATURE_KEYS, AI_PROVIDERS } from '@/lib/ai/features';

/**
 * The AI Control Center's writes: prices, budgets, guardrail overrides and
 * model routes.
 *
 * One route rather than four, because each of them is the same three steps —
 * authorize as the platform owner, validate, record what changed in the
 * platform audit log — and four copies of that is four places for one of them
 * to drift. The resource is a field, which is also what lets a single audit
 * entry describe any of them.
 *
 * No secret is read or written here. Provider keys stay in the environment and
 * credential layers; everything on this route is policy.
 */
const price = z.object({
  resource: z.literal('price'),
  provider: z.enum(AI_PROVIDERS),
  model: z.string().min(1).max(120),
  inputPerM: z.number().min(0).max(10_000),
  outputPerM: z.number().min(0).max(10_000),
  currency: z.string().length(3).default('USD'),
  effectiveFrom: z.coerce.date(),
});

const budget = z.object({
  resource: z.literal('budget'),
  id: z.string().cuid().optional(),
  scope: z.enum(['PLATFORM', 'PROVIDER', 'PLAN', 'TENANT', 'FEATURE', 'USER']),
  scopeId: z.string().min(1).max(120).nullable().default(null),
  feature: z.string().min(1).max(120).nullable().default(null),
  tokenLimit: z.number().int().min(0).nullable().default(null),
  costLimit: z.number().min(0).nullable().default(null),
  currency: z.string().length(3).default('USD'),
  period: z.enum(['DAILY', 'MONTHLY']).default('MONTHLY'),
  thresholds: z.array(z.number().int().min(1).max(100)).max(5).default([70, 85, 95]),
  action: z
    .enum(['ALERT_ONLY', 'CHEAPER_MODEL', 'DISABLE_OPTIONAL', 'REQUIRE_APPROVAL', 'BLOCK'])
    .default('ALERT_ONLY'),
  hardLimit: z.boolean().default(false),
  enabled: z.boolean().default(true),
  note: z.string().max(500).nullable().default(null),
});

const guardrail = z.object({
  resource: z.literal('guardrail'),
  key: z.string().min(1).max(64),
  scope: z.enum(['PLATFORM', 'TENANT', 'FEATURE']).default('PLATFORM'),
  scopeId: z.string().min(1).max(120).nullable().default(null),
  enabled: z.boolean(),
  config: z.record(z.string(), z.number()).default({}),
});

const route = z.object({
  resource: z.literal('route'),
  feature: z.string().min(1).max(120),
  strategy: z.enum(['QUALITY_FIRST', 'BALANCED', 'COST_OPTIMIZED']).default('BALANCED'),
  steps: z.array(z.unknown()).min(1),
  fallbackTriggers: z.array(z.enum(FALLBACK_TRIGGERS)).default([]),
  deterministicFallback: z.boolean().default(true),
  enabled: z.boolean().default(true),
});

/**
 * One person's allowance inside one workspace.
 *
 * `tokenLimit: null` removes the override and the person falls back to whatever
 * the workspace, the plan or the platform says — which is the whole point of an
 * inheritance chain and the only honest way to spell "reset". `tokenLimit: 0` is
 * the opposite: an explicit "no AI for this account".
 */
const userBudget = z.object({
  resource: z.literal('user-budget'),
  tenantId: z.string().min(1).max(120),
  userId: z.string().min(1).max(120),
  feature: z.string().min(1).max(120).nullable().default(null),
  tokenLimit: z.number().int().min(0).nullable().default(null),
  costLimit: z.number().min(0).nullable().default(null),
  period: z.enum(['DAILY', 'MONTHLY']).default('MONTHLY'),
  thresholds: z.array(z.number().int().min(1).max(100)).max(5).default([70, 85, 95]),
  action: z.enum(['ALERT_ONLY', 'CHEAPER_MODEL', 'DISABLE_OPTIONAL', 'REQUIRE_APPROVAL', 'BLOCK']).default('BLOCK'),
  hardLimit: z.boolean().default(false),
  effectiveFrom: z.coerce.date().nullable().default(null),
  effectiveTo: z.coerce.date().nullable().default(null),
  /** Removes the override rather than writing one. */
  reset: z.boolean().default(false),
  reason: z.string().max(500).nullable().default(null),
});

/** A workspace ceiling, or its per-person default — two different rows. */
const workspaceBudget = z.object({
  resource: z.literal('workspace-budget'),
  tenantId: z.string().min(1).max(120),
  kind: z.enum(['ceiling', 'per-user', 'feature']),
  feature: z.string().min(1).max(120).nullable().default(null),
  tokenLimit: z.number().int().min(0).nullable().default(null),
  costLimit: z.number().min(0).nullable().default(null),
  period: z.enum(['DAILY', 'MONTHLY']).default('MONTHLY'),
  thresholds: z.array(z.number().int().min(1).max(100)).max(5).default([70, 85, 95]),
  action: z
    .enum(['ALERT_ONLY', 'CHEAPER_MODEL', 'DISABLE_OPTIONAL', 'REQUIRE_APPROVAL', 'BLOCK'])
    .default('ALERT_ONLY'),
  hardLimit: z.boolean().default(false),
  reset: z.boolean().default(false),
  reason: z.string().max(500).nullable().default(null),
});

/** The same change across several people at once, for a company with hundreds. */
const bulkUserBudget = z.object({
  resource: z.literal('bulk-user-budget'),
  tenantId: z.string().min(1).max(120),
  userIds: z.array(z.string().min(1).max(120)).min(1).max(500),
  tokenLimit: z.number().int().min(0).nullable().default(null),
  period: z.enum(['DAILY', 'MONTHLY']).default('MONTHLY'),
  action: z.enum(['ALERT_ONLY', 'CHEAPER_MODEL', 'DISABLE_OPTIONAL', 'REQUIRE_APPROVAL', 'BLOCK']).default('BLOCK'),
  hardLimit: z.boolean().default(false),
  /** Removes every named person's override, returning them to the workspace default. */
  reset: z.boolean().default(false),
  reason: z.string().max(500).nullable().default(null),
});

const body = z.discriminatedUnion('resource', [
  price,
  budget,
  guardrail,
  route,
  userBudget,
  workspaceBudget,
  bulkUserBudget,
]);

const removal = z.object({
  resource: z.enum(['price', 'budget', 'guardrail', 'route']),
  id: z.string().min(1).max(120),
});

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const input = body.parse(await req.json());

    let objectId = '';
    if (input.resource === 'price') {
      const row = await prisma.aiModelPrice.upsert({
        where: {
          provider_model_effectiveFrom: {
            provider: input.provider,
            model: input.model,
            effectiveFrom: input.effectiveFrom,
          },
        },
        update: { inputPerM: input.inputPerM, outputPerM: input.outputPerM, currency: input.currency },
        create: {
          provider: input.provider,
          model: input.model,
          inputPerM: input.inputPerM,
          outputPerM: input.outputPerM,
          currency: input.currency,
          effectiveFrom: input.effectiveFrom,
          createdById: ctx.platformUserId,
        },
      });
      resetPriceCache();
      objectId = row.id;
    }

    if (input.resource === 'budget') {
      // A ceiling that names nothing would apply to nothing, and a budget with
      // neither limit is a row that can never be reached.
      if (input.scope !== 'PLATFORM' && !input.scopeId) {
        throw new AppError(
          422,
          'scope-required',
          `A ${input.scope.toLowerCase()} budget must name what it applies to.`,
        );
      }
      if (input.tokenLimit === null && input.costLimit === null) {
        throw new AppError(422, 'limit-required', 'Set a token limit, a cost limit, or both.');
      }
      if (input.feature && !AI_FEATURE_KEYS.includes(input.feature)) {
        throw new AppError(422, 'unknown-feature', `"${input.feature}" is not an AI feature.`);
      }
      const data = {
        scope: input.scope,
        scopeId: input.scope === 'PLATFORM' ? null : input.scopeId,
        feature: input.feature,
        tokenLimit: input.tokenLimit,
        costLimit: input.costLimit,
        currency: input.currency,
        period: input.period,
        thresholds: [...input.thresholds].sort((a, b) => a - b),
        action: input.action,
        hardLimit: input.hardLimit,
        enabled: input.enabled,
        note: input.note,
      };
      // Found first, not upserted. The unique index covers (scope, scopeId,
      // feature, period), and Postgres treats two NULLs as distinct — so the
      // platform ceiling, whose scopeId and feature are both null, matched
      // nothing on the second save and the console grew a second identical row.
      const existing = await prisma.aiBudget.findFirst({
        where: { scope: data.scope, scopeId: data.scopeId, feature: data.feature, period: data.period },
      });
      const target = input.id ?? existing?.id;
      const row = target
        ? await prisma.aiBudget.update({ where: { id: target }, data })
        : await prisma.aiBudget.create({ data: { ...data, createdById: ctx.platformUserId } });
      objectId = row.id;
    }

    if (input.resource === 'guardrail') {
      const definition = GUARDRAIL_BY_KEY.get(input.key as GuardrailKey);
      if (!definition) throw new AppError(422, 'unknown-guardrail', `"${input.key}" is not a guardrail.`);
      // The rule the `locked` column exists for. Refusing here as well as in the
      // resolver means the portal cannot even record the intention.
      if (definition.locked && !input.enabled) {
        throw new AppError(422, 'guardrail-locked', `${definition.label} is mandatory and cannot be switched off.`);
      }
      // Same NULL-distinct trap as the budget above: the platform-level row has
      // a null scopeId, so an upsert on the unique key never matches it.
      const feature = input.scope === 'FEATURE' ? input.scopeId : null;
      const current = await prisma.aiGuardrailPolicy.findFirst({
        where: { key: input.key, scope: input.scope, scopeId: input.scopeId, feature },
      });
      const row = current
        ? await prisma.aiGuardrailPolicy.update({
            where: { id: current.id },
            data: { enabled: input.enabled, config: input.config },
          })
        : await prisma.aiGuardrailPolicy.create({
            data: {
              key: input.key,
              scope: input.scope,
              scopeId: input.scopeId,
              feature,
              enabled: input.enabled,
              locked: definition.locked,
              config: input.config,
              createdById: ctx.platformUserId,
            },
          });
      objectId = row.id;
    }

    if (input.resource === 'route') {
      if (!AI_FEATURE_KEYS.includes(input.feature)) {
        throw new AppError(422, 'unknown-feature', `"${input.feature}" is not an AI feature.`);
      }
      let steps;
      try {
        steps = validateSteps(input.steps);
      } catch (err) {
        throw new AppError(422, 'invalid-route', (err as Error).message);
      }
      const data = {
        strategy: input.strategy,
        steps: steps as unknown as object,
        fallbackTriggers: input.fallbackTriggers,
        deterministicFallback: input.deterministicFallback,
        enabled: input.enabled,
      };
      const row = await prisma.aiRoute.upsert({
        where: { feature: input.feature },
        update: data,
        create: { feature: input.feature, ...data, createdById: ctx.platformUserId },
      });
      objectId = row.id;
    }

    if (input.resource === 'user-budget' || input.resource === 'bulk-user-budget') {
      const userIds = input.resource === 'bulk-user-budget' ? input.userIds : [input.userId];
      // Every id is checked against the workspace before anything is written.
      // An allowance is addressed by a raw id, and without this a typo, or a
      // deliberately pasted id from another company, would silently create a
      // row governing somebody else's employee.
      const known = await withPlatformTx((tx) =>
        tx.user.findMany({
          where: { tenantId: input.tenantId, id: { in: userIds }, deletedAt: null },
          select: { id: true },
        }),
      );
      const missing = userIds.filter((id) => !known.some((k) => k.id === id));
      if (missing.length) {
        throw new AppError(422, 'unknown-user', `${missing.length} of the accounts named are not in this workspace.`);
      }

      const feature = input.resource === 'user-budget' ? input.feature : null;
      const before = await prisma.aiBudget.findMany({
        where: { scope: 'USER', scopeId: { in: userIds }, feature, period: input.period },
        select: { id: true, scopeId: true, tokenLimit: true },
      });

      if (input.reset) {
        await prisma.aiBudget.deleteMany({
          where: { scope: 'USER', scopeId: { in: userIds }, feature, period: input.period },
        });
      } else {
        if (input.tokenLimit === null && (input.resource === 'bulk-user-budget' || input.costLimit === null)) {
          throw new AppError(422, 'limit-required', 'Set a token limit, or choose Reset to remove the override.');
        }
        for (const userId of userIds) {
          const data = {
            scope: 'USER' as const,
            scopeId: userId,
            feature,
            appliesPerUser: false,
            tokenLimit: input.tokenLimit,
            costLimit: input.resource === 'user-budget' ? input.costLimit : null,
            period: input.period,
            thresholds: input.resource === 'user-budget' ? [...input.thresholds].sort((a, b) => a - b) : [70, 85, 95],
            action: input.action,
            hardLimit: input.hardLimit,
            enabled: true,
            effectiveFrom: input.resource === 'user-budget' ? input.effectiveFrom : null,
            effectiveTo: input.resource === 'user-budget' ? input.effectiveTo : null,
            note: input.reason,
          };
          const existing = before.find((b) => b.scopeId === userId);
          if (existing) await prisma.aiBudget.update({ where: { id: existing.id }, data });
          else await prisma.aiBudget.create({ data: { ...data, createdById: ctx.platformUserId } });
        }
      }

      await prisma.platformAuditEvent.create({
        data: {
          tenantId: input.tenantId,
          actorUserId: ctx.platformUserId,
          event: input.reset ? 'AI_USER_OVERRIDE_REMOVED' : 'AI_USER_LIMIT_CHANGED',
          objectType: 'ai_user_budget',
          objectId: userIds.join(','),
          requestId,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: {
            tenantId: input.tenantId,
            userIds,
            feature,
            period: input.period,
            previous: before.map((b) => ({
              userId: b.scopeId,
              tokenLimit: b.tokenLimit === null ? null : Number(b.tokenLimit),
            })),
            tokenLimit: input.reset ? null : input.tokenLimit,
            action: input.action,
            hardLimit: input.hardLimit,
            reason: input.reason,
          },
        },
      });
      return NextResponse.json({ ok: true, count: userIds.length }, { headers: { 'x-request-id': requestId } });
    }

    if (input.resource === 'workspace-budget') {
      if (input.kind === 'feature' && !input.feature) {
        throw new AppError(422, 'feature-required', 'Choose the feature this budget covers.');
      }
      if (input.feature && !AI_FEATURE_KEYS.includes(input.feature)) {
        throw new AppError(422, 'unknown-feature', `"${input.feature}" is not an AI feature.`);
      }
      const workspace = await prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { id: true } });
      if (!workspace) throw new AppError(422, 'unknown-workspace', 'That workspace does not exist.');

      const where = {
        scope: 'TENANT' as const,
        scopeId: input.tenantId,
        feature: input.kind === 'feature' ? input.feature : null,
        appliesPerUser: input.kind === 'per-user',
        period: input.period,
      };
      const existing = await prisma.aiBudget.findFirst({ where });
      if (input.reset) {
        if (existing) await prisma.aiBudget.delete({ where: { id: existing.id } });
      } else {
        if (input.tokenLimit === null && input.costLimit === null) {
          throw new AppError(422, 'limit-required', 'Set a token limit, a cost limit, or both.');
        }
        const data = {
          ...where,
          tokenLimit: input.tokenLimit,
          costLimit: input.costLimit,
          thresholds: [...input.thresholds].sort((a, b) => a - b),
          action: input.action,
          hardLimit: input.hardLimit,
          enabled: true,
          note: input.reason,
        };
        if (existing) await prisma.aiBudget.update({ where: { id: existing.id }, data });
        else await prisma.aiBudget.create({ data: { ...data, createdById: ctx.platformUserId } });
      }

      await prisma.platformAuditEvent.create({
        data: {
          tenantId: input.tenantId,
          actorUserId: ctx.platformUserId,
          event: 'AI_WORKSPACE_BUDGET_CHANGED',
          objectType: `ai_workspace_${input.kind}`,
          objectId: input.tenantId,
          requestId,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: {
            kind: input.kind,
            feature: input.feature,
            previous:
              existing?.tokenLimit === undefined || existing?.tokenLimit === null ? null : Number(existing.tokenLimit),
            tokenLimit: input.reset ? null : input.tokenLimit,
            costLimit: input.reset ? null : input.costLimit,
            reason: input.reason,
          },
        },
      });
      return NextResponse.json({ ok: true }, { headers: { 'x-request-id': requestId } });
    }

    await prisma.platformAuditEvent.create({
      data: {
        actorUserId: ctx.platformUserId,
        event: 'AI_POLICY_CHANGED',
        objectType: `ai_${input.resource}`,
        objectId,
        requestId,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: input as unknown as object,
      },
    });

    return NextResponse.json({ ok: true, id: objectId }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    return problem(error, requestId);
  }
}

export async function DELETE(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const { resource, id } = removal.parse(await req.json());

    if (resource === 'price') await prisma.aiModelPrice.delete({ where: { id } });
    if (resource === 'budget') await prisma.aiBudget.delete({ where: { id } });
    if (resource === 'guardrail') await prisma.aiGuardrailPolicy.delete({ where: { id } });
    if (resource === 'route') await prisma.aiRoute.delete({ where: { id } });
    if (resource === 'price') resetPriceCache();

    await prisma.platformAuditEvent.create({
      data: {
        actorUserId: ctx.platformUserId,
        event: 'AI_POLICY_REMOVED',
        objectType: `ai_${resource}`,
        objectId: id,
        requestId,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });

    return NextResponse.json({ ok: true }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    return problem(error, requestId);
  }
}

function problem(error: unknown, requestId: string) {
  if (error instanceof AppError) {
    return NextResponse.json(error.toProblem(requestId), {
      status: error.status,
      headers: { 'x-request-id': requestId },
    });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { status: 422, title: 'Validation failed', requestId, errors: error.flatten() },
      { status: 422 },
    );
  }
  return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
}
