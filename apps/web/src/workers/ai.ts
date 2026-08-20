import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import {
  analyseCall,
  runCallAudit,
  transcribeCall,
  type AuditJob,
  type CallJob,
  type TranscribeJob,
} from '@/services/shared/callIntelligence';
import { scorePracticeSession, type PracticeScoreJob } from '@/services/shared/practiceScoring';

/**
 * Concurrency is 2, not the BullMQ default of 1.
 *
 * A transcription is minutes of audio and an analysis is a model call; running
 * them strictly one at a time means a single long call blocks every other
 * workspace's queue. It is not higher because each job holds a Gemini or
 * speech-to-text quota slot, and the vendors rate-limit per key, not per worker.
 */
export function startAiWorker() {
  return new Worker(
    'ai',
    async (job) => {
      switch (job.name) {
        case 'transcribe':
          return transcribeCall(job.data as TranscribeJob);
        case 'analyse':
          return analyseCall(job.data as CallJob);
        case 'audit':
          return runCallAudit(job.data as AuditJob);
        case 'practice-score':
          return scorePracticeSession(job.data as PracticeScoreJob);
        default:
          logger.warn({ jobName: job.name }, 'unknown ai job');
      }
    },
    { connection: redis, concurrency: 2 },
  );
}
