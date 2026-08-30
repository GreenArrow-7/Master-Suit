import { Queue, Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { runRetentionCleanup } from '@/lib/jobs/retention';
import { runReminderSweep } from '@/services/crm/reminders';

/**
 * Consumer for the `maintenance` queue — the last slot lib/queue.ts reserved
 * with a retry policy and nothing listening.
 *
 * Its only job today is the retention sweep, which until now ran solely when an
 * operator sent `POST /api/v1/admin/retention` by hand. Every retention window
 * the product states — call recordings, biometric capture frames, webhook
 * payloads, 90-day soft deletes — was therefore aspirational: real in the
 * settings screen, real in the documentation, and enforced by nobody.
 *
 * Daily rather than hourly, because the sweep now batches to exhaustion: a
 * single run drains the whole backlog rather than clearing a fixed slice, so
 * running it more often buys nothing and only widens the window in which a long
 * delete competes with customer traffic.
 */

/** 03:00 UTC — after the working day in every timezone this product ships to. */
const DAILY_PATTERN = '0 3 * * *';

/**
 * Every quarter hour, for the reminder sweep.
 *
 * A reminder is only worth sending before the thing is due, so its cadence is
 * set by how late it is acceptable to be told — not by load. The sweep looks 45
 * minutes ahead and refuses to repeat itself, so this interval can change
 * without anybody being told twice.
 */
const QUARTER_HOURLY_PATTERN = '*/15 * * * *';

export function startMaintenanceWorker() {
  return new Worker(
    'maintenance',
    async (job) => {
      if (job.name === 'retention') {
        // Never a dry run from the scheduler. The dry run exists so an operator
        // can see what a sweep *would* remove before authorising it; a
        // scheduled sweep that only counted would be the current bug wearing a
        // cron expression.
        return runRetentionCleanup(false);
      }
      if (job.name === 'reminders') {
        const result = await runReminderSweep();
        logger.info(result, 'reminder sweep complete');
        return result;
      }
      logger.warn({ jobName: job.name }, 'unknown maintenance job');
    },
    {
      connection: redis,
      // One at a time. The sweep deletes across every tenant and two concurrent
      // passes would contend on the same rows for no gain.
      concurrency: 1,
    },
  );
}

/**
 * Arms the daily sweep. Idempotent: the scheduler id is stable, so every worker
 * start converges on one schedule rather than stacking them — the same property
 * armCampaignScheduler relies on.
 */
export async function armMaintenanceScheduler() {
  const queue = new Queue('maintenance', { connection: redis });
  await queue.upsertJobScheduler('retention-daily', { pattern: DAILY_PATTERN }, { name: 'retention' });
  await queue.upsertJobScheduler(
    'reminders-quarter-hourly',
    { pattern: QUARTER_HOURLY_PATTERN },
    { name: 'reminders' },
  );
  await queue.close();
}
