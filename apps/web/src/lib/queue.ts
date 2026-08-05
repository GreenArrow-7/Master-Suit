import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { redis } from './redis';
import { logger } from './logger';

export type QueueName =
  | 'automation' | 'distribution' | 'sla' | 'messaging'
  | 'campaign' | 'import' | 'export' | 'webhook' | 'maintenance';

const RETRY: Record<QueueName, { attempts: number; backoff: any }> = {
  automation:   { attempts: 5, backoff: { type: 'exponential', delay: 2_000 } },
  distribution: { attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
  sla:          { attempts: 3, backoff: { type: 'fixed', delay: 30_000 } },
  messaging:    { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
  campaign:     { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  import:       { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } },
  export:       { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } },
  webhook:      { attempts: 5, backoff: { type: 'exponential', delay: 10_000 } },
  maintenance:  { attempts: 1, backoff: { type: 'fixed', delay: 0 } },
};

const queues = new Map<QueueName, Queue>();

function queue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redis, defaultJobOptions: { removeOnComplete: 1_000, removeOnFail: 5_000, ...RETRY[name] } });
    queues.set(name, q);
  }
  return q;
}

export interface EnqueueOptions {
  delayMs?: number;
  /** Convenience so callers can write `enqueue(..., { skip: !!ownerId })` inline. */
  skip?: boolean;
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
    .update(`${name}:${jobName}:${JSON.stringify(payload)}`)
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
