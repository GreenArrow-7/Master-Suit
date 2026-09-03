import type { Worker } from 'bullmq';
import type { QueueName } from '@/lib/queue';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { startAiWorker } from './ai';
import { startAutomationWorker } from './automation';
import { armCampaignScheduler, startCampaignWorker } from './campaigns';
import { startDistributionWorker } from './distribution';
import { armMaintenanceScheduler, startMaintenanceWorker } from './maintenance';
import { startMediaWorker } from './media';
import { startNotificationsWorker } from './notifications';
import { startSlaWorker } from './sla';
import { startWebhookWorker } from './webhook';
import { startHeartbeat, WORKER_INSTANCE_ID } from '@/lib/workerHeartbeat';

/**
 * Entry point for the worker process (PROCESS_ROLE=worker) — `npm run worker`
 * locally, the `worker` image stage in a deployment.
 *
 * ── Why this file asserts rather than hopes ─────────────────────────────────
 *
 * The compose files used to start this process with `node dist/workers/index.js`
 * against an image that contains no `dist/`. The container exited instantly, on
 * every deployment, and nothing anywhere noticed: no other service depends on
 * the worker, so `docker compose up -d` reported success and the queues simply
 * went unconsumed. Inbound Meta leads were stored and never applied. Every AI
 * analysis stayed PENDING. Recordings never left the vendor's servers. SLA
 * timers never fired.
 *
 * A silent failure that costs the product its entire asynchronous half deserves
 * a loud, early check, so this does three things the previous version did not:
 *
 *   1. **Waits for every worker to actually attach.** Constructing a BullMQ
 *      Worker does not connect it; `waitUntilReady()` is what proves Redis
 *      answered. Without this, "workers started" was printed before a single
 *      connection existed and was true of a process that could consume nothing.
 *
 *   2. **Exits non-zero when one cannot.** A worker that cannot consume must
 *      die, so a restart policy retries it and a crash loop is visible, rather
 *      than sitting "up" and idle. This is the property that makes
 *      `restart: unless-stopped` mean something.
 *
 *   3. **Refuses to compile with a queue nobody drains.** `CONSUMERS` is keyed
 *      by `QueueName`, so adding a queue to lib/queue.ts without a worker here
 *      is a type error rather than jobs sitting in Redis forever. This replaced
 *      a start-up log that named three such queues — `messaging`, `import` and
 *      `export` — which were declared with retry policies, had no consumer, and
 *      stayed that way precisely because a log line is not a build failure.
 *      They have since been deleted; the type is what keeps the gap from
 *      reopening.
 */

/**
 * Every queue lib/queue.ts can enqueue to, and who drains it.
 *
 * `Record<QueueName, ...>` is exhaustive both ways: a queue with no worker and a
 * worker for a queue that no longer exists are each a compile error.
 */
const CONSUMERS: Record<QueueName, () => Worker> = {
  automation: startAutomationWorker,
  distribution: startDistributionWorker,
  sla: startSlaWorker,
  media: startMediaWorker,
  ai: startAiWorker,
  notifications: startNotificationsWorker,
  campaign: startCampaignWorker,
  webhook: startWebhookWorker,
  maintenance: startMaintenanceWorker,
};

/** Redis answering should take milliseconds. Ten seconds is a dead dependency. */
const READY_TIMEOUT_MS = 10_000;

async function ready(worker: Worker): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`queue "${worker.name}" did not connect within ${READY_TIMEOUT_MS}ms`)),
      READY_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([worker.waitUntilReady(), deadline]);
  } finally {
    // Cleared either way: an un-cleared timer keeps the event loop alive and the
    // process would refuse to exit on SIGTERM.
    if (timer) clearTimeout(timer);
  }
}

const workers: Worker[] = [];
let stopHeartbeat: (() => void) | null = null;

async function start() {
  for (const [name, startWorker] of Object.entries(CONSUMERS)) {
    workers.push(startWorker());
    logger.debug({ queue: name }, 'worker constructed');
  }

  const results = await Promise.allSettled(workers.map(ready));
  const failed = results.flatMap((result, index) =>
    result.status === 'rejected' ? [{ queue: workers[index]!.name, reason: String(result.reason) }] : [],
  );

  if (failed.length > 0) {
    logger.error({ failed }, 'workers failed to attach — refusing to run as a process that consumes nothing');
    // Best effort: give the healthy ones a chance to close cleanly, then go.
    await Promise.allSettled(workers.map((worker) => worker.close()));
    process.exit(1);
  }

  // Schedulers only after every consumer is attached, so a repeatable job can
  // never be armed by a process that turns out to be unable to run it.
  const schedulers = [...(await armCampaignScheduler()), ...(await armMaintenanceScheduler())];

  // The realtime call engine: only where a public wss URL says vendors will
  // actually be pointed at it. Without one, dialling works exactly as before
  // and no port is opened.
  if (env.LIVE_STREAM_WS_URL) {
    const { startLiveStreamServer } = await import('./liveStream');
    startLiveStreamServer();
  }

  for (const worker of workers) {
    worker.on('failed', (job, err) => logger.error({ err, queue: worker.name, jobId: job?.id }, 'job failed'));
    worker.on('error', (err) => logger.error({ err, queue: worker.name }, 'worker error'));
  }

  /**
   * Start reporting only once every consumer is attached.
   *
   * A heartbeat written before `ready` would claim a queue is being drained by a
   * process that is still connecting, which is exactly the false green this
   * exists to remove.
   */
  stopHeartbeat = startHeartbeat(workers.map((worker) => worker.name));

  logger.info(
    /**
     * `schedulers` was a hard-coded pair and had already drifted: it still read
     * ['campaign-sweep', 'retention-daily'] after a third schedule was added, so
     * the one line that says what this process arms was quietly wrong. The arm
     * functions now report what they armed.
     */
    { queues: workers.map((w) => w.name), schedulers, instanceId: WORKER_INSTANCE_ID },
    'workers started',
  );
}

let shuttingDown = false;
async function shutdown(signal: string) {
  // A second SIGTERM during a slow drain must not start a second close.
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'workers shutting down');
  // Stop beating before draining: a heartbeat written while closing would say
  // this process is consuming a queue it is in the middle of letting go of.
  stopHeartbeat?.();
  await Promise.allSettled(workers.map((worker) => worker.close()));
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

start().catch((err) => {
  logger.error({ err }, 'worker process failed to start');
  process.exit(1);
});
