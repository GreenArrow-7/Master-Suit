import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { assignLead } from '@/services/distribution/assignLead';

export function startDistributionWorker() {
  return new Worker(
    'distribution',
    async (job) => {
      if (job.name === 'assign-lead') {
        const { tenantId, leadId } = job.data as { tenantId: string; leadId: string };
        return assignLead(tenantId, leadId);
      }
      logger.warn({ jobName: job.name }, 'unknown distribution job');
    },
    { connection: redis },
  );
}
