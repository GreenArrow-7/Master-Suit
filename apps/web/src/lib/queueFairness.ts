import { redis } from './redis';
import { logger } from './logger';

/**
 * Per-tenant slot accounting, so one workspace's backlog cannot take the whole
 * worker.
 *
 * ── The starvation this exists for ──────────────────────────────────────────
 *
 * The `ai` worker ran at concurrency 2 for the entire platform, and BullMQ
 * serves a queue FIFO. One workspace importing a month of recordings puts
 * several thousand transcriptions in front of everybody else's, and every other
 * tenant's call analysis waits behind them — for hours, with nothing broken and
 * nothing to see. Section 18 of the assessment names this as the constraint that
 * binds at roughly 100 organizations.
 *
 * Raising concurrency alone does not fix it: ten slots served FIFO out of one
 * tenant's backlog are ten slots that tenant holds.
 *
 * ── Slots, not queues ───────────────────────────────────────────────────────
 *
 * The usual alternative is a queue per tenant with a round-robin dispatcher,
 * which means a second scheduler process holding state that must survive its own
 * restarts. This gives the same guarantee without it: the worker takes jobs in
 * the usual order, and a job whose tenant already holds its share is pushed back
 * to the delayed set instead of run. With a global concurrency of 6 and a
 * per-tenant cap of 2, one tenant occupies at most a third of the worker however
 * long its backlog is.
 *
 * A deferral costs one Redis round trip, so churning past a large backlog to
 * reach another tenant's job takes milliseconds against the minutes a
 * transcription takes.
 *
 * ── Why a sorted set and a Lua script ───────────────────────────────────────
 *
 * A counter would leak. If a worker is killed mid-job the decrement never runs,
 * that tenant permanently loses a slot, and the damage accumulates with every
 * deployment — presenting as exactly the starvation this was built to fix.
 *
 * So a slot is a member scored by the time it was taken, and slots older than
 * `MAX_HOLD_MS` are pruned on every acquire. A crashed worker's slot heals
 * itself and nothing has to notice the crash.
 *
 * The three operations — prune, count, add — are one script because two workers
 * checking a cap of 2 concurrently would otherwise both read 1 and both proceed.
 */

/** Longer than any job should hold a slot. A long call's transcription is minutes. */
const MAX_HOLD_MS = 30 * 60 * 1000;

const key = (queue: string, tenantId: string) => `q:slots:${queue}:${tenantId}`;

interface SlotCommands {
  acquireSlot(key: string, now: string, maxHoldMs: string, cap: string, member: string): Promise<number>;
}

redis.defineCommand('acquireSlot', {
  numberOfKeys: 1,
  lua: `
    local now       = tonumber(ARGV[1])
    local maxHoldMs = tonumber(ARGV[2])
    local cap       = tonumber(ARGV[3])
    local member    = ARGV[4]

    -- A slot held longer than any job can legitimately take belongs to a worker
    -- that is gone. Pruned here rather than by a sweeper, so it costs nothing
    -- and cannot itself stop running.
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - maxHoldMs)

    if redis.call('ZCARD', KEYS[1]) >= cap then
      return 0
    end

    redis.call('ZADD', KEYS[1], now, member)
    -- So an idle tenant's key does not outlive its usefulness.
    redis.call('PEXPIRE', KEYS[1], maxHoldMs)
    return 1
  `,
});

/**
 * Takes a slot for this tenant, or reports that it has none free.
 *
 * Fails **open**: if Redis cannot answer, the job runs. The alternative is a
 * queue that stops draining entirely when the fairness bookkeeping is
 * unavailable, which trades a fairness problem for an outage.
 */
export async function acquireSlot(queue: string, tenantId: string, cap: number, member: string): Promise<boolean> {
  try {
    const client = redis as unknown as SlotCommands;
    const taken = await client.acquireSlot(
      key(queue, tenantId),
      String(Date.now()),
      String(MAX_HOLD_MS),
      String(cap),
      member,
    );
    return taken === 1;
  } catch (err) {
    logger.warn({ err, queue, tenantId }, 'fairness: could not take a slot; running the job unthrottled');
    return true;
  }
}

/** Gives the slot back. Never throws — a leaked slot is pruned by its own age. */
export async function releaseSlot(queue: string, tenantId: string, member: string): Promise<void> {
  try {
    await redis.zrem(key(queue, tenantId), member);
  } catch (err) {
    logger.warn({ err, queue, tenantId }, 'fairness: could not release a slot; it will expire on its own');
  }
}

/** How many slots a tenant currently holds. For tests and diagnosis. */
export async function slotsHeld(queue: string, tenantId: string): Promise<number> {
  try {
    return await redis.zcard(key(queue, tenantId));
  } catch {
    return 0;
  }
}
