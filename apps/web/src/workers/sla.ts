import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { checkLeadFirstContact } from '@/services/sla/checkLeadFirstContact';

export function startSlaWorker() {
  return new Worker(
    'sla',
    async (job) => {
      if (job.name === 'lead-first-contact') {
        const { tenantId, leadId } = job.data as { tenantId: string; leadId: string };
        return checkLeadFirstContact(tenantId, leadId);
      }
      logger.warn({ jobName: job.name }, 'unknown sla job');
    },
    { connection: redis },
  );
}
