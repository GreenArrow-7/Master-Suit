/**
 * One logical operation, however many times its request arrives.
 *
 * The manual-assignment endpoint accepted a `requestKey` and did nothing with
 * it. A client that sent the request, lost the response and retried got a 409
 * saying somebody else had dealt with the lead — which was a lie about its own
 * earlier attempt, and left the caller unable to tell "I succeeded" from
 * "somebody beat me to it". Those need different reactions from a person.
 *
 * ── Three questions, kept apart ─────────────────────────────────────────────
 *
 *   - **Is this the same request?** `(tenantId, operation, requestKey)`, unique.
 *   - **Is it asking the same thing?** A fingerprint of the inputs that define
 *     the operation. A replayed key carrying different inputs is a conflict, not
 *     a hit — returning the first call's answer to a second call that asked
 *     something else is the worst outcome available.
 *   - **Is it still about the same thing?** `scopeRef`. A key minted against one
 *     waiting episode must not act on a later one, however identical the inputs.
 *
 * ── Authorization is never cached ───────────────────────────────────────────
 *
 * The record is a *result* cache, not an *authorization* cache. Callers assert
 * permission before reaching this file, and the recorded actor is part of the
 * fingerprint check: a replay by a different actor is a conflict even when every
 * input matches, because who committed to a decision is part of the decision. A
 * leaked key is not a capability.
 *
 * ── Expiry cannot make anything unsafe ──────────────────────────────────────
 *
 * A key whose row has been swept is simply unknown, and an unknown key is
 * treated as a new request — which then meets the operation's own guards (the
 * lead already has an owner; the episode is already resolved) and is refused
 * there, correctly. The row never carries the correctness; it only turns a
 * correct refusal into an exact replay of the original answer.
 *
 * The default window is a **technical** retention, not a business one: how long
 * a retry is still recognisable as a retry. It is deliberately short and is not
 * a record-keeping decision. The durable record of what happened is the
 * assignment history and the audit log, which have their own retention.
 */
import { createHash } from 'node:crypto';
import { Conflict } from '@/lib/errors';
import { prisma, withPlatformTx, type TxClient } from '@/lib/db';
import { logger } from '@/lib/logger';

/** Named for `scripts/check-raw-sql-scope.mjs`. See distribution/eligibility.ts. */
type TransactionClient = TxClient;

/**
 * How long a retry is still recognised as one.
 *
 * Long enough to cover a client's retry budget, a queue's redelivery and a
 * person pressing the button again after a timeout; short enough that a key
 * reused months later is treated as the new intention it almost certainly is.
 * Overridable per operation where a caller has a reason.
 */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A stable hash of what the request asked for.
 *
 * Keys are sorted so field order in the payload cannot make two identical
 * requests look different. The actor is included: see the header.
 */
export function fingerprint(input: Record<string, unknown>): string {
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

export interface IdempotencyRequest {
  tenantId: string;
  operation: string;
  requestKey: string;
  actorUserId: string;
  /** What defines this request. Hashed, never stored raw. */
  input: Record<string, unknown>;
  /** What the operation is about — for triage assignment, the episode id. */
  scopeRef?: string | null;
  ttlMs?: number;
}

export interface Replay<T> {
  replayed: true;
  result: T;
}

/**
 * Look for a previous run of this exact request.
 *
 * Returns the recorded result on a hit, `null` when the key is unknown, and
 * throws `Conflict` when the key is known but was used for something else.
 *
 * Called **after** the operation has asserted its permissions.
 */
export async function findReplay<T>(req: IdempotencyRequest): Promise<Replay<T> | null> {
  const existing = await prisma.idempotentRequest.findFirst({
    where: { tenantId: req.tenantId, operation: req.operation, requestKey: req.requestKey },
    select: { fingerprint: true, actorUserId: true, scopeRef: true, result: true, expiresAt: true },
  });
  if (!existing) return null;

  if (existing.expiresAt <= new Date()) {
    // Expired but not yet swept. Treated as unknown, which is the same thing the
    // sweep would produce a moment later — and safe for the reason in the header.
    return null;
  }

  const wanted = fingerprint({ ...req.input, actorUserId: req.actorUserId });
  if (existing.fingerprint !== wanted) {
    throw Conflict(
      existing.actorUserId !== req.actorUserId
        ? 'That request key was already used by someone else.'
        : 'That request key was already used for a different request.',
    );
  }
  if ((existing.scopeRef ?? null) !== (req.scopeRef ?? null)) {
    // Same key, same inputs, different subject: a replay aimed at an episode
    // that has since been superseded. Refused rather than applied to the new one.
    throw Conflict('That request key belongs to an earlier attempt on this lead.');
  }

  return { replayed: true, result: existing.result as T };
}

/**
 * Record the outcome, **inside the operation's own transaction**.
 *
 * That is the whole mechanism: a result cannot exist without its effect, and an
 * effect cannot exist without its result. A crash before commit leaves neither,
 * and the retry runs the operation again — which is correct, because it never
 * happened.
 *
 * A concurrent duplicate loses on the unique index and is reported as a
 * conflict, which is the honest answer: two identical requests genuinely raced
 * and only one of them did the work.
 */
export async function recordOutcome<T>(tx: TransactionClient, req: IdempotencyRequest, result: T): Promise<void> {
  const expiresAt = new Date(Date.now() + (req.ttlMs ?? DEFAULT_TTL_MS));
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "IdempotentRequest" (
      "id", "tenantId", "operation", "requestKey", "fingerprint", "actorUserId",
      "scopeRef", "result", "createdAt", "expiresAt"
    )
    VALUES (
      gen_random_uuid()::text, ${req.tenantId}, ${req.operation}, ${req.requestKey},
      ${fingerprint({ ...req.input, actorUserId: req.actorUserId })}, ${req.actorUserId},
      ${req.scopeRef ?? null}, ${JSON.stringify(result)}::jsonb, NOW(), ${expiresAt}
    )
    ON CONFLICT ("tenantId", "operation", "requestKey") DO NOTHING
    RETURNING "id"
  `;
  if (rows.length === 0) {
    // Somebody else recorded this key between our lookup and here. Both attempts
    // cannot have done the work — the operation's own guards saw to that — so
    // the loser rolls back and says so.
    throw Conflict('That request is already being processed.');
  }
}

/** Remove expired records. Nothing depends on them; see the header. */
export async function sweepExpiredIdempotency(now = new Date()): Promise<{ removed: number }> {
  const removed = await withPlatformTx(
    (tx) => tx.$executeRaw`DELETE FROM "IdempotentRequest" WHERE "expiresAt" < ${now}`,
  );
  if (removed > 0) logger.info({ removed }, 'expired idempotency records swept');
  return { removed };
}
