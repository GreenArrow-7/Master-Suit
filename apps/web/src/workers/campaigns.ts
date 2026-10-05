import { Queue } from 'bullmq';
import { redis } from '@/lib/redis';

/**
 * Arms the once-a-minute campaign sweep (JOBS.campaign). Idempotent: the
 * scheduler id is stable, so every worker start converges on one schedule
 * rather than stacking them.
 */
export async function armCampaignScheduler(): Promise<string[]> {
  const queue = new Queue('campaign', { connection: redis });
  await queue.upsertJobScheduler('campaign-sweep', { every: 60_000 }, { name: 'sweep' });
  await queue.close();
  // Returned so the start-up log can name what is actually armed rather than a
  // literal that drifts the first time somebody adds a schedule.
  return ['campaign-sweep'];
}
