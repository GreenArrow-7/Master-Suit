import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { enrollMatchingAutomations, runEnrollmentNode } from '@/services/automation/engine';

export function startAutomationWorker() {
  return new Worker(
    'automation',
    async (job) => {
      if (job.name === 'trigger') {
        const { tenantId, event, object, recordId } = job.data as { tenantId: string; event: string; object: string; recordId: string };
        return enrollMatchingAutomations(tenantId, event, object, recordId);
      }
      if (job.name === 'run-node') {
        const { tenantId, enrollmentId } = job.data as { tenantId: string; enrollmentId: string };
        return runEnrollmentNode(tenantId, enrollmentId);
      }
      logger.warn({ jobName: job.name }, 'unknown automation job');
    },
    { connection: redis },
  );
}
