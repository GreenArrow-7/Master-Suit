import { logger } from '@/lib/logger';
import { startAiWorker } from './ai';
import { startAutomationWorker } from './automation';
import { startDistributionWorker } from './distribution';
import { startMediaWorker } from './media';
import { startSlaWorker } from './sla';

/**
 * Entry point for `npm run worker` (PROCESS_ROLE=worker). Five of the eleven
 * queues named in docs/00-ARCHITECTURE.md are wired up: automation, distribution,
 * sla, media and ai. messaging/campaign/import/export/webhook/maintenance have no
 * consumer yet: jobs enqueued to them sit in Redis until a worker is added for
 * them, same as before this file existed.
 *
 * `media` and `ai` matter more than the others for uptime. Without `media`, call
 * recordings stay on the vendor's servers and never reach our bucket, so the
 * download route refuses them and transcription has nothing to read. Without
 * `ai`, every call summary, audit and coaching recommendation stays PENDING
 * forever — the request that asked for one only enqueues it.
 */
const workers = [
  startAutomationWorker(),
  startDistributionWorker(),
  startSlaWorker(),
  startMediaWorker(),
  startAiWorker(),
];

for (const worker of workers) {
  worker.on('failed', (job, err) => logger.error({ err, queue: worker.name, jobId: job?.id }, 'job failed'));
}

logger.info({ queues: workers.map((w) => w.name) }, 'workers started');

async function shutdown() {
  logger.info('workers shutting down');
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
