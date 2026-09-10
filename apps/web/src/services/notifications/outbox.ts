/**
 * Notifications that survive the process that decided on them.
 *
 * ── The defect this replaces ────────────────────────────────────────────────
 *
 * Notifications were written *after* the transaction that caused them, which is
 * the right ordering: a notice enqueued inside a transaction that then rolls
 * back tells somebody about work they do not have.
 *
 * The cost of that ordering is a window, and a conditional timestamp does not
 * close it. `sweepTriageNotifications` stamped `notifiedAt` with a conditional
 * UPDATE and then created the notification. That stops two workers claiming the
 * same notice — and it *causes* the loss when the winner dies after claiming:
 * the stamp is committed, so no later sweep will ever pick the row up again. The
 * hand-back in the catch block only helps when the process survives long enough
 * to run it, which is exactly not the case being defended against.
 *
 * Escalation had the same shape: `escalatedAt` claimed, then the notification
 * written, with nothing between them if the worker died.
 *
 * ── The shape that works ────────────────────────────────────────────────────
 *
 * The *decision* to notify is committed in the same transaction as the business
 * change, as a row here. Delivery is a separate, resumable step. A crash at any
 * point leaves either "no change and no notice" or "change and a pending
 * notice" — never "change and nothing".
 *
 * The claim is a **lease**, not a flag. A worker that dies mid-delivery stops
 * renewing it; the lease lapses and the next sweep may take the row. A boolean
 * `claimed` would strand it forever, which is the original bug wearing a
 * different column name.
 *
 * ── What can and cannot be promised ─────────────────────────────────────────
 *
 * **In-app is exactly-once.** The `Notification` row and the outbox row's
 * `DELIVERED` stamp are written in one transaction against one database, so
 * "delivered but not recorded" is not a reachable state, and the unique
 * `eventKey` means a replayed decision converges on one row.
 *
 * **External channels are at-least-once.** Email, push and WhatsApp acknowledge
 * to a provider, not to this database; a crash between the provider accepting
 * and the attempt being recorded produces a retry the provider has already
 * taken. A duplicate email is possible and acceptable, a lost one is not. No
 * code, test or UI copy here claims exactly-once delivery.
 */
import type { Priority } from '@prisma/client';
import { prisma, withPlatformTx, withTx, type TxClient } from '@/lib/db';
import { logger } from '@/lib/logger';

/** Named for `scripts/check-raw-sql-scope.mjs`. See distribution/eligibility.ts. */
type TransactionClient = TxClient;

export interface OutboxNotice {
  /**
   * Stable identity of the *logical* notification: one per thing that happened.
   *
   * Derived from the event, never from the clock — `triage.opened:<entryId>` is
   * the same notice however many times the sweep reconsiders it, whereas
   * anything carrying `Date.now()` would be a new one each time.
   */
  eventKey: string;
  userId: string;
  kind: string;
  title: string;
  body?: string | null;
  objectType?: string | null;
  recordId?: string | null;
  priority?: Priority;
}

/**
 * Record the decision to notify, inside the caller's transaction.
 *
 * Must be called with the `tx` that is making the business change. That is the
 * whole mechanism: they commit together or neither does.
 *
 * A duplicate `eventKey` is a no-op rather than an error — a redelivered job
 * re-deciding the same thing is normal, and the second decision is the same
 * decision.
 */
export async function enqueueNotice(tx: TransactionClient, tenantId: string, notice: OutboxNotice): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "NotificationOutbox" (
      "id", "tenantId", "eventKey", "userId", "kind", "title", "body",
      "objectType", "recordId", "priority", "status", "createdAt", "updatedAt"
    )
    VALUES (
      gen_random_uuid()::text, ${tenantId}, ${notice.eventKey}, ${notice.userId},
      ${notice.kind}, ${notice.title}, ${notice.body ?? null},
      ${notice.objectType ?? null}, ${notice.recordId ?? null},
      ${(notice.priority ?? 'MEDIUM') as string}::"Priority", 'PENDING'::"OutboxStatus",
      NOW(), NOW()
    )
    ON CONFLICT ("tenantId", "eventKey") DO NOTHING
  `;
}

/**
 * Withdraw a pending notice whose reason has gone away.
 *
 * An escalation that is answered by an assignment before anyone was told should
 * not then tell them. Only `PENDING` rows are withdrawn: one already delivered
 * is a thing that happened, and deleting it would make the record lie.
 */
export async function withdrawNotice(tx: TransactionClient, tenantId: string, eventKey: string): Promise<number> {
  return tx.$executeRaw`
    DELETE FROM "NotificationOutbox"
     WHERE "tenantId" = ${tenantId} AND "eventKey" = ${eventKey} AND "status" = 'PENDING'
  `;
}

/** How long a worker may hold a row before another may take it. */
const LEASE_MS = 60_000;
/** Past this, the row is left ABANDONED and visible rather than retried forever. */
const MAX_ATTEMPTS = 8;

interface ClaimedRow {
  id: string;
  tenantId: string;
  eventKey: string;
  userId: string;
  kind: string;
  title: string;
  body: string | null;
  objectType: string | null;
  recordId: string | null;
  priority: string;
  attempts: number;
}

/**
 * Deliver what is pending.
 *
 * Claims with `FOR UPDATE SKIP LOCKED` and a lease, so concurrent sweeps split
 * the work rather than one blocking on the other or both delivering the same
 * row. The claim and the read are one statement; there is no window between
 * deciding to take a row and having taken it.
 */
export async function deliverOutbox(
  worker = `w-${process.pid}`,
  now = new Date(),
  batch = 200,
  /**
   * Restrict to one workspace.
   *
   * The worker passes nothing and sweeps every tenant, which is the point of an
   * outbox. An operator draining one workspace, and a test that must not claim
   * another suite's rows out of a shared database, pass one — the alternative in
   * a test is a cross-file race that looks like a product defect and is not.
   */
  tenantId?: string,
): Promise<{ delivered: number; abandoned: number; failed: number }> {
  const claimed = await withPlatformTx(
    (tx) =>
      tx.$queryRaw<ClaimedRow[]>`
      UPDATE "NotificationOutbox" o
         SET "claimedBy" = ${worker},
             "claimedUntil" = ${new Date(now.getTime() + LEASE_MS)},
             "attempts" = o."attempts" + 1,
             "updatedAt" = ${now}
       WHERE o."id" IN (
         SELECT i."id" FROM "NotificationOutbox" i
          WHERE i."status" = 'PENDING'
            AND (${tenantId ?? null}::text IS NULL OR i."tenantId" = ${tenantId ?? null})
            AND (i."claimedUntil" IS NULL OR i."claimedUntil" < ${now})
          ORDER BY i."createdAt"
          LIMIT ${batch}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING o."id", o."tenantId", o."eventKey", o."userId", o."kind", o."title",
                o."body", o."objectType", o."recordId", o."priority"::text AS "priority",
                o."attempts"
    `,
  );

  let delivered = 0;
  let abandoned = 0;
  let failed = 0;

  for (const row of claimed) {
    if (row.attempts > MAX_ATTEMPTS) {
      await withTx(
        row.tenantId,
        (tx) =>
          tx.$executeRaw`
          UPDATE "NotificationOutbox" SET "status" = 'ABANDONED', "updatedAt" = ${now}
           WHERE "id" = ${row.id} AND "tenantId" = ${row.tenantId}
        `,
      );
      abandoned += 1;
      logger.error({ tenantId: row.tenantId, eventKey: row.eventKey }, 'notification abandoned after repeated failure');
      continue;
    }

    try {
      /**
       * One transaction, one database: the `Notification` row and this row's
       * DELIVERED stamp land together. That is what makes the in-app channel
       * exactly-once — there is no state where somebody has been told and the
       * outbox still thinks they have not.
       */
      await withTx(row.tenantId, async (tx) => {
        await tx.notification.create({
          data: {
            tenantId: row.tenantId,
            userId: row.userId,
            kind: row.kind,
            title: row.title,
            body: row.body,
            objectType: row.objectType,
            recordId: row.recordId,
            priority: row.priority as Priority,
            channels: ['in_app'],
          },
        });
        await tx.$executeRaw`
          UPDATE "NotificationOutbox"
             SET "status" = 'DELIVERED', "deliveredAt" = ${now}, "claimedBy" = NULL,
                 "claimedUntil" = NULL, "updatedAt" = ${now}
           WHERE "id" = ${row.id} AND "tenantId" = ${row.tenantId} AND "status" = 'PENDING'
        `;
      });
      delivered += 1;
    } catch (err) {
      failed += 1;
      // Release the lease so the next sweep retries promptly rather than waiting
      // it out. If *this* write also fails, the lease simply expires — which is
      // the property the lease exists for.
      await withTx(
        row.tenantId,
        (tx) =>
          tx.$executeRaw`
          UPDATE "NotificationOutbox"
             SET "claimedUntil" = NULL, "claimedBy" = NULL,
                 "lastError" = ${String(err).slice(0, 500)}, "updatedAt" = ${now}
           WHERE "id" = ${row.id} AND "tenantId" = ${row.tenantId}
        `,
      ).catch(() => undefined);
      logger.warn({ err, tenantId: row.tenantId, eventKey: row.eventKey }, 'notification delivery failed; will retry');
    }
  }

  if (delivered || abandoned || failed) {
    logger.info({ delivered, abandoned, failed }, 'notification outbox sweep');
  }
  return { delivered, abandoned, failed };
}

/** How many notices are still owed. For the checkpoint, and for monitoring. */
export async function pendingCount(tenantId: string): Promise<number> {
  return prisma.notificationOutbox.count({ where: { tenantId, status: 'PENDING' } });
}
