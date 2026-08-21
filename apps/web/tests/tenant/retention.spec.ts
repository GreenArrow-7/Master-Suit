import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma, withPlatformTx } from '@/lib/db';

/**
 * The retention sweep, against row-level security.
 *
 * This suite exists because the sweep silently did nothing. Every table it
 * touches except PlatformSession is FORCE ROW LEVEL SECURITY, and it ran through
 * the global client with neither `app.tenant_id` nor `app.platform_admin` set.
 * Raw queries bypass the tenant-guard extension but not Postgres, so every
 * SELECT matched zero rows, every DELETE removed nothing, and the job logged a
 * tidy set of zeros and returned success.
 *
 * A test that asserted "the sweep completes" would have passed throughout. So
 * every case here seeds rows in **two** tenants and asserts on what is actually
 * gone afterwards — the only shape of assertion the original bug could not
 * satisfy.
 */

const suffix = randomBytes(4).toString('hex');
const deletedKeys: string[] = [];

// The object store is stubbed rather than reached: the assertion that matters is
// *which keys the sweep asks to delete, and in what order relative to the row*.
vi.mock('@/lib/storage', () => ({
  deleteObject: vi.fn(async (key: string) => {
    deletedKeys.push(key);
  }),
}));

// Capture purging walks the filesystem and belongs to its own suite.
vi.mock('@/services/hr/captureVault', () => ({
  purgeExpiredCaptures: vi.fn(async () => ({ removed: 0, tenants: 0 })),
  // Reached only when ATTENDANCE_PUNCH_RETENTION_DAYS is set, which it is not
  // here — stubbed anyway, because a partial mock of a module the subject
  // imports is a break waiting for whoever sets that variable.
  deleteCapture: vi.fn(async () => {}),
}));

const { runRetentionCleanup } = await import('@/lib/jobs/retention');

const tenants = [
  { slug: `ret-a-${suffix}`, id: '', userId: '' },
  { slug: `ret-b-${suffix}`, id: '', userId: '' },
];
let platformUserId = '';

/** Ids this suite created, so teardown never reaches another suite's rows. */
const callIds: string[] = [];

beforeAll(async () => {
  for (const workspace of tenants) {
    const tenant = await prisma.tenant.create({
      data: { slug: workspace.slug, legalName: `${workspace.slug} LLC`, displayName: workspace.slug },
    });
    workspace.id = tenant.id;

    const role = await prisma.role.create({
      data: { tenantId: tenant.id, key: `rep-${suffix}`, name: 'Rep', rank: 60, defaultScope: 'OWN' },
    });
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `agent@${workspace.slug}.test`,
        fullName: 'Agent',
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
    workspace.userId = user.id;

    // Two calls: one recording we ingested, one still hosted by the vendor.
    for (const [index, bucket] of ['leadflow-documents', 'provider'].entries()) {
      const call = await prisma.call.create({
        data: { tenantId: tenant.id, callerId: user.id, direction: 'OUTBOUND', status: 'COMPLETED' },
      });
      callIds.push(call.id);
      await prisma.recording.create({
        data: {
          tenantId: tenant.id,
          callId: call.id,
          storageKey: `recordings/${workspace.slug}/${index}`,
          storageBucket: bucket,
          // Comfortably past its window.
          retainUntil: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        },
      });
    }

    await prisma.webhookEvent.create({
      data: {
        tenantId: tenant.id,
        provider: `meta:${workspace.slug}`,
        externalId: `ext-${workspace.slug}`,
        eventType: 'message',
        payload: {},
        processed: true,
        processedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      },
    });
  }

  const platformUser = await prisma.platformUser.create({
    data: {
      email: `ret-${suffix}@example.test`,
      normalizedEmail: `ret-${suffix}@example.test`,
      fullName: 'Retention Subject',
    },
  });
  platformUserId = platformUser.id;

  await prisma.platformSession.createMany({
    data: [
      {
        platformUserId,
        tokenHash: `spent-${suffix}`,
        expiresAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      },
      {
        platformUserId,
        tokenHash: `live-${suffix}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    ],
  });
});

afterAll(async () => {
  await prisma.platformSession.deleteMany({ where: { platformUserId } });
  await prisma.platformUser.deleteMany({ where: { id: platformUserId } });
  // Cascades clear the tenant-owned rows this suite created.
  await prisma.tenant.deleteMany({ where: { id: { in: tenants.map((t) => t.id) } } });
});

describe('retention sweep', () => {
  it('deletes rows in every tenant, not the zero rows RLS shows an unscoped connection', async () => {
    const before = await withPlatformTx((tx) =>
      tx.recording.count({ where: { tenantId: { in: tenants.map((t) => t.id) } } }),
    );
    expect(before).toBe(4);

    const result = await runRetentionCleanup(false);

    // Other suites may leave their own expired rows behind, so these are floors
    // rather than equalities — the point is that the count is not zero.
    expect(result.expiredRecordings).toBeGreaterThanOrEqual(4);
    expect(result.oldWebhookEvents).toBeGreaterThanOrEqual(2);

    const after = await withPlatformTx((tx) =>
      tx.recording.count({ where: { tenantId: { in: tenants.map((t) => t.id) } } }),
    );
    expect(after).toBe(0);
  });

  it('deletes the object for a recording we hold, and never for one the vendor still hosts', () => {
    for (const workspace of tenants) {
      expect(deletedKeys).toContain(`recordings/${workspace.slug}/0`);
      // storageBucket === 'provider' means storageKey is the vendor's URL, not a
      // key of ours. Asking the bucket to delete it would be meaningless at best.
      expect(deletedKeys).not.toContain(`recordings/${workspace.slug}/1`);
    }
  });

  it('purges spent sessions and leaves live ones signed in', async () => {
    const remaining = await prisma.platformSession.findMany({
      where: { platformUserId },
      select: { tokenHash: true },
    });
    expect(remaining.map((s) => s.tokenHash)).toEqual([`live-${suffix}`]);
  });

  it('reports a dry run without removing anything', async () => {
    const call = await prisma.call.create({
      data: { tenantId: tenants[0]!.id, callerId: tenants[0]!.userId, direction: 'OUTBOUND', status: 'COMPLETED' },
    });
    callIds.push(call.id);
    await prisma.recording.create({
      data: {
        tenantId: tenants[0]!.id,
        callId: call.id,
        storageKey: `recordings/${tenants[0]!.slug}/dry`,
        storageBucket: 'leadflow-documents',
        retainUntil: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    });

    const result = await runRetentionCleanup(true);
    expect(result.expiredRecordings).toBeGreaterThanOrEqual(1);

    // tenantId as well as callId: the tenant guard refuses an unscoped read even
    // under the platform flag, which is the layer-2 half of the isolation doing
    // exactly what it should.
    const survived = await withPlatformTx((tx) =>
      tx.recording.count({ where: { tenantId: tenants[0]!.id, callId: call.id } }),
    );
    expect(survived).toBe(1);
    expect(deletedKeys).not.toContain(`recordings/${tenants[0]!.slug}/dry`);
  });
});
