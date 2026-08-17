import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { checkLeadFirstContact } from '@/services/sla/checkLeadFirstContact';
import { escalateSocialSla } from '@/services/social/escalateSocialSla';

export function startSlaWorker() {
  return new Worker(
    'sla',
    async (job) => {
      if (job.name === 'lead-first-contact') {
        const { tenantId, leadId } = job.data as { tenantId: string; leadId: string };
        return checkLeadFirstContact(tenantId, leadId);
      }
      if (job.name === 'social-enquiry-response') {
        const { tenantId, socialCommentId } = job.data as { tenantId: string; socialCommentId: string };
        return escalateSocialSla(tenantId, socialCommentId);
      }
      logger.warn({ jobName: job.name }, 'unknown sla job');
    },
    { connection: redis },
  );
}
