import { DelayedError, Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { acquireSlot, releaseSlot } from '@/lib/queueFairness';
import { recordQueueDeferred } from '@/lib/metrics';
import {
  analyseCall,
  markTranscriptionExhausted,
  runCallAudit,
  transcribeCall,
  type AuditJob,
  type CallJob,
  type TranscribeJob,
} from '@/services/shared/callIntelligence';
import { scorePracticeSession, type PracticeScoreJob } from '@/services/shared/practiceScoring';

/**
 * ── Concurrency, and why it is now two numbers ──────────────────────────────
 *
 * It used to be one: concurrency 2 for the entire platform, with the reasoning
 * that each job holds a vendor quota slot and the vendors rate-limit per key.
 * That reasoning is sound and unchanged; what it does not address is *whose*
 * jobs get those two slots.
 *
 * BullMQ serves a queue FIFO. One workspace importing a month of recordings puts
 * several thousand transcriptions ahead of everybody else's, so every other
 * tenant's call analysis waits behind them — for hours, with nothing broken and
 * nothing to see. Raising the single number does not fix that: six slots served
 * FIFO out of one tenant's backlog are six slots that tenant holds.
 *
 * So the global number rises and a per-tenant ceiling goes underneath it. One
 * workspace can occupy at most `PER_TENANT` of `GLOBAL` slots however long its
 * backlog is; the rest stay available to whoever else has work.
 */
const GLOBAL = 6;
const PER_TENANT = 2;

/**
 * How long a job whose tenant is at its ceiling waits before trying again.
 *
 * Jittered because otherwise a thousand deferred jobs from the same backlog all
 * come back at the same instant, are all refused again, and the worker spends
 * its time on bookkeeping in bursts. Five seconds is short against a
 * transcription and long enough that re-checking costs nothing.
 */
const DEFER_MS = 5_000;
const defer = () => DEFER_MS + Math.floor(Math.random() * DEFER_MS);

export function startAiWorker() {
  const worker = new Worker(
    'ai',
    async (job, token) => {
      const tenantId = (job.data as { tenantId?: string }).tenantId;

      /**
       * No tenant means no fairness question to answer, and refusing the job
       * would be worse than running it: this is a platform-wide queue, and a
       * payload that has lost its tenantId is a bug to find, not a job to drop.
       */
      if (tenantId) {
        const slot = `${job.id}`;
        if (!(await acquireSlot('ai', tenantId, PER_TENANT, slot))) {
          // Back to the delayed set rather than failing. `DelayedError` is how a
          // BullMQ processor says "not now" — it does not count as an attempt,
          // so a busy tenant's job never exhausts its retries by waiting.
          recordQueueDeferred('ai');
          await job.moveToDelayed(Date.now() + defer(), token);
          throw new DelayedError();
        }
        try {
          return await dispatch(job);
        } finally {
          // In a `finally`, so a thrown job frees its slot. A crash that skips
          // this is covered too — a slot older than the maximum hold is pruned
          // on the next acquire, so a killed worker heals rather than
          // permanently costing that tenant a slot.
          await releaseSlot('ai', tenantId, slot);
        }
      }

      return dispatch(job);
    },
    { connection: redis, concurrency: GLOBAL },
  );

  /**
   * The one place that knows a transcription is finally beaten.
   *
   * `transcribeCall` records `RETRYING` on every failure because it cannot see
   * the attempt budget; BullMQ can, and reports it here once the job has spent
   * the last one. Without this the call sits at `RETRYING` for ever and nobody
   * learns that nothing more is coming — which is the whole gap this closes.
   *
   * `attemptsMade` has already been incremented by the time this fires, so the
   * comparison is against the configured total rather than one less. A job that
   * was `DelayedError`-deferred for tenant fairness never reaches here: that
   * path is not a failure and does not count as an attempt.
   */
  worker.on('failed', (job, err) => {
    if (job?.name !== 'transcribe') return;
    const budget = job.opts.attempts ?? 1;
    if (job.attemptsMade < budget) return;

    const { tenantId, callId } = job.data as TranscribeJob;
    if (!tenantId || !callId) return;
    void markTranscriptionExhausted(tenantId, callId, err.message).catch((markErr) =>
      logger.error({ err: (markErr as Error).message, callId }, 'could not mark transcription exhausted'),
    );
  });

  return worker;
}

async function dispatch(job: { name: string; data: unknown }) {
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
      return undefined;
  }
}
