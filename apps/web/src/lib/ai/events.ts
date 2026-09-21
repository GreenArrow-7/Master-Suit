import type { AiEventKind, AiEventOutcome } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { costMicros, priceFor } from './pricing';

/**
 * One row per AI attempt or refusal.
 *
 * Until now an AI request left three traces — a log line that expires, a
 * monthly token counter, and the feature's own output — and none of them could
 * answer "why did this cost that", "which model actually answered" or "what
 * was refused and by what rule". The portal's overview, provider health,
 * guardrail monitoring and per-company spend all read this table.
 *
 * No prompt or completion text is stored. A machine reason and the counts are
 * enough to investigate an incident without putting customer conversations in
 * an operator's screen.
 *
 * Recording never fails a feature: a metering write that throws would turn a
 * bookkeeping fault into a refused customer request, which is the wrong trade.
 * It is logged and dropped.
 */
export interface AiEventInput {
  tenantId?: string | null;
  userId?: string | null;
  feature: string;
  provider?: string | null;
  model?: string | null;
  kind?: AiEventKind;
  outcome?: AiEventOutcome;
  reason?: string | null;
  attempt?: number;
  /** The step that was tried first, when this answer came from a later one. */
  fellBackFrom?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number | null;
  metadata?: Record<string, unknown>;
}

export async function recordAiEvent(input: AiEventInput): Promise<void> {
  try {
    const inputTokens = Math.max(0, Math.round(input.inputTokens ?? 0));
    const outputTokens = Math.max(0, Math.round(input.outputTokens ?? 0));
    const price =
      input.provider && input.model && (inputTokens || outputTokens)
        ? await priceFor(input.provider, input.model)
        : null;

    await prisma.aiEvent.create({
      data: {
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        feature: input.feature,
        provider: input.provider ?? null,
        model: input.model ?? null,
        kind: input.kind ?? 'REQUEST',
        outcome: input.outcome ?? 'OK',
        reason: input.reason ?? null,
        attempt: input.attempt ?? 1,
        fellBackFrom: input.fellBackFrom ?? null,
        inputTokens,
        outputTokens,
        latencyMs: input.latencyMs ?? null,
        costMicros: costMicros(price, inputTokens, outputTokens),
        currency: price?.currency ?? 'USD',
        priceId: price?.id ?? null,
        metadata: (input.metadata ?? {}) as object,
      },
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message, feature: input.feature }, 'could not record the AI event');
  }
}

/** Why a request ended, in the machine vocabulary the portal filters on. */
export function reasonFor(err: unknown): string {
  const message = (err as Error)?.message ?? '';
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return 'TIMEOUT';
  if (/429|rate.?limit|quota/i.test(message)) return 'RATE_LIMIT';
  if (/\b5\d\d\b|overloaded|unavailable/i.test(message)) return 'PROVIDER_5XX';
  if (/JSON|parse|schema|invalid/i.test(message)) return 'INVALID_OUTPUT';
  if (/context|too long|token limit/i.test(message)) return 'CONTEXT_LIMIT';
  return 'PROVIDER_ERROR';
}
