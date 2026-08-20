import { prisma, withPlatformTx } from '../db';
import { logger } from '../logger';
import { deleteObject } from '../storage';
import { purgeExpiredCaptures } from '@/services/hr/captureVault';

/**
 * Data retention: the sweep that makes every stated retention window real.
 *
 * Three things were wrong here and each hid the next.
 *
 * 1. **Nothing ran it.** It had exactly one caller, `POST /api/v1/admin/retention`,
 *    so every window in the product depended on an operator remembering. There
 *    is now a `maintenance` worker with a daily schedule — see
 *    `src/workers/maintenance.ts`.
 *
 * 2. **It could not see the rows.** Every table below except PlatformSession is
 *    FORCE ROW LEVEL SECURITY, and this ran through the global client with no
 *    `app.tenant_id` and no `app.platform_admin`. Raw queries bypass the tenant
 *    guard extension (see `$queryRaw` in lib/db.ts) but they do not bypass
 *    Postgres, so every SELECT matched zero rows and every DELETE deleted
 *    nothing — while the job logged success and returned a tidy set of zeros.
 *    The work now runs inside `withPlatformTx`, which asserts the
 *    `app.platform_admin` flag the policies name. That is precisely what that
 *    escape hatch is for: a sweep that legitimately spans tenants.
 *
 * 3. **It abandoned the audio.** Deleting a `Recording` row left the object in
 *    the bucket with nothing pointing at it, so a recording "deleted" under a
 *    retention policy — or in answer to a deletion request — was still there.
 *    The object goes first now, then the row.
 *
 * Ordering, deliberately: object, then row. If the process dies between the two,
 * the row survives pointing at a missing object and the next sweep finishes the
 * job — `deleteObject` on an absent key is a no-op. The reverse order loses the
 * pointer and orphans the object permanently, which is the bug being fixed.
 */

/** Rows per batch. Small enough to stay inside one transaction comfortably. */
const BATCH = 500;

/** Generous, because this is a sweep and not a request. See withPlatformTx. */
const TX_TIMEOUT_MS = 120_000;

/** A sweep must terminate even if something keeps re-qualifying rows. */
const MAX_BATCHES = 200;

export interface RetentionResult {
  expiredRecordings: number;
  /** Objects removed from the bucket. Lower than expiredRecordings when a
   *  recording was still hosted by the telephony vendor and we never ingested it. */
  recordingObjects: number;
  oldWebhookEvents: number;
  expiredSessions: number;
  attendanceCaptures: number;
  purgeSummary: Record<string, number>;
  /** True when a sweep hit MAX_BATCHES with work still queued. */
  truncated: boolean;
}

export async function runRetentionCleanup(dryRun = false): Promise<RetentionResult> {
  const now = new Date();
  const result: RetentionResult = {
    expiredRecordings: 0,
    recordingObjects: 0,
    oldWebhookEvents: 0,
    expiredSessions: 0,
    attendanceCaptures: 0,
    purgeSummary: {},
    truncated: false,
  };

  // ── 1. Recordings past retainUntil ─────────────────────────────────────────
  //
  // Batched to exhaustion rather than one `LIMIT 1000`. The old cap meant a
  // backlog larger than a thousand could never drain: every run cleared the same
  // thousand-row slice and the tail stayed forever.
  let batches = 0;
  for (;;) {
    if (batches++ >= MAX_BATCHES) {
      result.truncated = true;
      logger.warn({ batches, removed: result.expiredRecordings }, 'retention: recording sweep hit its batch ceiling');
      break;
    }

    const due = await withPlatformTx(
      (tx) =>
        tx.$queryRawUnsafe<{ id: string; storageKey: string; storageBucket: string | null }[]>(
          `SELECT id, "storageKey", "storageBucket" FROM "Recording"
            WHERE "retainUntil" IS NOT NULL AND "retainUntil" < $1
            ORDER BY "retainUntil" ASC
            LIMIT ${BATCH}`,
          now,
        ),
      { timeoutMs: TX_TIMEOUT_MS },
    );

    if (due.length === 0) break;
    result.expiredRecordings += due.length;

    if (dryRun) {
      // Counting only. A dry run must not touch the bucket either — that was
      // never true of the object half, because the object half did not exist.
      if (due.length < BATCH) break;
      continue;
    }

    // Object first, outside the transaction: an S3 round trip has no business
    // holding a database connection, and a failure here must not roll back a
    // delete that already happened in the bucket.
    for (const recording of due) {
      // `storageBucket === 'provider'` marks a recording the media worker has
      // not ingested yet: the bytes are still on the vendor's servers and
      // `storageKey` is their URL, not a key of ours. Nothing to delete.
      if (recording.storageBucket === 'provider' || !recording.storageKey) continue;
      try {
        await deleteObject(recording.storageKey);
        result.recordingObjects += 1;
      } catch (err) {
        // Logged and skipped, not thrown. One unreachable object must not stop
        // the sweep; the row stays and the next run tries again.
        logger.error({ err, recordingId: recording.id }, 'retention: could not delete recording object');
      }
    }

    const ids = due.map((r) => r.id);
    await withPlatformTx((tx) => tx.$executeRawUnsafe(`DELETE FROM "Recording" WHERE id = ANY($1::text[])`, ids), {
      timeoutMs: TX_TIMEOUT_MS,
    });
    logger.info({ count: ids.length }, 'retention: deleted expired recordings');

    if (due.length < BATCH) break;
  }

  // ── 2. Processed webhook events older than 30 days ─────────────────────────
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  result.oldWebhookEvents = await withPlatformTx(
    (tx) =>
      dryRun
        ? tx.webhookEvent.count({ where: { processed: true, processedAt: { lt: thirtyDaysAgo } } })
        : tx.webhookEvent
            .deleteMany({ where: { processed: true, processedAt: { lt: thirtyDaysAgo } } })
            .then((r) => r.count),
    { timeoutMs: TX_TIMEOUT_MS },
  );
  if (result.oldWebhookEvents > 0) {
    logger.info({ count: result.oldWebhookEvents, dryRun }, 'retention: purged old webhook events');
  }

  // ── 3. Soft-deleted records older than 90 days ─────────────────────────────
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  // Identifiers, not values: these are interpolated into the statement, so the
  // list is a closed literal and never reaches this function from a caller.
  const softDeleteTables = ['Call', 'FollowUpTask', 'Event'] as const;

  for (const table of softDeleteTables) {
    result.purgeSummary[table] = await withPlatformTx(
      async (tx) => {
        if (dryRun) {
          const [row] = await tx.$queryRawUnsafe<{ count: bigint }[]>(
            `SELECT count(*) FROM "${table}" WHERE "deletedAt" IS NOT NULL AND "deletedAt" < $1`,
            ninetyDaysAgo,
          );
          return Number(row?.count ?? 0);
        }
        return tx.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE "deletedAt" IS NOT NULL AND "deletedAt" < $1`,
          ninetyDaysAgo,
        );
      },
      { timeoutMs: TX_TIMEOUT_MS },
    );
  }

  // ── 4. Sessions that can never be used again ───────────────────────────────
  //
  // PlatformSession is outside RLS (it is how a tenant is resolved in the first
  // place), so this needs no platform flag. Nothing deleted these before: every
  // sign-in wrote a row, every refresh wrote another, and the table grew for the
  // life of the deployment. A revoked or expired session is a spent credential
  // record with no remaining purpose.
  //
  // The grace window keeps recently-revoked rows readable for a little while, so
  // an operator investigating "why was I signed out" still has the evidence.
  const sessionGrace = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const staleSessions = {
    OR: [{ expiresAt: { lt: sessionGrace } }, { revokedAt: { lt: sessionGrace } }],
  };
  result.expiredSessions = dryRun
    ? await prisma.platformSession.count({ where: staleSessions })
    : (await prisma.platformSession.deleteMany({ where: staleSessions })).count;
  if (result.expiredSessions > 0) {
    logger.info({ count: result.expiredSessions, dryRun }, 'retention: purged spent sessions');
  }

  // ── 5. Attendance capture frames past their window ─────────────────────────
  //
  // Biometric images must not accumulate forever — keeping them indefinitely is
  // the part of a face system that turns a proportionate control into a
  // surveillance archive.
  if (!dryRun) {
    const captures = await purgeExpiredCaptures();
    result.attendanceCaptures = captures.removed;
    if (captures.removed > 0) logger.info({ ...captures }, 'retention: purged attendance captures');
  }

  logger.info({ dryRun, ...result }, 'retention cleanup complete');
  return result;
}
