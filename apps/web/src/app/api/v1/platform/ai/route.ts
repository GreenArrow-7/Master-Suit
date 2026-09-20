import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma } from '@/lib/db';
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

const body = z.discriminatedUnion('resource', [price, budget, guardrail, route]);

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
      const row = input.id
        ? await prisma.aiBudget.update({ where: { id: input.id }, data })
        : await prisma.aiBudget.upsert({
            where: {
              scope_scopeId_feature_period: {
                scope: data.scope,
                scopeId: data.scopeId ?? '',
                feature: data.feature ?? '',
                period: data.period,
              },
            },
            update: data,
            create: { ...data, createdById: ctx.platformUserId },
          });
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
      const row = await prisma.aiGuardrailPolicy.upsert({
        where: {
          key_scope_scopeId_feature: {
            key: input.key,
            scope: input.scope,
            scopeId: input.scopeId ?? '',
            feature: input.scope === 'FEATURE' ? (input.scopeId ?? '') : '',
          },
        },
        update: { enabled: input.enabled, config: input.config },
        create: {
          key: input.key,
          scope: input.scope,
          scopeId: input.scopeId,
          feature: input.scope === 'FEATURE' ? input.scopeId : null,
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
