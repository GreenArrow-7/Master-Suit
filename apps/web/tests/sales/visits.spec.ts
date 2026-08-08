import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { amendCompleted, canTransition, transition, verify } from '@/services/visits/lifecycle';
import { assessPlausibility, punch } from '@/services/visits/punch';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { Ctx } from '@/lib/security/rbac';

/**
 * The acceptance criterion is the test plan: "the state machine rejects illegal
 * transitions; a completed visit cannot be edited without an audit entry."
 *
 * The second half is the one worth being careful about. It is not enough that
 * the amendment path writes an audit row — the point is that there is no path
 * which changes a completed visit and does not.
 */
let fixture: Fixture;
let agent: Ctx;
let leader: Ctx;
let projectId: string;

const HOUR = 3_600_000;

/** Dubai Marina, near enough. The fixture geography only has to be consistent. */
const MARINA = { latitude: 25.0805, longitude: 55.1403 };

async function makeVisit(over: Record<string, unknown> = {}) {
  return prisma.siteVisit.create({
    data: {
      tenantId: fixture.a.tenantId,
      ownerId: agent.actor.id,
      leadId: fixture.a.leadIds[0],
      projectId,
      scheduledAt: new Date(Date.now() + 2 * HOUR),
      ...over,
    },
  });
}

beforeAll(async () => {
  fixture = await seedTwoTenants();

  const project = await prisma.project.create({
    data: {
      tenantId: fixture.a.tenantId,
      name: 'Marina Heights',
      code: `MH-${Math.random().toString(36).slice(2, 8)}`,
      latitude: MARINA.latitude,
      longitude: MARINA.longitude,
    },
    select: { id: true },
  });
  projectId = project.id;

  await prisma.organizationSetting.upsert({
    where: { tenantId: fixture.a.tenantId },
    create: { tenantId: fixture.a.tenantId, visitGeofenceRadiusM: 250, visitMaxTravelKph: 160 },
    update: { visitGeofenceRadiusM: 250, visitMaxTravelKph: 160 },
  });

  /**
   * Two people: the agent who owns the visits, and a leader who owns none and
   * holds the approval and verification permissions. That separation is the
   * only arrangement in which either queue means anything.
   *
   * The contexts are built in memory. What that proves is how these services
   * *use* a permission map, not how the map is derived from roles — the suites
   * in tests/permission cover that. Everything else here goes through real rows
   * against the real database, including the cross-workspace check.
   */
  agent = buildCtx(
    buildActor({
      id: fixture.a.userId,
      tenantId: fixture.a.tenantId,
      permissions: new Map([
        ['visits:VIEW', 'ORGANIZATION'],
        ['visits:CREATE', 'ORGANIZATION'],
        ['visits:EDIT', 'ORGANIZATION'],
        ['visits:DELETE', 'ORGANIZATION'],
      ]),
    }),
  );

  leader = buildCtx(
    buildActor({
      id: 'visit-leader',
      tenantId: fixture.a.tenantId,
      permissions: new Map([
        ['visits:VIEW', 'ORGANIZATION'],
        ['visits:EDIT', 'ORGANIZATION'],
        ['visits:APPROVE', 'ORGANIZATION'],
        ['visits:MANAGE_USERS', 'ORGANIZATION'],
      ]),
    }),
  );
});

beforeEach(async () => {
  await prisma.siteVisit.deleteMany({ where: { tenantId: fixture.a.tenantId } });
  await prisma.auditLog.deleteMany({ where: { tenantId: fixture.a.tenantId, objectType: 'visits' } });
});

afterAll(async () => {
  await prisma.siteVisit.deleteMany({ where: { tenantId: { in: [fixture.a.tenantId, fixture.b.tenantId] } } });
  await prisma.project.deleteMany({ where: { tenantId: { in: [fixture.a.tenantId, fixture.b.tenantId] } } });
  await fixture.cleanup();
});

// ── "The state machine rejects illegal transitions" ──────────────────────────
describe('the visit register state machine', () => {
  it('allows only the moves that describe something that can happen', () => {
    expect(canTransition('REQUESTED', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'CHECKED_IN')).toBe(true);
    expect(canTransition('CHECKED_IN', 'COMPLETED')).toBe(true);

    // Completing a visit nobody approved, or arriving at one nobody approved,
    // is the diary this register exists to stop being.
    expect(canTransition('REQUESTED', 'COMPLETED')).toBe(false);
    expect(canTransition('REQUESTED', 'CHECKED_IN')).toBe(false);
    expect(canTransition('REJECTED', 'APPROVED')).toBe(false);
    expect(canTransition('COMPLETED', 'CHECKED_IN')).toBe(false);
    expect(canTransition('CANCELLED', 'APPROVED')).toBe(false);
  });

  it('refuses an illegal transition through the service, not just the table', async () => {
    const visit = await makeVisit();
    await expect(transition({ ctx: leader, visitId: visit.id, to: 'COMPLETED' })).rejects.toMatchObject({
      status: 422,
      errors: [expect.objectContaining({ code: 'illegal_transition' })],
    });
  });

  it('will not let an agent approve their own visit', async () => {
    const visit = await makeVisit();
    // Even holding the permission. Signing off your own trip is a formality
    // with a name on it, not a decision.
    await expect(transition({ ctx: agent, visitId: visit.id, to: 'APPROVED' })).rejects.toMatchObject({ status: 403 });
  });

  it('will not let anybody reach CHECKED_IN by editing', async () => {
    const visit = await makeVisit({ status: 'APPROVED', decidedById: leader.actor.id, decidedAt: new Date() });
    await expect(transition({ ctx: agent, visitId: visit.id, to: 'CHECKED_IN' })).rejects.toMatchObject({
      status: 422,
      errors: [expect.objectContaining({ code: 'punch_required' })],
    });
  });

  it('records who decided, and writes the audit row inside the same transaction', async () => {
    const visit = await makeVisit();
    await transition({ ctx: leader, visitId: visit.id, to: 'APPROVED', note: 'Keys booked' });

    const after = await prisma.siteVisit.findFirstOrThrow({
      where: { id: visit.id, tenantId: fixture.a.tenantId },
      select: { status: true, decidedById: true, decidedAt: true },
    });
    expect(after.status).toBe('APPROVED');
    expect(after.decidedById).toBe(leader.actor.id);
    expect(after.decidedAt).not.toBeNull();

    const rows = await prisma.auditLog.findMany({
      where: { tenantId: fixture.a.tenantId, objectType: 'visits', recordId: visit.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].event).toBe('STAGE_CHANGED');
  });
});

// ── "A completed visit cannot be edited without an audit entry" ──────────────
describe('a completed visit is amended, never edited', () => {
  async function completed() {
    const visit = await makeVisit({
      status: 'COMPLETED',
      decidedById: leader.actor.id,
      decidedAt: new Date(),
      checkInAt: new Date(Date.now() - HOUR),
      checkOutAt: new Date(),
      outcome: 'Liked the view',
    });
    await prisma.auditLog.deleteMany({ where: { tenantId: fixture.a.tenantId, objectType: 'visits' } });
    return visit;
  }

  it('refuses an amendment with no reason', async () => {
    const visit = await completed();
    await expect(
      amendCompleted({ ctx: agent, visitId: visit.id, reason: '   ', outcome: 'Changed' }),
    ).rejects.toMatchObject({ status: 422 });

    // And nothing was written, so the record still says what it said.
    const after = await prisma.siteVisit.findFirstOrThrow({
      where: { id: visit.id, tenantId: fixture.a.tenantId },
      select: { outcome: true, amendedAt: true },
    });
    expect(after.outcome).toBe('Liked the view');
    expect(after.amendedAt).toBeNull();
  });

  it('writes the before and the after, with the reason, when it does change', async () => {
    const visit = await completed();

    await amendCompleted({
      ctx: agent,
      visitId: visit.id,
      reason: 'Recorded the wrong outcome at the door',
      outcome: 'Wants a second viewing',
    });

    const after = await prisma.siteVisit.findFirstOrThrow({
      where: { id: visit.id, tenantId: fixture.a.tenantId },
      select: { outcome: true, amendedAt: true, amendedById: true, amendReason: true, verification: true },
    });
    expect(after.outcome).toBe('Wants a second viewing');
    expect(after.amendedById).toBe(agent.actor.id);
    expect(after.amendReason).toContain('wrong outcome');
    // The sign-off no longer covers what the record now says.
    expect(after.verification).toBe('PENDING');

    const rows = await prisma.auditLog.findMany({
      where: { tenantId: fixture.a.tenantId, objectType: 'visits', recordId: visit.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].previousValue).toMatchObject({ outcome: 'Liked the view' });
    expect(rows[0].newValue).toMatchObject({ outcome: 'Wants a second viewing' });
  });

  it('refuses to amend a visit that has not finished', async () => {
    const visit = await makeVisit({ status: 'APPROVED', decidedById: leader.actor.id, decidedAt: new Date() });
    await expect(
      amendCompleted({ ctx: agent, visitId: visit.id, reason: 'Trying it on', outcome: 'x' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

// ── Verification ─────────────────────────────────────────────────────────────
describe('leader verification', () => {
  it('refuses to verify a visit that has not happened', async () => {
    const visit = await makeVisit({ status: 'APPROVED', decidedById: leader.actor.id, decidedAt: new Date() });
    await expect(verify({ ctx: leader, visitId: visit.id, verdict: 'VERIFIED' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('will not let an agent verify their own visit', async () => {
    const visit = await makeVisit({
      status: 'COMPLETED',
      ownerId: leader.actor.id,
      decidedById: agent.actor.id,
      decidedAt: new Date(),
    });
    await expect(verify({ ctx: leader, visitId: visit.id, verdict: 'VERIFIED' })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('records a dispute against the visit and in the log', async () => {
    const visit = await makeVisit({ status: 'COMPLETED', decidedById: leader.actor.id, decidedAt: new Date() });
    await prisma.auditLog.deleteMany({ where: { tenantId: fixture.a.tenantId, objectType: 'visits' } });

    await verify({ ctx: leader, visitId: visit.id, verdict: 'DISPUTED', note: 'Punch was 4km away' });

    const after = await prisma.siteVisit.findFirstOrThrow({
      where: { id: visit.id, tenantId: fixture.a.tenantId },
      select: { verification: true, verifiedById: true },
    });
    expect(after.verification).toBe('DISPUTED');
    expect(after.verifiedById).toBe(leader.actor.id);

    const rows = await prisma.auditLog.findMany({
      where: { tenantId: fixture.a.tenantId, objectType: 'visits', recordId: visit.id },
    });
    expect(rows).toHaveLength(1);
  });
});

// ── The punch, and what the server can and cannot know ───────────────────────
describe('plausibility checks', () => {
  const policy = { radiusM: 250, maxTravelKph: 160 };

  it('says nothing about a first punch, because there is nothing to compare', () => {
    expect(assessPlausibility({ ...MARINA, accuracyM: 20 }, new Date(), null, policy)).toMatchObject({
      suspect: false,
    });
  });

  it('flags a journey nobody could have driven', () => {
    const now = new Date();
    const verdict = assessPlausibility(
      { ...MARINA, accuracyM: 15 },
      now,
      {
        // Abu Dhabi, roughly 120 km away, five minutes ago.
        latitude: 24.4539,
        longitude: 54.3773,
        at: new Date(now.getTime() - 5 * 60_000),
      },
      policy,
    );

    expect(verdict.suspect).toBe(true);
    expect(verdict.reason).toContain('km/h');
  });

  it('flags coordinates repeated to the metre an hour apart', () => {
    const now = new Date();
    const verdict = assessPlausibility(
      { ...MARINA },
      now,
      {
        ...MARINA,
        at: new Date(now.getTime() - HOUR),
      },
      policy,
    );

    // A phone reporting the identical fix twice is reporting a stored value.
    expect(verdict.suspect).toBe(true);
    expect(verdict.reason).toContain('identical');
  });

  it('flags a fix too coarse to place anybody', () => {
    const verdict = assessPlausibility({ ...MARINA, accuracyM: 3_000 }, new Date(), null, policy);
    expect(verdict.suspect).toBe(true);
    expect(verdict.reason).toContain('too coarse');
  });

  it('accepts an ordinary drive across town', () => {
    const now = new Date();
    const verdict = assessPlausibility(
      { ...MARINA, accuracyM: 12 },
      now,
      {
        // Downtown Dubai, about 20 km, forty minutes ago: 30 km/h in traffic.
        latitude: 25.1972,
        longitude: 55.2744,
        at: new Date(now.getTime() - 40 * 60_000),
      },
      policy,
    );
    expect(verdict.suspect).toBe(false);
  });
});

describe('the site punch', () => {
  async function approved() {
    return makeVisit({ status: 'APPROVED', decidedById: leader.actor.id, decidedAt: new Date() });
  }

  it('refuses to check into a visit nobody approved', async () => {
    const visit = await makeVisit();
    await expect(
      punch({ ctx: agent, visitId: visit.id, direction: 'in', coordinates: { ...MARINA, accuracyM: 10 } }),
    ).rejects.toMatchObject({ status: 422, errors: [expect.objectContaining({ code: 'not_approved' })] });
  });

  it('records arrival at the property as inside the fence', async () => {
    const visit = await approved();
    const result = await punch({
      ctx: agent,
      visitId: visit.id,
      direction: 'in',
      coordinates: { ...MARINA, accuracyM: 12 },
    });

    expect(result.geofenceOk).toBe(true);
    expect(result.distanceMeters).toBeLessThan(50);
    expect(result.visit.status).toBe('CHECKED_IN');
  });

  it('records a punch from the wrong side of town, flagged rather than refused', async () => {
    const visit = await approved();
    const result = await punch({
      ctx: agent,
      visitId: visit.id,
      // Downtown, about 20 km from the property.
      direction: 'in',
      coordinates: { latitude: 25.1972, longitude: 55.2744, accuracyM: 12 },
    });

    // Never silently accepted, never silently discarded — the acceptance
    // criterion of M8 and the honest answer here too.
    expect(result.geofenceOk).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(10_000);
    expect(result.visit.status).toBe('CHECKED_IN');
  });

  it('will not let a colleague punch on somebody else behalf', async () => {
    const visit = await approved();
    await expect(
      punch({ ctx: leader, visitId: visit.id, direction: 'in', coordinates: { ...MARINA, accuracyM: 10 } }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a check-out before a check-in', async () => {
    const visit = await approved();
    await expect(
      punch({ ctx: agent, visitId: visit.id, direction: 'out', coordinates: { ...MARINA, accuracyM: 10 } }),
    ).rejects.toMatchObject({ status: 422, errors: [expect.objectContaining({ code: 'not_checked_in' })] });
  });

  it('never reaches another workspace visits', async () => {
    const theirs = await prisma.siteVisit.create({
      data: {
        tenantId: fixture.b.tenantId,
        ownerId: fixture.b.userId,
        leadId: fixture.b.leadIds[0],
        address: 'Elsewhere',
        kind: 'CLIENT_MEETING',
        scheduledAt: new Date(Date.now() + HOUR),
      },
    });
    await expect(
      punch({ ctx: agent, visitId: theirs.id, direction: 'in', coordinates: { ...MARINA, accuracyM: 10 } }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
