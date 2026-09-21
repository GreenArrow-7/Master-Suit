import type { AiRoute } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { modelCascade } from './cascade';

/**
 * Which models a feature tries, in order, and what makes it move to the next.
 *
 * The cascade this replaces was a deployment variable: one primary model, one
 * fallback, the same pair for every feature and only changeable with a deploy.
 * That is the wrong shape for the question an operator actually has — live
 * coaching needs the fast model and will accept a weaker answer, a compliance
 * audit needs the strong one and will accept waiting. So the chain is per
 * feature, stored, and editable without shipping anything.
 *
 * `GEMINI_FALLBACK_MODEL` is still the answer for a feature with no route, so
 * this is additive: nothing changes for a deployment that configures none.
 */
export interface RouteStep {
  provider: string;
  model: string;
  timeoutMs?: number;
  retries?: number;
}

/** The conditions that move a request down the chain. */
export const FALLBACK_TRIGGERS = [
  'TIMEOUT',
  'RATE_LIMIT',
  'PROVIDER_5XX',
  'INVALID_OUTPUT',
  'CONTEXT_LIMIT',
  'BUDGET_EXCEEDED',
] as const;
export type FallbackTrigger = (typeof FALLBACK_TRIGGERS)[number];

export interface ResolvedRoute {
  feature: string;
  steps: RouteStep[];
  triggers: FallbackTrigger[];
  deterministicFallback: boolean;
  /** True when this came from a stored route rather than the deployment default. */
  configured: boolean;
}

/**
 * Refuses a chain that cannot work: an empty step, a duplicate model (a retry
 * dressed as a fallback), or more steps than a request can afford to wait for.
 * Validation lives here rather than in the route handler so the worker sees the
 * same rule as the portal.
 */
export function validateSteps(steps: unknown): RouteStep[] {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('A route needs at least one model.');
  if (steps.length > 5) throw new Error('A route may have at most five models.');
  const seen = new Set<string>();
  return steps.map((raw, i) => {
    const step = raw as Partial<RouteStep>;
    if (!step?.provider || !step?.model) throw new Error(`Step ${i + 1} needs a provider and a model.`);
    const key = `${step.provider}|${step.model}`;
    if (seen.has(key)) throw new Error(`${step.model} appears twice; a repeat is a retry, not a fallback.`);
    seen.add(key);
    if (step.timeoutMs !== undefined && (step.timeoutMs < 1000 || step.timeoutMs > 120_000)) {
      throw new Error(`Step ${i + 1}: the timeout must be between 1s and 120s.`);
    }
    if (step.retries !== undefined && (step.retries < 0 || step.retries > 5)) {
      throw new Error(`Step ${i + 1}: retries must be between 0 and 5.`);
    }
    return {
      provider: step.provider,
      model: step.model,
      ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
      ...(step.retries === undefined ? {} : { retries: step.retries }),
    };
  });
}

function fromRow(row: AiRoute): ResolvedRoute {
  return {
    feature: row.feature,
    steps: validateSteps(row.steps),
    triggers: (row.fallbackTriggers as FallbackTrigger[]).filter((t) =>
      (FALLBACK_TRIGGERS as readonly string[]).includes(t),
    ),
    deterministicFallback: row.deterministicFallback,
    configured: true,
  };
}

/**
 * The chain for one feature. Falls back to the deployment cascade, whose models
 * are Gemini — the provider the unrouted features already use.
 */
export async function routeFor(feature: string, tenantId?: string | null): Promise<ResolvedRoute> {
  const row = await prisma.aiRoute.findUnique({ where: { feature } });
  if (row?.enabled) {
    try {
      return fromRow(row);
    } catch (err) {
      // A stored route that stopped being valid must not take the feature down
      // with it; the deployment default still answers. Said out loud, though:
      // silently ignoring it made the console report the feature as never
      // configured, so an operator would have re-entered the same broken chain.
      logger.warn(
        { feature, err: (err as Error).message },
        'stored AI route is not valid; falling back to the deployment cascade',
      );
    }
  }
  const models = await modelCascade(tenantId);
  return {
    feature,
    steps: models.map((model) => ({ provider: 'google', model })),
    triggers: ['TIMEOUT', 'RATE_LIMIT', 'PROVIDER_5XX'],
    deterministicFallback: true,
    configured: false,
  };
}

/** Whether this failure is one the route says to cascade on. */
export function shouldFallBack(route: ResolvedRoute, reason: string): boolean {
  return route.triggers.includes(reason as FallbackTrigger);
}
