import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, withPlatformTx } from '@/lib/db';

/**
 * Retention for the three append-only tables.
 *
 * `AuditLog`, `HrAttendancePunch` and `PlatformAuditEvent` had nothing deleting
 * from them — the assessment records the unbounded growth as W-7, and the
 * metrics endpoint has been measuring it since. What was missing was never the
 * sweep; it was the number, because how long an audit trail must be kept, and
 * whether it may be deleted at all, is a compliance answer.
 *
 * So the property this suite cares about most is the *negative* one: a
 * deployment that has not chosen a window deletes nothing. A default here would
 * destroy somebody's trail on the strength of a number nobody picked, silently
 * and irreversibly — the one direction that cannot be undone by changing the
 * setting afterwards.
 *
 * Everything is seeded in **two** tenants and asserted on what is actually gone,
 * for the reason tests/tenant/retention.spec.ts gives at length: these tables are
 * FORCE ROW LEVEL SECURITY, and a sweep that cannot see a row reports the same
 * tidy zero as a sweep that had nothing to do.
 */

const suffix = randomBytes(4).toString('hex');

/** The windows under test, swapped per case. `undefined` is "no policy". */
const windows: {
  audit?: number;
  punch?: number;
  platform?: number;
} = {};

// Only the three fields are overridden; everything else — DATABASE_URL above
// all — stays real, because the sweep runs against a live database.
vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      get AUDIT_LOG_RETENTION_DAYS() {
        return windows.audit;
      },
      get ATTENDANCE_PUNCH_RETENTION_DAYS() {
        return windows.punch;
      },
      get PLATFORM_AUDIT_RETENTION_DAYS() {
        return windows.platform;
      },
    },
  };
});

const deletedCaptures: string[] = [];
vi.mock('@/services/hr/captureVault', () => ({
  purgeExpiredCaptures: vi.fn(async () => ({ removed: 0, workspaces: 0 })),
  deleteCapture: vi.fn(async (relative: string) => {
    deletedCaptures.push(relative);
  }),
}));

// The recordings half of the sweep reaches the bucket; this suite is not about
// that, and an unstubbed call would be a network attempt.
vi.mock('@/lib/storage', () => ({ deleteObject: vi.fn(async () => {}) }));

const { runRetentionCleanup } = await import('@/lib/jobs/retention');

const OLD = new Date(Date.now() - 400 * 86_400_000);
const RECENT = new Date(Date.now() - 2 * 86_400_000);

const tenants = [
  { slug: `aud-a-${suffix}`, id: '' },
  { slug: `aud-b-${suffix}`, id: '' },
];
let platformUserId = '';

/** One old row and one recent row per table per tenant, re-seeded before each case. */
async function seed() {
  for (const workspace of tenants) {
    for (const [label, when] of [
      ['old', OLD],
      ['recent', RECENT],
    ] as const) {
      await prisma.auditLog.create({
        data: {
          tenantId: workspace.id,
          event: 'LOGIN',
          objectType: `${label}-${suffix}`,
          occurredAt: when,
        },
      });
      await prisma.platformAuditEvent.create({
        data: {
          tenantId: workspace.id,
          actorUserId: platformUserId,
          event: `RETENTION_PROBE_${label}`,
          objectType: `${label}-${suffix}`,
          occurredAt: when,
        },
      });
    }
  }
}

/**
 * Counted and cleaned through `withPlatformTx`, exactly as the sweep is.
 *
 * `prisma.auditLog.deleteMany({ where: { objectType } })` trips the tenant guard
 * — correctly: a cross-tenant write with no tenantId is the thing that guard
 * exists to refuse. Reaching for the same platform escape hatch the sweep uses
 * is what a test of a cross-tenant sweep should be doing anyway.
 */
const countRows = async (table: string) => {
  const [row] = await withPlatformTx((tx) =>
    tx.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) FROM "${table}" WHERE "objectType" LIKE $1`,
      `%${suffix}%`,
    ),
  );
  return Number(row?.count ?? 0);
};
const clearRows = (table: string) =>
  withPlatformTx((tx) => tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "objectType" LIKE $1`, `%${suffix}%`));

const auditRows = () => countRows('AuditLog');
const platformRows = () => countRows('PlatformAuditEvent');

beforeAll(async () => {
  for (const workspace of tenants) {
    const tenant = await prisma.tenant.create({
      data: { slug: workspace.slug, legalName: `${workspace.slug} LLC`, displayName: workspace.slug },
    });
    workspace.id = tenant.id;
  }
  const platformUser = await prisma.platformUser.create({
    data: {
      email: `aud-${suffix}@example.test`,
      normalizedEmail: `aud-${suffix}@example.test`,
      fullName: 'Audit Subject',
    },
  });
  platformUserId = platformUser.id;
}, 60_000);

afterAll(async () => {
  await clearRows('PlatformAuditEvent');
  // Cascades clear the tenant-owned rows, which is how the sibling retention
  // suite tidies up too.
  await prisma.tenant.deleteMany({ where: { id: { in: tenants.map((t) => t.id) } } });
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } });
});

beforeEach(async () => {
  windows.audit = undefined;
  windows.punch = undefined;
  windows.platform = undefined;
  deletedCaptures.length = 0;
  await seed();
});

afterEach(async () => {
  await clearRows('PlatformAuditEvent');
  await clearRows('AuditLog');
});

describe('with no policy set', () => {
  it('deletes nothing, however old the rows are', async () => {
    // The rows seeded above are 400 days old. This is the assertion the whole
    // design turns on: silence means keep.
    const before = await auditRows();
    const result = await runRetentionCleanup();

    expect(await auditRows()).toBe(before);
    expect(await platformRows()).toBe(4);
    expect(result.auditSummary).toEqual({});
  });
});

describe('with a policy set', () => {
  it('deletes rows past the window in every tenant, and keeps the recent ones', async () => {
    windows.audit = 90;
    const result = await runRetentionCleanup();

    // Two tenants × one old row each. RLS is what this proves: an unscoped
    // connection sees none of these and would report the same zero.
    expect(result.auditSummary.AuditLog).toBe(2);
    expect(await auditRows()).toBe(2);

    const survivors = await withPlatformTx((tx) =>
      tx.$queryRawUnsafe<{ objectType: string }[]>(
        `SELECT "objectType" FROM "AuditLog" WHERE "objectType" LIKE $1`,
        `%${suffix}%`,
      ),
    );
    expect(survivors.every((row) => row.objectType.startsWith('recent'))).toBe(true);
  });

  it('sweeps only the table whose window is set', async () => {
    // Three separate variables because the three have different owners and
    // different legal weight; setting one must not sweep the others.
    windows.audit = 90;
    const result = await runRetentionCleanup();

    expect(result.auditSummary.AuditLog).toBe(2);
    expect(result.auditSummary.PlatformAuditEvent).toBeUndefined();
    expect(await platformRows()).toBe(4);
  });

  it('applies each window independently', async () => {
    windows.platform = 90;
    const result = await runRetentionCleanup();

    expect(result.auditSummary.PlatformAuditEvent).toBe(2);
    expect(result.auditSummary.AuditLog).toBeUndefined();
    expect(await auditRows()).toBe(4);
  });

  it('counts a dry run without removing anything', async () => {
    windows.audit = 90;
    windows.platform = 90;
    const result = await runRetentionCleanup(true);

    expect(result.auditSummary.AuditLog).toBe(2);
    expect(result.auditSummary.PlatformAuditEvent).toBe(2);
    expect(await auditRows()).toBe(4);
    expect(await platformRows()).toBe(4);
  });

  it('deletes the capture before the punch row that points at it', async () => {
    // Object before row, the same ordering the recordings sweep uses and for the
    // same reason: delete the row first and the encrypted frame is left in the
    // bucket with nothing referring to it.
    const employee = await seedPunch();
    windows.punch = 90;

    const result = await runRetentionCleanup();

    expect(result.auditSummary.HrAttendancePunch).toBe(1);
    expect(deletedCaptures).toEqual([`t-${tenants[0]!.id}/emp-${employee}/2024-01/punch-x${suffix}.jpg.enc`]);
    const [punches] = await withPlatformTx((tx) =>
      tx.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) FROM "HrAttendancePunch" WHERE "employeeId" = $1`,
        employee,
      ),
    );
    expect(Number(punches?.count ?? 0)).toBe(0);
  });
});

/** One old punch with a capture path, in the first tenant. */
async function seedPunch(): Promise<string> {
  const tenantId = tenants[0]!.id;
  const email = `punch-${suffix}@example.test`;
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: 'Punch Subject', status: 'ACTIVE' },
  });
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  const employee = await prisma.employeeProfile.create({
    data: {
      tenantId,
      membershipId: membership.id,
      employeeNumber: `P-${suffix}`,
      employmentStatus: 'ACTIVE',
      joinedOn: new Date('2020-01-01'),
    },
  });
  await prisma.hrAttendancePunch.create({
    data: {
      tenantId,
      employeeId: employee.id,
      punchType: 'CHECK_IN',
      result: 'ACCEPTED',
      serverTime: OLD,
      capturePath: `t-${tenantId}/emp-${employee.id}/2024-01/punch-x${suffix}.jpg.enc`,
    },
  });
  return employee.id;
}
