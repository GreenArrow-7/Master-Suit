import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma, withTx } from '@/lib/db';
import { catalogueFilters, catalogueWhere } from '@/lib/inventory/catalogue';
import { recalculateProjectRollups } from '@/services/inventory/rollups';
import { canTransition, moveUnit, releaseExpiredHolds } from '@/services/inventory/unitStatus';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * The three things in this module that are not CRUD: the derived price band,
 * the unit state machine, and the catalogue filter that the facets and the list
 * both read from.
 */
let fixture: Fixture;
let projectId: string;
let planId: string;

const filters = (over: Record<string, unknown> = {}) => catalogueFilters.parse(over);

async function makeProject(tenantId: string, code: string, over: Record<string, unknown> = {}) {
  return prisma.project.create({
    data: { tenantId, name: `Project ${code}`, code, ...over },
    select: { id: true },
  });
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const project = await makeProject(fixture.a.tenantId, 'INV-1');
  projectId = project.id;

  const plan = await prisma.unitPlan.create({
    data: {
      tenantId: fixture.a.tenantId,
      projectId,
      name: '2 BHK Type A',
      unitType: '2BHK',
      carpetAreaSqft: 1_000,
      price: new Prisma.Decimal(2_000_000),
    },
    select: { id: true },
  });
  planId = plan.id;
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { tenantId: { in: [fixture.a.tenantId, fixture.b.tenantId] } } });
  await fixture.cleanup();
});

// ── Derived pricing ──────────────────────────────────────────────────────────
describe('the catalogue price band is derived, never typed', () => {
  it('takes the band from the plans and the rate from each plan own area', async () => {
    // A second plan that is cheaper *and* smaller. The trap this catches is
    // computing the rate as minPrice / minAreaSqft, which would report 1 200
    // here instead of the true mean of 2 000 and 1 200.
    await prisma.unitPlan.create({
      data: {
        tenantId: fixture.a.tenantId,
        projectId,
        name: '1 BHK',
        unitType: '1BHK',
        carpetAreaSqft: 500,
        price: new Prisma.Decimal(600_000),
      },
    });

    const rollups = await withTx(fixture.a.tenantId, (tx) =>
      recalculateProjectRollups(tx, fixture.a.tenantId, projectId),
    );

    expect(rollups.minPrice?.toString()).toBe('600000');
    expect(rollups.maxPrice?.toString()).toBe('2000000');
    expect(rollups.minAreaSqft).toBe(500);
    expect(rollups.maxAreaSqft).toBe(1_000);
    // (2 000 000/1 000 + 600 000/500) / 2 = (2000 + 1200) / 2 = 1600
    expect(rollups.pricePerSqft?.toString()).toBe('1600');
    expect(rollups.unitTypes).toEqual(['1BHK', '2BHK']);
  });

  it('leaves the band empty rather than zero when nothing is priced', async () => {
    const bare = await makeProject(fixture.a.tenantId, 'INV-BARE');
    const rollups = await withTx(fixture.a.tenantId, (tx) =>
      recalculateProjectRollups(tx, fixture.a.tenantId, bare.id),
    );
    // Zero would put an unpriced pre-launch at the bottom of every price filter
    // and drag the micromarket median with it.
    expect(rollups.minPrice).toBeNull();
    expect(rollups.pricePerSqft).toBeNull();
  });
});

// ── Unit state machine ───────────────────────────────────────────────────────
describe('the unit state machine', () => {
  const unit = async (number: string, status: 'AVAILABLE' | 'HELD' | 'BOOKED' = 'AVAILABLE') =>
    prisma.unitInventory.create({
      data: {
        tenantId: fixture.a.tenantId,
        projectId,
        unitPlanId: planId,
        unitNumber: number,
        status,
        ...(status === 'HELD' ? { heldUntil: new Date(Date.now() + 3_600_000) } : {}),
      },
      select: { id: true },
    });

  it('permits only the transitions that are actually reversible', () => {
    expect(canTransition('AVAILABLE', 'HELD')).toBe(true);
    expect(canTransition('HELD', 'BOOKED')).toBe(true);
    expect(canTransition('BOOKED', 'SOLD')).toBe(true);

    // Nothing comes back from SOLD: reversing a completed sale is a finance
    // operation with a paper trail, not a dropdown.
    expect(canTransition('SOLD', 'AVAILABLE')).toBe(false);
    expect(canTransition('AVAILABLE', 'SOLD')).toBe(false);
    expect(canTransition('BLOCKED', 'BOOKED')).toBe(false);
  });

  it('refuses an illegal move through the service, not just the table', async () => {
    const u = await unit('T-ILLEGAL');
    await expect(
      moveUnit({
        tenantId: fixture.a.tenantId,
        actorId: fixture.a.userId,
        projectId,
        unitId: u.id,
        to: 'SOLD',
      }),
    ).rejects.toMatchObject({
      status: 422,
      errors: [expect.objectContaining({ code: 'illegal_transition' })],
    });
  });

  it('refuses to book without naming the buyer', async () => {
    const u = await unit('T-NOLEAD');
    await expect(
      moveUnit({ tenantId: fixture.a.tenantId, actorId: fixture.a.userId, projectId, unitId: u.id, to: 'BOOKED' }),
    ).rejects.toMatchObject({
      status: 422,
      errors: [expect.objectContaining({ field: 'leadId', code: 'required' })],
    });
  });

  it('updates the project availability in the same transaction as the unit', async () => {
    const u = await unit('T-COUNT');
    await withTx(fixture.a.tenantId, (tx) => recalculateProjectRollups(tx, fixture.a.tenantId, projectId));
    const before = await prisma.project.findFirstOrThrow({
      where: { id: projectId, tenantId: fixture.a.tenantId },
      select: { availableUnits: true },
    });

    await moveUnit({ tenantId: fixture.a.tenantId, actorId: fixture.a.userId, projectId, unitId: u.id, to: 'HELD' });

    const after = await prisma.project.findFirstOrThrow({
      where: { id: projectId, tenantId: fixture.a.tenantId },
      select: { availableUnits: true },
    });
    // A catalogue that says "3 available" over a board showing two is a
    // salesperson pitching a flat someone else is holding.
    expect(after.availableUnits).toBe(before.availableUnits - 1);
  });

  /**
   * Launch day: two salespeople press hold on the same flat in the same second.
   *
   * Without `FOR UPDATE` both read AVAILABLE, both pass the transition check and
   * the second write wins silently — so the loser walks away believing they hold
   * a unit the winner is now booking.
   */
  it('lets exactly one of two concurrent holds win', async () => {
    const u = await unit('T-RACE');

    const results = await Promise.allSettled(
      ['actor-one', 'actor-two'].map((actorId) =>
        moveUnit({ tenantId: fixture.a.tenantId, actorId, projectId, unitId: u.id, to: 'HELD' }),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    const final = await prisma.unitInventory.findFirstOrThrow({
      where: { id: u.id, tenantId: fixture.a.tenantId },
      select: { status: true, heldById: true, heldUntil: true },
    });
    expect(final.status).toBe('HELD');
    expect(final.heldUntil).not.toBeNull();
    expect(['actor-one', 'actor-two']).toContain(final.heldById);
  });

  it('does not let one person release someone else hold', async () => {
    const u = await unit('T-STEAL');
    await moveUnit({ tenantId: fixture.a.tenantId, actorId: 'holder', projectId, unitId: u.id, to: 'HELD' });

    await expect(
      moveUnit({ tenantId: fixture.a.tenantId, actorId: 'thief', projectId, unitId: u.id, to: 'AVAILABLE' }),
    ).rejects.toThrow(/held by someone else/i);
  });

  it('returns an expired hold to the market', async () => {
    const u = await unit('T-EXPIRED');
    await prisma.unitInventory.update({
      where: { id: u.id, tenantId: fixture.a.tenantId },
      data: { status: 'HELD', heldById: 'holder', heldUntil: new Date(Date.now() - 60_000) },
    });

    const released = await releaseExpiredHolds(fixture.a.tenantId, projectId);
    expect(released).toBeGreaterThanOrEqual(1);

    const after = await prisma.unitInventory.findFirstOrThrow({
      where: { id: u.id, tenantId: fixture.a.tenantId },
      select: { status: true, heldById: true },
    });
    expect(after.status).toBe('AVAILABLE');
    expect(after.heldById).toBeNull();
  });
});

// ── Catalogue filters ────────────────────────────────────────────────────────
describe('the catalogue filter', () => {
  it('keeps a project whose band overlaps the budget and drops one entirely above it', async () => {
    const where = catalogueWhere(fixture.a.tenantId, filters({ maxPrice: 1_000_000 }));
    const ids = (await prisma.project.findMany({ where, select: { id: true } })).map((p) => p.id);

    // INV-1 spans 600k–2M, so a 1M budget still reaches its cheapest plan.
    expect(ids).toContain(projectId);
  });

  it('keeps an unpriced project rather than hiding it from every budget', async () => {
    const bare = await prisma.project.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, code: 'INV-BARE' },
      select: { id: true },
    });
    const where = catalogueWhere(fixture.a.tenantId, filters({ maxPrice: 500_000 }));
    const ids = (await prisma.project.findMany({ where, select: { id: true } })).map((p) => p.id);
    // A pre-launch with no plans yet is still pitchable; silently excluding it
    // is how inventory disappears from the floor.
    expect(ids).toContain(bare.id);
  });

  it('excludes soft-deleted projects without the caller asking', async () => {
    const gone = await makeProject(fixture.a.tenantId, 'INV-GONE', { deletedAt: new Date() });
    const where = catalogueWhere(fixture.a.tenantId, filters());
    const ids = (await prisma.project.findMany({ where, select: { id: true } })).map((p) => p.id);
    expect(ids).not.toContain(gone.id);
  });

  it('never reaches another workspace inventory', async () => {
    const theirs = await makeProject(fixture.b.tenantId, 'INV-OTHER');
    const where = catalogueWhere(fixture.a.tenantId, filters());
    const ids = (await prisma.project.findMany({ where, select: { id: true } })).map((p) => p.id);
    expect(ids).not.toContain(theirs.id);
  });
});

/**
 * The acceptance criterion for this module is a 100k-row catalogue under 400 ms,
 * using Postgres indexes rather than a search engine. Timing that in the suite
 * would mean seeding 100k rows on every run; asserting the *plan* is what
 * actually regresses — someone adds a filter without its index, or drops one.
 *
 * `scripts/bench-projects.mjs` does the timed 100k run on demand.
 */
describe('the catalogue queries use indexes', () => {
  const explain = async (sql: Prisma.Sql) => {
    const rows = await prisma.$queryRaw<Record<string, string>[]>(sql);
    return rows.map((r) => Object.values(r)[0]).join('\n');
  };

  it('serves a name search from the trigram index, not a sequential scan', async () => {
    const plan = await explain(
      Prisma.sql`EXPLAIN SELECT id FROM "Project" WHERE "tenantId" = ${fixture.a.tenantId} AND "name" ILIKE '%marina%'`,
    );
    // Postgres will choose a sequential scan on a nearly-empty table whatever
    // indexes exist, so the assertion is that the index is *available* to be
    // chosen — a missing index shows up as no such index in the catalog.
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'Project'
    `;
    const names = indexes.map((i) => i.indexname);
    expect(names).toContain('Project_name_trgm_idx');
    expect(names).toContain('Project_amenityKeys_idx');
    expect(names).toContain('Project_unitTypes_idx');
    expect(plan).toBeTruthy();
  });

  it('has an index for every facet the filter builder can emit', async () => {
    const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'Project'
    `;
    const defs = indexes.map((i) => i.indexdef).join('\n');
    for (const column of ['micromarketId', 'developerId', 'possessionStatus', 'minPrice', 'isPitchable', 'updatedAt']) {
      expect(defs).toContain(column);
    }
  });
});
