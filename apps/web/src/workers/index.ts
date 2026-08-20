import type { Worker } from 'bullmq';
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
 *   3. **Names the queues it did not wire.** `messaging`, `import` and `export`
 *      are declared in lib/queue.ts with retry policies and have no consumer;
 *      jobs enqueued to them sit in Redis forever. That is a known gap rather
 *      than a defect, and it is logged at every start so it stays known.
 */

/** Every queue lib/queue.ts can enqueue to, and who drains it. */
const CONSUMERS: Record<string, () => Worker> = {
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

/**
 * Declared in lib/queue.ts, deliberately unconsumed. Listed here so the gap is
 * stated at every boot instead of being discovered when a job never runs.
 */
const UNCONSUMED = ['messaging', 'import', 'export'] as const;

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
  await armCampaignScheduler();
  await armMaintenanceScheduler();

  for (const worker of workers) {
    worker.on('failed', (job, err) => logger.error({ err, queue: worker.name, jobId: job?.id }, 'job failed'));
    worker.on('error', (err) => logger.error({ err, queue: worker.name }, 'worker error'));
  }

  logger.info(
    { queues: workers.map((w) => w.name), unconsumed: UNCONSUMED, schedulers: ['campaign-sweep', 'retention-daily'] },
    'workers started',
  );
}

let shuttingDown = false;
async function shutdown(signal: string) {
  // A second SIGTERM during a slow drain must not start a second close.
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'workers shutting down');
  await Promise.allSettled(workers.map((worker) => worker.close()));
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

start().catch((err) => {
  logger.error({ err }, 'worker process failed to start');
  process.exit(1);
});
