import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { ingestRecording, type IngestRecordingJob } from '@/services/shared/ingestRecording';

export function startMediaWorker() {
  return new Worker(
    'media',
    async (job) => {
      if (job.name === 'recording.ingest') return ingestRecording(job.data as IngestRecordingJob);
      logger.warn({ jobName: job.name }, 'unknown media job');
    },
    { connection: redis },
  );
}
