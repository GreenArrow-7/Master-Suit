/**
 * The operational record of every exchange with an external provider.
 *
 * §33 asks a question the platform could not answer: "why are Facebook leads not
 * arriving?" `WebhookEvent` answers half of it — it is the idempotency claim for
 * inbound deliveries and records that one arrived and whether it processed. The
 * other half was invisible: every reply, dial and template send went to stdout
 * and was then gone, so "we tried and Meta refused" was not a question anybody
 * could ask of the database.
 *
 * ── The one rule ────────────────────────────────────────────────────────────
 *
 * This is a log, not a ledger. Nothing reads it to make a decision, so a failure
 * to write it must never become a failure of the thing it describes. Every entry
 * point here swallows its own errors into a warning. A dial that succeeded and
 * went unrecorded is a gap in a report; a dial that failed *because* the report
 * could not be written is an outage.
 */
import type { IntegrationDirection, IntegrationErrorCategory, IntegrationOutcome } from '@prisma/client';

import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { TelephonyApiError } from '@/lib/integrations/telephony/http';
import { withAttemptCount } from '@/lib/integrations/retry';

/** Long enough to hold a vendor's complaint, short enough to keep the table small. */
const MAX_MESSAGE = 500;

export interface IntegrationEventInput {
  tenantId: string;
  provider: string;
  direction: IntegrationDirection;
  operation: string;
  outcome: IntegrationOutcome;
  errorCategory?: IntegrationErrorCategory;
  detail?: string;
  httpStatus?: number;
  attempts?: number;
  durationMs?: number;
  externalId?: string | null;
  /** What this produced on our side — the missing half of "the lead arrived". */
  entityType?: string | null;
  entityId?: string | null;
}

export async function recordIntegrationEvent(input: IntegrationEventInput): Promise<void> {
  try {
    await prisma.integrationEvent.create({
      data: {
        tenantId: input.tenantId,
        provider: input.provider,
        direction: input.direction,
        operation: input.operation.slice(0, 80),
        outcome: input.outcome,
        errorCategory: input.errorCategory,
        detail: input.detail?.slice(0, MAX_MESSAGE),
        httpStatus: input.httpStatus,
        attempts: input.attempts ?? 1,
        durationMs: input.durationMs,
        externalId: input.externalId ?? undefined,
        entityType: input.entityType ?? undefined,
        entityId: input.entityId ?? undefined,
      },
    });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, provider: input.provider, operation: input.operation },
      'could not record integration event',
    );
  }
}

/**
 * The HTTP status a provider answered with, dug out of whatever it was thrown as.
 *
 * Every adapter here throws something different — `TelephonyApiError` carries it
 * as a field, the Graph helpers put it on a plain Error, and `fetch` itself
 * throws a TypeError with no status at all.
 */
export function httpStatusOf(err: unknown): number | undefined {
  if (err instanceof TelephonyApiError) return err.status;
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

/**
 * What kind of failure this is, in terms an administrator can act on.
 *
 * Categories rather than raw status codes because the vendors disagree about
 * codes: Meta answers 200 with an error body, Twilio uses 401 for a bad token
 * and 403 for a suspended account, Knowlarity uses 400 for both. What an
 * administrator does about it — reconnect, widen a scope, slow down, wait, or
 * open a bug — is the useful axis, and it is stable across vendors.
 *
 * The status code decides where one exists, because it is the vendors' one point
 * of agreement. Only when there is none does this read the message, which is the
 * unreliable half: `UNKNOWN` is an honest answer and a growing count of it means
 * this function needs another case, not that the message matching should get
 * cleverer.
 */
export function categoriseIntegrationError(err: unknown): IntegrationErrorCategory {
  const status = httpStatusOf(err);
  if (status !== undefined) {
    if (status === 401) return 'AUTH';
    if (status === 403) return 'PERMISSION';
    if (status === 404) return 'NOT_FOUND';
    if (status === 408 || status === 504) return 'TIMEOUT';
    if (status === 429) return 'RATE_LIMIT';
    if (status >= 500) return 'UNAVAILABLE';
    if (status >= 400) return 'INVALID_REQUEST';
  }

  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  // AbortSignal.timeout throws a DOMException named TimeoutError; undici's own
  // deadline is an AbortError. Both mean the same thing to a reader.
  if (/TimeoutError|AbortError|ETIMEDOUT|timed? ?out/i.test(message)) return 'TIMEOUT';
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up/i.test(message)) return 'UNAVAILABLE';
  return 'UNKNOWN';
}

export interface EventScope {
  tenantId: string;
  provider: string;
  direction: IntegrationDirection;
  operation: string;
  /**
   * What the successful result produced, when it produced something. Called only
   * on success, and its own failure is swallowed — a mapper that throws must not
   * turn a completed call into a failed one.
   */
  describe?: (result: unknown) => { externalId?: string | null; entityType?: string | null; entityId?: string | null };
}

/**
 * Runs one exchange with a provider and records what happened either way.
 *
 * Rethrows on failure, always. Callers decide what a refusal means to them; this
 * only makes sure it is written down first.
 */
export function withIntegrationEvent<T>(scope: EventScope, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const common = {
    tenantId: scope.tenantId,
    provider: scope.provider,
    direction: scope.direction,
    operation: scope.operation,
  };

  return withAttemptCount(async (attempts) => {
    try {
      const value = await fn();
      let described: ReturnType<NonNullable<EventScope['describe']>> = {};
      try {
        described = scope.describe?.(value) ?? {};
      } catch (err) {
        logger.warn({ err: (err as Error).message, operation: scope.operation }, 'integration event describe failed');
      }
      await recordIntegrationEvent({
        ...common,
        outcome: 'OK',
        attempts: attempts(),
        durationMs: Date.now() - started,
        ...described,
      });
      return value;
    } catch (err) {
      await recordIntegrationEvent({
        ...common,
        outcome: 'FAILED',
        errorCategory: categoriseIntegrationError(err),
        detail: err instanceof Error ? err.message : String(err),
        httpStatus: httpStatusOf(err),
        attempts: attempts(),
        durationMs: Date.now() - started,
      });
      throw err;
    }
  });
}
