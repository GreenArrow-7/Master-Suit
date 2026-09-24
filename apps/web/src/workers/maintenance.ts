import { Queue, Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { runRetentionCleanup } from '@/lib/jobs/retention';
import { runReminderSweep } from '@/services/crm/reminders';
import { runRecycleSweep } from '@/services/leads/recycle';
import { sweepStaleTriage, sweepTriageDeadlines, sweepTriageNotifications } from '@/services/distribution/triageQueue';
import { deliverOutbox } from '@/services/notifications/outbox';
import { sweepDriftCanary } from '@/services/leads/nextFollowUpReconcile';
import { sweepAccountDeletions } from '@/services/identity/accountDeletion';

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

/**
 * Every five minutes, for the unassigned-lead queue.
 *
 * Faster than the reminder sweep because its unit is a *review deadline a
 * manager configured*, and a workspace that sets a fifteen-minute window would
 * otherwise learn about the breach a quarter of an hour after it happened. The
 * three passes are all idempotent and all no-ops on an empty queue, so the
 * cadence costs a handful of indexed reads when nothing is waiting.
 */
const FIVE_MINUTE_PATTERN = '*/5 * * * *';

/**
 * The maintenance queue's dispatch, as a named function.
 *
 * Lifted out of the `Worker` constructor so a test can drive the **registered**
 * handler rather than a copy of it beside the real one. A copy passes while the
 * original is broken — a job name nobody handles, a payload unpacked wrongly —
 * which is exactly the class of failure a worker test exists to catch.
 */
export async function handleMaintenanceJob(job: {
  name: string;
  /** Carried by a caller that wants a narrower run; the schedules below send none. */
  data?: { platformUserIds?: string[] };
}): Promise<unknown> {
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
  if (job.name === 'triage-sweep') {
    /**
     * Stale first: an entry whose lead already has an owner must not be
     * escalated to a manager who would open it and find the work done. Then
     * deadlines, then the notification backfill.
     *
     * Each pass claims by conditional UPDATE, so two overlapping runs of
     * this job produce one alert between them rather than one each.
     */
    const stale = await sweepStaleTriage();
    const deadlines = await sweepTriageDeadlines();
    const notices = await sweepTriageNotifications();
    /**
     * Delivery last, and in the same pass: the three sweeps above *decide*
     * on notices inside their own transactions, and this is what turns those
     * decisions into notifications people can see. Running it here rather
     * than on its own schedule means a decision is never more than one sweep
     * old, and a crash between the two is recovered by the next pass rather
     * than losing the notice.
     */
    const delivery = await deliverOutbox();
    const result = { ...stale, ...deadlines, ...notices, ...delivery };
    logger.info(result, 'lead triage sweep complete');
    return result;
  }
  if (job.name === 'lead-recycle') {
    /**
     * Returns leads nobody has worked to the pool, for the workspaces that
     * asked for it. Workspaces that have not set `leadRecycleAfterDays` are
     * skipped entirely, so this is a no-op everywhere by default.
     */
    const result = await runRecycleSweep();
    logger.info(result, 'lead recycle sweep complete');
    return result;
  }
  if (job.name === 'follow-up-drift') {
    /**
     * Report-only, by design and without an override.
     *
     * Every writer recomputes under the lead's lock, so a non-zero count here
     * means a path exists that does not — and auto-correcting would hide the
     * one signal that says so. Repair is an operator action against a named
     * workspace, not something a cron does at 03:20.
     */
    const result = await sweepDriftCanary();
    logger.info(result, 'next-follow-up drift canary complete');
    return result;
  }
  if (job.name === 'account-deletions') {
    /**
     * Erasure of accounts whose owner asked for it.
     *
     * Every fifteen minutes rather than daily: this is a person exercising a deletion
     * right, and the timeframe the product states to them is what this interval has to
     * honour. The executor claims each row by conditional UPDATE, so two overlapping runs
     * process each request once between them rather than once each.
     */
    // The scheduled job carries no data, so production sweeps everything due. A caller
    // that names accounts gets only those: the reachability test drives this handler for
    // real, and an unscoped sweep from inside a parallel test run erases the fixtures of
    // whichever sibling suite happens to be mid-assertion.
    const result = await sweepAccountDeletions(20, job.data?.platformUserIds);
    logger.info(result, 'account deletion sweep complete');
    return result;
  }
  logger.warn({ jobName: job.name }, 'unknown maintenance job');
}

export function startMaintenanceWorker() {
  return new Worker('maintenance', handleMaintenanceJob, {
    connection: redis,
    // One at a time. The sweep deletes across every tenant and two concurrent
    // passes would contend on the same rows for no gain.
    concurrency: 1,
  });
}

/**
 * Arms this queue's schedules. Idempotent: the scheduler ids are stable, so
 * every worker start converges on one schedule each rather than stacking them —
 * the same property armCampaignScheduler relies on.
 *
 * Returns the ids it armed so the start-up log can name what is actually
 * running. That line used to be a hard-coded pair and had already gone stale.
 */
export async function armMaintenanceScheduler(): Promise<string[]> {
  // Armed and reported from the same rows. The return value used to be a second, hand-typed
  // copy of these ids, which the comment above says had already gone stale once — and it
  // went stale again the moment the account-deletion schedule was added below it. A list
  // that cannot disagree with itself is the fix; another careful edit is not.
  const schedules: { id: string; pattern: string; name: string }[] = [
    { id: 'retention-daily', pattern: DAILY_PATTERN, name: 'retention' },
    { id: 'reminders-quarter-hourly', pattern: QUARTER_HOURLY_PATTERN, name: 'reminders' },
    { id: 'lead-triage-five-minutely', pattern: FIVE_MINUTE_PATTERN, name: 'triage-sweep' },
    // 03:20, after retention has settled: the canary reads what the night left.
    { id: 'follow-up-drift-daily', pattern: '20 3 * * *', name: 'follow-up-drift' },
    { id: 'account-deletions-quarter-hourly', pattern: QUARTER_HOURLY_PATTERN, name: 'account-deletions' },
    // 04:10, once a day and well clear of the nightly sweeps above. Recycling
    // is not time-critical — a lead dormant for thirty days is not more urgent
    // at 04:10 than at noon — and running it hourly would only multiply the
    // chances of colliding with somebody actually working a record.
    { id: 'lead-recycle-daily', pattern: '10 4 * * *', name: 'lead-recycle' },
  ];
  const queue = new Queue('maintenance', { connection: redis });
  for (const schedule of schedules) {
    await queue.upsertJobScheduler(schedule.id, { pattern: schedule.pattern }, { name: schedule.name });
  }
  await queue.close();
  return schedules.map((schedule) => schedule.id);
}
