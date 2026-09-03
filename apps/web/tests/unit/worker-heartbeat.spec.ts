/**
 * A worker that stopped must look different from one that never ran.
 *
 * `queueHasWorkers` asks BullMQ who is attached right now, and returns false for
 * both — which is why a worker process could sit dead in production for months
 * while producers kept enqueuing. These pin the distinction the heartbeat exists
 * to make.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { HEARTBEAT_STALE_MS, WORKER_INSTANCE_ID, queueHealth, recordHeartbeat } from '@/lib/workerHeartbeat';

const suffix = randomBytes(4).toString('hex');
const QUEUE = `test-queue-${suffix}`;
const OTHER = `test-other-${suffix}`;
const NEVER = `test-never-${suffix}`;

beforeEach(async () => {
  await prisma.workerHeartbeat.deleteMany({ where: { queue: { in: [QUEUE, OTHER, NEVER] } } });
});

afterAll(async () => {
  await prisma.workerHeartbeat.deleteMany({ where: { queue: { in: [QUEUE, OTHER, NEVER] } } });
});

describe('worker heartbeat', () => {
  it('reports a beating worker as LIVE', async () => {
    await recordHeartbeat([QUEUE]);
    const [health] = await queueHealth([QUEUE]);
    expect(health!.state).toBe('LIVE');
    expect(health!.instances).toBe(1);
    expect(health!.lastSeenAt).not.toBeNull();
  });

  it('distinguishes a worker that stopped from one that never ran', async () => {
    // Beat, then rewind the row past the staleness window — a process killed
    // without a chance to clean up leaves exactly this.
    await recordHeartbeat([QUEUE]);
    await prisma.workerHeartbeat.update({
      where: { queue_instanceId: { queue: QUEUE, instanceId: WORKER_INSTANCE_ID } },
      data: { lastSeenAt: new Date(Date.now() - HEARTBEAT_STALE_MS - 1_000) },
    });

    const [stopped, neverRan] = await queueHealth([QUEUE, NEVER]);

    expect(stopped!.state, 'it was alive and stopped').toBe('STALE');
    expect(stopped!.lastSeenAt, 'and we still know when').not.toBeNull();
    expect(stopped!.instances).toBe(0);

    expect(neverRan!.state, 'nothing ever drained this one').toBe('NEVER_SEEN');
    expect(neverRan!.lastSeenAt).toBeNull();
  });

  it('is idempotent — beating again updates the row rather than adding one', async () => {
    await recordHeartbeat([QUEUE]);
    const first = await prisma.workerHeartbeat.findFirstOrThrow({
      where: { queue: QUEUE, instanceId: WORKER_INSTANCE_ID },
    });

    await recordHeartbeat([QUEUE], new Date(Date.now() + 1_000));

    const rows = await prisma.workerHeartbeat.findMany({ where: { queue: QUEUE } });
    expect(rows.length, 'one row per instance, however many beats').toBe(1);
    expect(rows[0]!.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
    expect(rows[0]!.startedAt.getTime(), 'the start time is not rewritten').toBe(first.startedAt.getTime());
  });

  it('counts replicas separately rather than collapsing them', async () => {
    // Two processes draining one queue. Collapsing them would report green
    // while all but one were dead.
    await recordHeartbeat([QUEUE]);
    await prisma.workerHeartbeat.create({
      data: { queue: QUEUE, instanceId: `replica-${suffix}`, lastSeenAt: new Date() },
    });

    const [health] = await queueHealth([QUEUE]);
    expect(health!.instances).toBe(2);

    // One dies; the queue is still being drained, but by fewer.
    await prisma.workerHeartbeat.update({
      where: { queue_instanceId: { queue: QUEUE, instanceId: `replica-${suffix}` } },
      data: { lastSeenAt: new Date(Date.now() - HEARTBEAT_STALE_MS - 1_000) },
    });
    const [after] = await queueHealth([QUEUE]);
    expect(after!.state, 'still drained by someone').toBe('LIVE');
    expect(after!.instances).toBe(1);
  });

  it('reports each queue independently', async () => {
    await recordHeartbeat([QUEUE, OTHER]);
    const health = await queueHealth([QUEUE, OTHER, NEVER]);
    expect(health.map((row) => row.state)).toEqual(['LIVE', 'LIVE', 'NEVER_SEEN']);
  });
});
