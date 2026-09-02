import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Persisted proof that a worker process is alive, and when it last was.
 *
 * `queueHasWorkers` in lib/queue.ts asks BullMQ who is attached *right now*.
 * That is the right question for "should I run this inline instead", and it is
 * the wrong question for "is anything broken": it returns false for a queue
 * nothing has ever drained and for one whose worker died an hour ago, and those
 * need different responses. The second is the failure this platform has actually
 * had — a worker dead in production for months while every producer kept
 * enqueuing happily, with nothing to notice it by.
 *
 * A row survives a Redis flush and keeps the timestamp, so it answers "it was
 * running until 14:02" rather than only "nothing is running". A TTL'd cache key
 * cannot: when it expires it takes the evidence with it.
 */

/** This process. Several replicas may drain one queue and each must report separately. */
export const WORKER_INSTANCE_ID = `${process.pid.toString(36)}-${randomBytes(3).toString('hex')}`;

/** How often a healthy worker rewrites its row. */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * How long a row may go unwritten before the worker is presumed gone.
 *
 * Four intervals, not one: a worker mid-way through a long job still beats
 * (the timer is independent of job processing), but a slow database or a
 * paused container should not read as an outage on the first missed tick.
 */
export const HEARTBEAT_STALE_MS = HEARTBEAT_INTERVAL_MS * 4;

export async function recordHeartbeat(queues: readonly string[], at: Date = new Date()): Promise<void> {
  for (const queue of queues) {
    await prisma.workerHeartbeat.upsert({
      where: { queue_instanceId: { queue, instanceId: WORKER_INSTANCE_ID } },
      update: { lastSeenAt: at },
      create: { queue, instanceId: WORKER_INSTANCE_ID, startedAt: at, lastSeenAt: at },
    });
  }
}

/**
 * Starts the timer and returns its stopper.
 *
 * `unref()` so a heartbeat never keeps the process alive on SIGTERM — a worker
 * that refuses to exit is a worse problem than one whose last beat is a few
 * seconds stale.
 */
export function startHeartbeat(queues: readonly string[]): () => void {
  const beat = () =>
    void recordHeartbeat(queues).catch((err) =>
      // Logged, never thrown: failing to *report* health must not take down the
      // process that is healthy enough to report it.
      logger.warn({ err, instanceId: WORKER_INSTANCE_ID }, 'could not record worker heartbeat'),
    );

  beat();
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

export type QueueHealth = {
  queue: string;
  /** LIVE: beating. STALE: beat once and stopped. NEVER_SEEN: no worker ever reported. */
  state: 'LIVE' | 'STALE' | 'NEVER_SEEN';
  instances: number;
  lastSeenAt: Date | null;
};

/**
 * Health for each queue that should have a consumer.
 *
 * The three states are the point. "No worker attached" collapses a queue nobody
 * has ever run and a queue whose worker died into one indistinguishable answer;
 * separating them is the difference between a deployment gap and an incident.
 */
export async function queueHealth(expected: readonly string[], now: Date = new Date()): Promise<QueueHealth[]> {
  const rows = await prisma.workerHeartbeat.findMany({ where: { queue: { in: expected as string[] } } });
  const cutoff = new Date(now.getTime() - HEARTBEAT_STALE_MS);

  return expected.map((queue) => {
    const beats = rows.filter((row) => row.queue === queue);
    const live = beats.filter((row) => row.lastSeenAt > cutoff);
    const lastSeenAt = beats.reduce<Date | null>(
      (latest, row) => (!latest || row.lastSeenAt > latest ? row.lastSeenAt : latest),
      null,
    );

    return {
      queue,
      state: live.length > 0 ? 'LIVE' : lastSeenAt ? 'STALE' : 'NEVER_SEEN',
      instances: live.length,
      lastSeenAt,
    };
  });
}
