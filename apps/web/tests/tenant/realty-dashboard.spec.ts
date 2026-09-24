import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { resolveCtx } from '@/lib/auth/session';
import { realtyDashboard } from '@/services/realty/dashboard';
import { seedHierarchy, seedTwoTenants, type Fixture, type Hierarchy } from '../helpers/fixtures';

/**
 * The Real Estate dashboard counts rows, and the rows it is allowed to count are
 * decided by the viewer's scope and workspace — not by the screen.
 *
 * Every figure comes from `visibilityWhere`, the same resolver the list screens
 * use, so these assertions are really about that contract holding for a new
 * consumer: an agent's numbers are their own, a manager's are wider, and neither
 * can see another workspace's at all.
 *
 * The context is resolved from a real session cookie through the real
 * `resolveCtx`, exactly as `requestCtx()` does in the application. Building a Ctx
 * by hand would let the test assert against permissions the database never
 * granted, which is the failure this file exists to catch.
 */
const ctxFrom = (cookie: string) => resolveCtx(new Request('http://internal/', { headers: { cookie } }), 'vitest');

describe('scope decides what the dashboard counts', () => {
  let org: Hierarchy;

  beforeAll(async () => {
    org = await seedHierarchy();
  }, 120_000);

  afterAll(async () => {
    await org.cleanup();
  });

  it('an OWN-scope agent sees only their own lead', async () => {
    const board = await realtyDashboard(await ctxFrom(org.repA1.cookie));
    expect(board.pipeline.totalLeads).toBe(1);
  });

  it('an ORGANIZATION-scope director sees the whole workspace', async () => {
    const board = await realtyDashboard(await ctxFrom(org.director.cookie));
    expect(board.pipeline.totalLeads).toBe(org.totalLeads);
  });

  it('a TEAM-scope manager sees more than one agent and less than the workspace', async () => {
    const board = await realtyDashboard(await ctxFrom(org.teamManagerA.cookie));
    expect(board.pipeline.totalLeads).toBeGreaterThan(1);
    expect(board.pipeline.totalLeads).toBeLessThan(org.totalLeads);
  });

  it('widens monotonically from agent to director', async () => {
    const [rep, team, branch, region, director] = await Promise.all(
      [org.repA1, org.teamManagerA, org.branchManager, org.regionalManager, org.director].map(
        async (member) => (await realtyDashboard(await ctxFrom(member.cookie))).pipeline.totalLeads,
      ),
    );
    expect(rep).toBeLessThanOrEqual(team!);
    expect(team!).toBeLessThanOrEqual(branch!);
    expect(branch!).toBeLessThanOrEqual(region!);
    expect(region!).toBeLessThanOrEqual(director!);
  });

  /**
   * The capability contract, and the reason this file exists.
   *
   * The hierarchy fixture grants the sales modules but not `visits`,
   * `collections` or `projects`, so every viewer in it is authorised for leads
   * and unauthorised for the other registers. Two wrong answers are possible and
   * both were written before this test:
   *
   *   - 403 for the whole board, because `visibilityWhere` throws on a NONE
   *     scope. That makes the dashboard one monolithic authorisation unit.
   *   - 0 for the withheld figures. `0` asserts "you may see this and there is
   *     nothing", which is a different statement from "you may not see this",
   *     and it confirms the register exists.
   *
   * The right answer is `null`: the lead figures are correct and present, and the
   * rest are absent so the screen can omit their tiles.
   */
  it('shows lead figures and withholds registers the viewer cannot see', async () => {
    const board = await realtyDashboard(await ctxFrom(org.director.cookie));

    // Authorised: real, correct figures.
    expect(board.pipeline.totalLeads).toBe(org.totalLeads);
    expect(typeof board.today.newLeads).toBe('number');
    expect(Array.isArray(board.business.leadsBySource)).toBe(true);

    // Unauthorised: withheld, and specifically not zero.
    for (const figure of [
      board.today.siteVisits,
      board.pipeline.visitsApproved,
      board.pipeline.visitsCompleted,
      board.pipeline.bookings,
      board.pipeline.confirmedBookings,
      board.business.revenueToday,
      board.business.revenue7Days,
      board.business.availableInventory,
    ]) {
      expect(figure).toBeNull();
      expect(figure).not.toBe(0);
    }
    expect(board.business.topAgents).toBeNull();
  });

  it('an agent with leads but no visit access still gets a usable board', async () => {
    const board = await realtyDashboard(await ctxFrom(org.repA1.cookie));
    // The board loaded rather than refusing, and the half they may see is right.
    expect(board.pipeline.totalLeads).toBe(1);
    expect(board.pipeline.visitsApproved).toBeNull();
  });
});

describe('tenant isolation', () => {
  let pair: Fixture;

  beforeAll(async () => {
    pair = await seedTwoTenants();
  }, 120_000);

  afterAll(async () => {
    await pair.cleanup();
  });

  it("counts only the viewer's own workspace", async () => {
    const [aBoard, bBoard] = await Promise.all([ctxFrom(pair.a.cookie), ctxFrom(pair.b.cookie)]).then((ctxs) =>
      Promise.all(ctxs.map((ctx) => realtyDashboard(ctx))),
    );
    expect(aBoard.pipeline.totalLeads).toBe(pair.a.leadCount);
    expect(bBoard.pipeline.totalLeads).toBe(pair.b.leadCount);
  });

  it("a workspace's figures do not move when the other gains a lead", async () => {
    const before = (await realtyDashboard(await ctxFrom(pair.a.cookie))).pipeline.totalLeads;
    const extra = await prisma.lead.create({
      data: {
        tenantId: pair.b.tenantId,
        reference: `PROBE-${Date.now()}`,
        fullName: 'Cross-tenant Probe',
        stageId: pair.b.stageId,
        ownerId: pair.b.userId,
      },
    });
    try {
      const after = (await realtyDashboard(await ctxFrom(pair.a.cookie))).pipeline.totalLeads;
      expect(after).toBe(before);
      const bBoard = await realtyDashboard(await ctxFrom(pair.b.cookie));
      expect(bBoard.pipeline.totalLeads).toBe(pair.b.leadCount + 1);
    } finally {
      // deleteMany with the tenant term: the client's tenant guard refuses a
      // bare `delete` by id, which is the protection working and not worth
      // bypassing for a fixture.
      await prisma.lead.deleteMany({ where: { id: extra.id, tenantId: pair.b.tenantId } });
    }
  });
});
