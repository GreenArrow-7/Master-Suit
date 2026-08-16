import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { redis } from './redis';
import { logger } from './logger';

export type QueueName =
  | 'automation'
  | 'distribution'
  | 'sla'
  | 'messaging'
  | 'campaign'
  | 'import'
  | 'export'
  | 'webhook'
  | 'maintenance'
  /** Fetching call recordings out of a vendor and into our own bucket. */
  | 'media'
  /** Transcription, Gemini analysis and the call audit that follows them. */
  | 'ai'
  /** Email for in-app notifications that have already been written. */
  | 'notifications';

const RETRY: Record<QueueName, { attempts: number; backoff: any }> = {
  automation: { attempts: 5, backoff: { type: 'exponential', delay: 2_000 } },
  distribution: { attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
  sla: { attempts: 3, backoff: { type: 'fixed', delay: 30_000 } },
  messaging: { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
  campaign: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  import: { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } },
  export: { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } },
  webhook: { attempts: 5, backoff: { type: 'exponential', delay: 10_000 } },
  maintenance: { attempts: 1, backoff: { type: 'fixed', delay: 0 } },
  // Vendors publish recording media a little after they announce it, and some
  // 404 for a few seconds. Long backoff, several attempts: the alternative to
  // retrying is losing the only copy of a client conversation.
  media: { attempts: 6, backoff: { type: 'exponential', delay: 15_000 } },
  // Model and speech vendors rate-limit and have outages. Four attempts over
  // roughly eight minutes; past that the row is left FAILED with the vendor's
  // message on it, which a human can act on, rather than retried forever.
  ai: { attempts: 4, backoff: { type: 'exponential', delay: 30_000 } },
  // The in-app notification is already written by the time one of these is
  // queued, so a failure here loses the email and nothing else. Five attempts
  // over a few minutes covers an SMTP host having a bad moment; past that the
  // person still has the notification waiting for them in the product.
  notifications: { attempts: 5, backoff: { type: 'exponential', delay: 10_000 } },
};

const queues = new Map<QueueName, Queue>();

function queue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: redis,
      defaultJobOptions: { removeOnComplete: 1_000, removeOnFail: 5_000, ...RETRY[name] },
    });
    queues.set(name, q);
  }
  return q;
}

export interface EnqueueOptions {
  delayMs?: number;
  /** Convenience so callers can write `enqueue(..., { skip: !!ownerId })` inline. */
  skip?: boolean;
  /**
   * Explicit user actions ("Re-run analysis") salt the job id so they actually
   * run again. Without it, the payload-hash id converges on the COMPLETED job
   * BullMQ retains — which is exactly right for webhook replays and exactly
   * wrong for a button whose whole point is a second run.
   */
  fresh?: boolean;
}

/**
 * Whether any worker process is currently attached to a queue. Used by routes
 * that prefer the queue but can run the work inline when nothing would ever
 * drain it (a dev box or demo without `npm run worker`). Errs on the side of
 * "a worker exists" so a Redis hiccup never triggers double execution.
 */
export async function queueHasWorkers(name: QueueName): Promise<boolean> {
  try {
    const workers = await queue(name).getWorkers();
    return workers.length > 0;
  } catch (err) {
    logger.warn({ err, queue: name }, 'could not inspect queue workers; assuming present');
    return true;
  }
}

/**
 * Idempotent by construction: jobId is a hash of the payload, so a retry or a
 * duplicate trigger converges on one side effect rather than two.
 */
export async function enqueue(
  name: QueueName,
  jobName: string,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
) {
  if (opts.skip) return null;

  const jobId = createHash('sha256')
    .update(`${name}:${jobName}:${JSON.stringify(payload)}${opts.fresh ? `:${Date.now()}` : ''}`)
    .digest('hex')
    .slice(0, 32);

  try {
    return await queue(name).add(jobName, payload, { jobId, delay: opts.delayMs });
  } catch (err) {
    // A queue outage must not fail the user's write. The maintenance sweeper
    // re-derives missed SLA and distribution work from the database.
    logger.error({ err, queue: name, jobName }, 'enqueue failed');
    return null;
  }
}
