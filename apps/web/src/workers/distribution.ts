import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { assignLead } from '@/services/distribution/assignLead';

/**
 * The distribution queue's dispatch, as a named function.
 *
 * Exported so a test drives the **registered** handler rather than a copy of it.
 * A copy stays green while the original is broken — a job enqueued under a name
 * nobody handles, a payload unpacked wrongly — which is the failure a worker
 * test is for.
 */
export async function handleDistributionJob(job: { name: string; data: unknown }): Promise<unknown> {
  if (job.name === 'assign-lead') {
    const { tenantId, leadId } = job.data as { tenantId: string; leadId: string };
    return assignLead(tenantId, leadId);
  }
  logger.warn({ jobName: job.name }, 'unknown distribution job');
  return undefined;
}

export function startDistributionWorker() {
  return new Worker('distribution', handleDistributionJob, { connection: redis });
}
