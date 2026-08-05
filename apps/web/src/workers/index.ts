import { logger } from '@/lib/logger';
import { startAutomationWorker } from './automation';
import { startDistributionWorker } from './distribution';
import { startSlaWorker } from './sla';

/**
 * Entry point for `npm run worker` (PROCESS_ROLE=worker). Three of the nine queues
 * named in docs/00-ARCHITECTURE.md are wired up: automation, distribution, sla —
 * the ones the existing Leads/Accounts/Contacts/Opportunities services already
 * enqueue jobs into. messaging/campaign/import/export/webhook/maintenance have no
 * consumer yet: jobs enqueued to them sit in Redis until a worker is added for
 * them, same as before this file existed.
 */
const workers = [startAutomationWorker(), startDistributionWorker(), startSlaWorker()];

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
