import { randomBytes } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/db';
import { assignLead } from '@/services/distribution/assignLead';
import { handleDistributionJob } from '@/workers/distribution';
import { handleMaintenanceJob } from '@/workers/maintenance';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * The real worker path, not the service function.
 *
 * `lead-triage.spec.ts` drives the services directly, which is the right place
 * to pin the decisions. It cannot catch a job that is enqueued with a name no
 * worker handles, a payload the handler unpacks wrongly, or a retry that BullMQ
 * delivers twice — and every one of those is a way the queue could silently stop
 * working in production while every service test stayed green.
 *
 * So these run an actual BullMQ worker against an actual queue, driving the
 * **registered** handlers — `handleDistributionJob` and `handleMaintenanceJob`,
 * the same functions `startDistributionWorker` and `startMaintenanceWorker`
 * hand to BullMQ. An earlier version of this file re-implemented those bodies
 * beside the real ones, which would have stayed green while the original was
 * broken. Named queues of their own, so a developer's running worker cannot
 * steal the jobs and a failing test cannot leave work in a shared one.
 */

const suffix = randomBytes(4).toString('hex');
const DISTRIBUTION_QUEUE = `distribution-test-${suffix}`;
const MAINTENANCE_QUEUE = `maintenance-test-${suffix}`;

let fixture: Fixture;
let stageOpenId = '';
const opened: { queue: Queue; worker?: Worker }[] = [];

async function makeLead(): Promise<string> {
  const lead = await prisma.lead.create({
    data: {
      tenantId: fixture.a.tenantId,
      reference: `TRW-${suffix}-${randomBytes(3).toString('hex')}`,
      fullName: 'Worker path buyer',
      stageId: stageOpenId,
      ownerId: null,
      source: 'PUBLIC_FORM',
    },
    select: { id: true },
  });
  return lead.id;
}

/** Wait for a condition, so nothing here depends on a fixed sleep. */
async function until(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const stage = await prisma.leadStage.findFirstOrThrow({
    where: { tenantId: fixture.a.tenantId, category: 'OPEN' },
    select: { id: true },
  });
  stageOpenId = stage.id;
  await prisma.distributionRule.deleteMany({ where: { tenantId: fixture.a.tenantId, objectType: 'LEAD' } });
}, 120_000);

afterAll(async () => {
  for (const { queue, worker } of opened) {
    await worker?.close();
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
  }
  await fixture?.cleanup();
});

describe('the distribution worker', () => {
  it('queues an unassignable lead when the job is delivered through BullMQ', async () => {
    const queue = new Queue(DISTRIBUTION_QUEUE, { connection: redis });
    // The same dispatch `src/workers/distribution.ts` performs.
    const worker = new Worker(DISTRIBUTION_QUEUE, handleDistributionJob, { connection: redis });
    opened.push({ queue, worker });

    const leadId = await makeLead();
    await queue.add('assign-lead', { tenantId: fixture.a.tenantId, leadId });

    const queued = await until(async () =>
      Boolean(
        await prisma.leadTriageEntry.findFirst({
          where: { tenantId: fixture.a.tenantId, leadId, status: 'WAITING' },
        }),
      ),
    );

    expect(queued).toBe(true);
    const entry = await prisma.leadTriageEntry.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, leadId },
    });
    expect(entry.reason).toBe('NO_RULE');
    // The tenant context reached the worker: the row is in the right workspace.
    expect(entry.tenantId).toBe(fixture.a.tenantId);
  });

  it('a redelivered job leaves one entry, not two', async () => {
    const queue = new Queue(`${DISTRIBUTION_QUEUE}-retry`, { connection: redis });
    let deliveries = 0;
    const worker = new Worker(
      `${DISTRIBUTION_QUEUE}-retry`,
      async (job) => {
        deliveries += 1;
        const { tenantId, leadId } = job.data as { tenantId: string; leadId: string };
        const result = await assignLead(tenantId, leadId);
        // Fail the first delivery *after* the work, which is the shape that
        // actually duplicates: the side effect committed and the job retries.
        if (deliveries === 1) throw new Error('simulated worker crash after commit');
        return result;
      },
      { connection: redis },
    );
    opened.push({ queue, worker });

    const leadId = await makeLead();
    await queue.add(
      'assign-lead',
      { tenantId: fixture.a.tenantId, leadId },
      { attempts: 2, backoff: { type: 'fixed', delay: 200 } },
    );

    await until(async () => deliveries >= 2);

    const entries = await prisma.leadTriageEntry.count({
      where: { tenantId: fixture.a.tenantId, leadId },
    });
    expect(deliveries).toBeGreaterThanOrEqual(2);
    expect(entries).toBe(1);
  });
});

describe('the maintenance worker', () => {
  it('runs the three triage sweeps and reports what each did', async () => {
    const queue = new Queue(MAINTENANCE_QUEUE, { connection: redis });
    // The same dispatch `src/workers/maintenance.ts` performs, in the same order.
    const worker = new Worker(MAINTENANCE_QUEUE, handleMaintenanceJob, { connection: redis });
    opened.push({ queue, worker });

    // A lead that went overdue an hour ago, with a manager accountable for it.
    const managerUser = await prisma.user.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, status: 'ACTIVE' },
      select: { id: true, roleId: true },
    });
    await prisma.distributionRule.create({
      data: {
        tenantId: fixture.a.tenantId,
        name: 'Worker rotation',
        objectType: 'LEAD',
        method: 'ROUND_ROBIN',
        isActive: true,
        candidatePool: { userIds: [] },
        escalateAfterMins: 10,
        fallbackUserId: managerUser.id,
      },
    });
    const leadId = await makeLead();
    await assignLead(fixture.a.tenantId, leadId, new Date(Date.now() - 3_600_000));

    const job = await queue.add('triage-sweep', { at: new Date().toISOString() });
    const done = await until(async () => (await job.getState()) === 'completed');
    expect(done).toBe(true);

    const entry = await prisma.leadTriageEntry.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, leadId },
    });
    expect(entry.escalatedAt).not.toBeNull();
    expect(entry.notifiedAt).not.toBeNull();

    const alerts = await prisma.notification.count({
      where: { tenantId: fixture.a.tenantId, kind: 'LEAD_TRIAGE_OVERDUE', recordId: leadId },
    });
    expect(alerts).toBe(1);

    // The whole point of an idempotent sweep: running it again changes nothing.
    const again = await queue.add('triage-sweep', { at: new Date().toISOString() }, { jobId: `second-${suffix}` });
    await until(async () => (await again.getState()) === 'completed');
    const alertsAfter = await prisma.notification.count({
      where: { tenantId: fixture.a.tenantId, kind: 'LEAD_TRIAGE_OVERDUE', recordId: leadId },
    });
    expect(alertsAfter).toBe(1);
  });
});
