import { prisma } from '../db';
import { logger } from '../logger';
import { purgeExpiredCaptures } from '@/services/hr/captureVault';

export interface RetentionResult {
  expiredRecordings: number;
  oldWebhookEvents: number;
  attendanceCaptures: number;
  purgeSummary: Record<string, number>;
}

export async function runRetentionCleanup(dryRun = false): Promise<RetentionResult> {
  const now = new Date();
  const result: RetentionResult = {
    expiredRecordings: 0,
    oldWebhookEvents: 0,
    attendanceCaptures: 0,
    purgeSummary: {},
  };

  // 1. Delete recordings past their retainUntil date
  const expiredRecordings = await prisma.$queryRawUnsafe<{ id: string; callId: string }[]>(
    `SELECT id, "callId" FROM "Recording" WHERE "retainUntil" IS NOT NULL AND "retainUntil" < $1 LIMIT 1000`,
    now,
  );
  result.expiredRecordings = expiredRecordings.length;

  if (!dryRun && expiredRecordings.length > 0) {
    const ids = expiredRecordings.map((r) => r.id);
    // ponytail: batch delete, no S3 cleanup yet — add when storage provider exists
    await prisma.$executeRawUnsafe(`DELETE FROM "Recording" WHERE id = ANY($1::text[])`, ids);
    logger.info({ count: ids.length }, 'retention: deleted expired recordings');
  }

  // 2. Purge processed webhook events older than 30 days
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (!dryRun) {
    const { count } = await prisma.webhookEvent.deleteMany({
      where: { processed: true, processedAt: { lt: thirtyDaysAgo } },
    });
    result.oldWebhookEvents = count;
    if (count > 0) logger.info({ count }, 'retention: purged old webhook events');
  } else {
    result.oldWebhookEvents = await prisma.webhookEvent.count({
      where: { processed: true, processedAt: { lt: thirtyDaysAgo } },
    });
  }

  // 3. Hard-delete soft-deleted records older than 90 days
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const softDeleteTables = ['Call', 'FollowUpTask', 'Event'] as const;

  for (const table of softDeleteTables) {
    if (!dryRun) {
      const res = await prisma.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE "deletedAt" IS NOT NULL AND "deletedAt" < $1`,
        ninetyDaysAgo,
      );
      result.purgeSummary[table] = res;
    } else {
      const [row] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) FROM "${table}" WHERE "deletedAt" IS NOT NULL AND "deletedAt" < $1`,
        ninetyDaysAgo,
      );
      result.purgeSummary[table] = Number(row?.count ?? 0);
    }
  }

  // 4. Attendance capture frames past their retention window. Biometric images
  //    must not accumulate forever — keeping them indefinitely is the part of a
  //    face system that turns a proportionate control into a surveillance
  //    archive.
  if (!dryRun) {
    const captures = await purgeExpiredCaptures();
    result.attendanceCaptures = captures.removed;
    if (captures.removed > 0) logger.info({ ...captures }, 'retention: purged attendance captures');
  }

  logger.info({ dryRun, ...result }, 'retention cleanup complete');
  return result;
}
