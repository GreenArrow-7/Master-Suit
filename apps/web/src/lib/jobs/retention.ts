import { prisma, withPlatformTx } from '../db';
import { env } from '../env';
import { logger } from '../logger';
import { deleteObject } from '../storage';
import { deleteCapture, purgeExpiredCaptures } from '@/services/hr/captureVault';

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

/**
 * The tables swept by age, their timestamp, and where their window comes from.
 *
 * `days()` is a function rather than a value because `env` is parsed once at
 * module load and this list is built at module load too — reading the number
 * here would freeze whatever was set when the file was first imported, which is
 * the same shape of bug as a config value captured in a closure. `days: () => 0`
 * sweeps a row once its own timestamp passes; a NULL never matches `< now`.
 *
 * `object` is an SQL expression for an object key that must be deleted with the
 * row: a punch carries the encrypted frame that is the evidence for it.
 */
const RETENTION_TABLES: {
  name: string;
  column: string;
  object?: string;
  /** How the object is removed; attendance captures by default. */
  removeObject?: (key: string) => Promise<void>;
  /** Keep the row when its object could not be removed, so the next run retries it. */
  keepRowOnObjectFailure?: boolean;
  days: () => number | undefined;
}[] = [
  // First, before the soft-delete purge below cascades a call's recordings away
  // with their objects still in the bucket. A provider recording's storageKey is
  // the vendor's URL, not a key of ours: the media worker never ingested it.
  {
    name: 'Recording',
    column: 'retainUntil',
    object: `CASE WHEN "storageBucket" = 'provider' THEN NULL ELSE "storageKey" END`,
    removeObject: deleteObject,
    keepRowOnObjectFailure: true,
    days: () => 0,
  },
  { name: 'AuditLog', column: 'occurredAt', days: () => env.AUDIT_LOG_RETENTION_DAYS },
  {
    name: 'HrAttendancePunch',
    column: 'serverTime',
    object: '"capturePath"',
    days: () => env.ATTENDANCE_PUNCH_RETENTION_DAYS,
  },
  { name: 'PlatformAuditEvent', column: 'occurredAt', days: () => env.PLATFORM_AUDIT_RETENTION_DAYS },
  // One row per AI request. It carries no prompt and no completion, only counts
  // and a machine reason, but it is the fastest-growing table on a busy
  // deployment and an operator who can see a spend curve for ever has also kept
  // a per-person activity trail for ever.
  { name: 'AiEvent', column: 'occurredAt', days: () => env.AI_EVENT_RETENTION_DAYS },
  // Identity documents of a deleted person: the executor sets purgeAt (owner decision: 15
  // days after completion); rows with purgeAt NULL never match `< now`.
  {
    name: 'HrEmployeeDocument',
    column: 'purgeAt',
    object: '"storageKey"',
    removeObject: deleteObject,
    keepRowOnObjectFailure: true,
    days: () => 0,
  },
];

export interface RetentionResult {
  oldWebhookEvents: number;
  expiredSessions: number;
  attendanceCaptures: number;
  purgeSummary: Record<string, number>;
  /**
   * Rows deleted per RETENTION_TABLES entry, kept apart from `purgeSummary` on
   * purpose: those are soft-deleted business rows aging out; these include an
   * audit trail destroyed under a policy somebody chose. A number in the same bag
   * as "old cancelled tasks" is a number nobody looks at twice.
   */
  auditSummary: Record<string, number>;
  /** True when a sweep hit MAX_BATCHES with work still queued. */
  truncated: boolean;
}

export async function runRetentionCleanup(dryRun = false): Promise<RetentionResult> {
  const now = new Date();
  const result: RetentionResult = {
    oldWebhookEvents: 0,
    expiredSessions: 0,
    attendanceCaptures: 0,
    purgeSummary: {},
    auditSummary: {},
    truncated: false,
  };

  // ── 1. Rows past their window: RETENTION_TABLES ─────────────────────────────
  //
  // Batched to exhaustion: a single `LIMIT` meant a backlog larger than one batch
  // could never drain.
  //
  // `AuditLog`, `HrAttendancePunch` and `PlatformAuditEvent` had nothing deleting
  // from them at all — the assessment records the growth as W-7 and the
  // metrics endpoint has been measuring it since. What was missing was never the
  // sweep; it was the number, and the number is a compliance answer rather than
  // an engineering one.
  //
  // So each window is opt-in and **absent means keep**. A deployment that has
  // not decided deletes nothing here and says so once per run, which is the
  // honest state — rather than a default quietly destroying a trail on the
  // strength of a number nobody picked.
  for (const table of RETENTION_TABLES) {
    const days = table.days();
    if (days === undefined) {
      // Logged every run, not once at boot. "No retention policy" is a standing
      // condition somebody should keep meeting rather than a fact that scrolled
      // past on a restart six months ago.
      logger.info({ table: table.name }, 'retention: no policy set, keeping every row');
      continue;
    }

    const cutoff = new Date(now.getTime() - days * 86_400_000);
    let deleted = 0;
    let sweeps = 0;

    // A dry run counts. Paging the way the sweep does would re-read the same first
    // batch on every pass, since nothing is deleted, and report it up to MAX_BATCHES
    // times over as "truncated".
    if (dryRun) {
      const [row] = await withPlatformTx(
        (tx) =>
          tx.$queryRawUnsafe<{ count: bigint }[]>(
            `SELECT count(*) FROM "${table.name}" WHERE "${table.column}" < $1`,
            cutoff,
          ),
        { timeoutMs: TX_TIMEOUT_MS },
      );
      result.auditSummary[table.name] = Number(row?.count ?? 0);
      continue;
    }

    for (;;) {
      if (sweeps++ >= MAX_BATCHES) {
        result.truncated = true;
        logger.warn({ table: table.name, deleted }, 'retention: sweep hit its batch ceiling');
        break;
      }

      // Selected then deleted by id, rather than `DELETE … WHERE occurredAt < $1
      // LIMIT`, which Postgres does not accept — and a bare DELETE with no limit
      // on a table that has never been swept is one statement holding a lock over
      // millions of rows on the first run after a policy is set.
      const due = await withPlatformTx(
        (tx) =>
          tx.$queryRawUnsafe<{ id: string; object: string | null }[]>(
            `SELECT id${table.object ? `, ${table.object} AS object` : ''} FROM "${table.name}"
              WHERE "${table.column}" < $1
              ORDER BY "${table.column}" ASC
              LIMIT ${BATCH}`,
            cutoff,
          ),
        { timeoutMs: TX_TIMEOUT_MS },
      );

      if (due.length === 0) break;
      deleted += due.length;

      // Object before row (see the header), outside the transaction: an S3 round
      // trip has no business holding a database connection.
      const failed = new Set<string>();
      if (table.object) {
        const remove = table.removeObject ?? deleteCapture;
        for (const row of due) {
          if (!row.object) continue;
          try {
            await remove(row.object);
          } catch (err) {
            logger.error({ err, table: table.name, id: row.id }, 'retention: could not delete object');
            if (table.keepRowOnObjectFailure) failed.add(row.id);
          }
        }
      }
      // A row whose object survived is kept so the next run retries it: deleting the row
      // would orphan the file where nothing can find it again.
      // ponytail: if a full batch of rows at the head of the order fails persistently, the
      // same batch is retried up to MAX_BATCHES and everything behind it waits until
      // storage recovers; bounded and logged. Upgrade path: per-row backoff column.
      const ids = due.filter((row) => !failed.has(row.id)).map((row) => row.id);
      deleted -= failed.size;
      if (ids.length === 0) {
        if (due.length < BATCH) break;
        continue;
      }
      await withPlatformTx(
        (tx) => tx.$executeRawUnsafe(`DELETE FROM "${table.name}" WHERE id = ANY($1::text[])`, ids),
        { timeoutMs: TX_TIMEOUT_MS },
      );

      if (due.length < BATCH) break;
    }

    result.auditSummary[table.name] = deleted;
    if (deleted > 0) {
      logger.warn(
        { table: table.name, count: deleted, retentionDays: days, dryRun },
        'retention: deleted rows past their window',
      );
    }
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
