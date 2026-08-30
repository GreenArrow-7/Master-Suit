import { Queue, Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { sweepDueCampaigns } from '@/services/campaigns/scheduler';

/**
 * Consumer for the `campaign` queue — the slot lib/queue.ts reserved with a
 * retry policy but nothing listening. One repeatable job: the lifecycle sweep
 * that starts due SCHEDULED campaigns (sending WhatsApp where configured) and
 * completes RUNNING ones past their end date.
 */
export function startCampaignWorker() {
  return new Worker(
    'campaign',
    async (job) => {
      if (job.name === 'sweep') return sweepDueCampaigns();
      logger.warn({ jobName: job.name }, 'unknown campaign job');
    },
    { connection: redis },
  );
}

/**
 * Arms the once-a-minute sweep. Idempotent: the scheduler id is stable, so
 * every worker start converges on one schedule rather than stacking them.
 */
export async function armCampaignScheduler(): Promise<string[]> {
  const queue = new Queue('campaign', { connection: redis });
  await queue.upsertJobScheduler('campaign-sweep', { every: 60_000 }, { name: 'sweep' });
  await queue.close();
  // Returned so the start-up log can name what is actually armed rather than a
  // literal that drifts the first time somebody adds a schedule.
  return ['campaign-sweep'];
}
