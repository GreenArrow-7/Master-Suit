import { randomBytes } from 'node:crypto';
import { Queue, Worker, DelayedError } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';
import { redis } from '@/lib/redis';
import { acquireSlot, releaseSlot, slotsHeld } from '@/lib/queueFairness';

/**
 * One tenant must not be able to take the whole worker.
 *
 * The `ai` worker ran at concurrency 2 for the entire platform and BullMQ serves
 * a queue FIFO, so a workspace importing a month of recordings put several
 * thousand transcriptions ahead of everyone else's work. Every other tenant's
 * call analysis waited behind them — for hours, with nothing broken and nothing
 * to see.
 *
 * The assertion that matters is not "the cap function returns false when it
 * should", which is arithmetic. It is that a real BullMQ worker draining a real
 * queue stuffed with one tenant's backlog still reaches a second tenant's job
 * quickly. That is the last case here, and it is the one that would have failed
 * before.
 */

const suffix = randomBytes(4).toString('hex');
const QUEUE = `fairness-test-${suffix}`;
const created: { queue: Queue; worker?: Worker }[] = [];

afterAll(async () => {
  for (const { queue, worker } of created) {
    await worker?.close();
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
  }
});

const tenant = () => `t-${randomBytes(4).toString('hex')}`;

describe('slot accounting', () => {
  it('hands out exactly the cap and refuses the next', async () => {
    const t = tenant();
    expect(await acquireSlot(QUEUE, t, 2, 'a')).toBe(true);
    expect(await acquireSlot(QUEUE, t, 2, 'b')).toBe(true);
    expect(await acquireSlot(QUEUE, t, 2, 'c')).toBe(false);
    expect(await slotsHeld(QUEUE, t)).toBe(2);
  });

  it('frees a slot on release', async () => {
    const t = tenant();
    await acquireSlot(QUEUE, t, 1, 'a');
    expect(await acquireSlot(QUEUE, t, 1, 'b')).toBe(false);
    await releaseSlot(QUEUE, t, 'a');
    expect(await acquireSlot(QUEUE, t, 1, 'b')).toBe(true);
  });

  it('counts tenants separately', async () => {
    const [a, b] = [tenant(), tenant()];
    expect(await acquireSlot(QUEUE, a, 1, 'x')).toBe(true);
    // b must be unaffected by a being full.
    expect(await acquireSlot(QUEUE, b, 1, 'x')).toBe(true);
    expect(await acquireSlot(QUEUE, a, 1, 'y')).toBe(false);
  });

  it('is atomic under concurrent acquires', async () => {
    // Two workers checking a cap of 2 at the same instant would both read 1 and
    // both proceed if prune/count/add were three round trips instead of one
    // script. Twenty at once, cap of 3.
    const t = tenant();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => acquireSlot(QUEUE, t, 3, `slot-${i}`)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await slotsHeld(QUEUE, t)).toBe(3);
  });

  it('reclaims a slot a dead worker never released', async () => {
    // The failure a plain counter has: a worker killed mid-job never decrements,
    // that tenant permanently loses a slot, and it gets worse every deployment.
    // Slots are scored by acquisition time and pruned by age, so this heals with
    // no sweeper and nothing having to notice the crash.
    const t = tenant();
    const key = `q:slots:${QUEUE}:${t}`;
    await acquireSlot(QUEUE, t, 1, 'abandoned');
    expect(await acquireSlot(QUEUE, t, 1, 'next')).toBe(false);

    // Age it past the 30-minute maximum hold by rewriting its score.
    await redis.zadd(key, Date.now() - 31 * 60 * 1000, 'abandoned');
    expect(await acquireSlot(QUEUE, t, 1, 'next')).toBe(true);
    expect(await slotsHeld(QUEUE, t)).toBe(1);
  });
});

describe('a worker draining a one-tenant backlog', () => {
  it('reaches a second tenant’s job without waiting for the backlog', async () => {
    const [busy, quiet] = [tenant(), tenant()];
    const name = `${QUEUE}-drain`;
    const queue = new Queue(name, { connection: redis });
    created.push({ queue });

    // 40 jobs from one tenant, then one from another — the shape of a workspace
    // importing a backlog while somebody else makes a single call.
    for (let i = 0; i < 40; i += 1) {
      await queue.add('work', { tenantId: busy, n: i }, { jobId: `busy-${suffix}-${i}` });
    }
    await queue.add('work', { tenantId: quiet, n: 0 }, { jobId: `quiet-${suffix}` });

    const order: string[] = [];
    let quietDone: (() => void) | null = null;
    const quietRan = new Promise<void>((resolve) => (quietDone = resolve));

    const worker = new Worker(
      name,
      async (job, token) => {
        const t = job.data.tenantId as string;
        const slot = `${job.id}`;
        if (!(await acquireSlot(name, t, 2, slot))) {
          // Same defer the ai worker uses, shortened so the test is not slow.
          await job.moveToDelayed(Date.now() + 50, token);
          throw new DelayedError();
        }
        try {
          order.push(t);
          if (t === quiet) quietDone?.();
          // Long enough that, without the cap, the busy tenant would hold every
          // slot for the whole test.
          await new Promise((r) => setTimeout(r, 120));
        } finally {
          await releaseSlot(name, t, slot);
        }
      },
      { connection: redis, concurrency: 6 },
    );
    created[created.length - 1]!.worker = worker;

    await Promise.race([
      quietRan,
      new Promise((_, reject) => setTimeout(() => reject(new Error('the quiet tenant never ran')), 15_000)),
    ]);

    // The point of the whole design: the second tenant's single job ran while
    // the first tenant's 40 were still going, not after them. Without the cap
    // the busy tenant holds all six slots and this lands at position ~40.
    const position = order.indexOf(quiet);
    expect(position).toBeGreaterThanOrEqual(0);
    expect(position).toBeLessThan(20);

    // And the cap held throughout: never more than 2 of the busy tenant's jobs
    // were in flight, which is what left room for the other one.
    expect(await slotsHeld(name, busy)).toBeLessThanOrEqual(2);
  }, 30_000);
});
