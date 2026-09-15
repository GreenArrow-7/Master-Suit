/**
 * The booking state machine, over HTTP.
 *
 * These transitions are the only way commission ever accrues, and they were
 * unreachable in the running app until this route existed — POST created a
 * DRAFT and nothing could move it. The cancel guard in particular is money
 * logic: without it a cancelled sale leaves live commissions owed against
 * something that no longer exists.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, type PermissionAction, type VisibilityScope } from '@prisma/client';
import { prisma } from '@/lib/db';
import { POST as createBooking, PATCH as patchBooking } from '@/app/api/v1/bookings/route';
import { accrueCommission, clawback } from '@/services/money/commissions';
import { createSessionToken } from '../helpers/session';
import { buildActor, buildCtx } from '../helpers/ctx';
import { fixtureUnit } from '../helpers/inventory';
import { patch, post } from '../helpers/request';
import type { Ctx } from '@/lib/security/rbac';

const suffix = randomBytes(4).toString('hex');
const slug = `bookings-${suffix}`;

let tenantId = '';
let userId = '';
let cookie = '';
let projectId = '';
let leadId = '';
let ctx: Ctx;

const D = (n: number) => new Prisma.Decimal(n);

const GRANTS: readonly (readonly [string, PermissionAction])[] = [
  ['bookings', 'VIEW'],
  ['bookings', 'CREATE'],
  ['bookings', 'EDIT'],
  ['commissions', 'VIEW'],
  ['commissions', 'EDIT'],
  ['commissions', 'APPROVE'],
];

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Bookings LLC', displayName: 'Bookings', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const role = await prisma.role.create({
    data: { tenantId, key: `seller-${suffix}`, name: 'Seller', rank: 50, defaultScope: 'ORGANIZATION' },
  });
  for (const [module, action] of GRANTS) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: {
        tenantId,
        roleId: role.id,
        permissionId: permission.id,
        granted: true,
        scope: 'ORGANIZATION' as VisibilityScope,
      },
    });
  }

  const user = await prisma.user.create({
    data: { tenantId, email: `seller-${suffix}@bk.test`, fullName: 'Seller', roleId: role.id, status: 'ACTIVE' },
  });
  userId = user.id;

  // The session helper refuses without a membership, deliberately: a session
  // minted for an unlinked user 401s fifty assertions later.
  const platformUser = await prisma.platformUser.create({
    data: {
      email: `seller-${suffix}@bk.test`,
      normalizedEmail: `seller-${suffix}@bk.test`,
      fullName: 'Seller',
      status: 'ACTIVE',
    },
  });
  await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  cookie = await createSessionToken(tenantId, user.id);
  ctx = buildCtx(
    buildActor({
      id: userId,
      tenantId,
      permissions: new Map(GRANTS.map(([m, a]) => [`${m}:${a}`, 'ORGANIZATION' as const])),
    }),
  );

  const project = await prisma.project.create({
    data: { tenantId, name: 'Bookings project', code: `BK-${suffix}` },
  });
  projectId = project.id;

  const stage = await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', position: 0, isDefault: true },
  });
  const lead = await prisma.lead.create({
    data: { tenantId, reference: `BKL-${suffix}`, fullName: 'Buyer', stageId: stage.id, ownerId: userId },
  });
  leadId = lead.id;

  // A signed slab, so accrual has something to work from.
  const slab = await prisma.commissionSlab.create({
    data: {
      tenantId,
      name: 'Bookings slab',
      mode: 'FLAT',
      basis: 'PERCENT_OF_SALE',
      effectiveFrom: new Date(Date.now() - 86_400_000),
      approvedById: 'finance-head',
      approvedAt: new Date(),
    },
  });
  await prisma.commissionSlabBand.create({
    data: { tenantId, slabId: slab.id, fromAmount: D(0), toAmount: null, ratePct: D(2) },
  });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: `seller-${suffix}@bk.test` } }).catch(() => {});
});

/**
 * A draft against its own fresh, available unit.
 *
 * Confirmation now names one specific flat, so every fixture here needs one of
 * its own — two drafts sharing a unit is the double-sale, not a shortcut.
 */
async function draft(saleValue = 1_000_000, unitId?: string) {
  const unitInventoryId = unitId ?? (await fixtureUnit(tenantId, projectId, 'AVAILABLE')).id;
  const res = await post(
    createBooking,
    '/api/v1/bookings',
    { leadId, projectId, unitInventoryId, saleValue, bookingDate: new Date().toISOString() },
    cookie,
  );
  expect(res.status).toBe(200);
  return res.body.id as string;
}

const confirm = (bookingId: string) =>
  patch(patchBooking, '/api/v1/bookings', { action: 'CONFIRM', bookingId }, cookie);

const unitStatus = async (id: string) =>
  (await prisma.unitInventory.findFirstOrThrow({ where: { id, tenantId } })).status;

describe('the booking state machine', () => {
  it('starts as a draft that accrues nothing', async () => {
    const id = await draft();
    const booking = await prisma.booking.findFirstOrThrow({ where: { id, tenantId } });
    expect(booking.status).toBe('DRAFT');
    await expect(accrueCommission({ ctx, bookingId: id })).rejects.toMatchObject({ status: 409 });
  });

  it('confirms, then refuses to confirm twice', async () => {
    const id = await draft();
    expect((await patch(patchBooking, '/api/v1/bookings', { action: 'CONFIRM', bookingId: id }, cookie)).status).toBe(
      200,
    );
    const again = await patch(patchBooking, '/api/v1/bookings', { action: 'CONFIRM', bookingId: id }, cookie);
    expect(again.status).toBe(422);
  });

  it('no longer accepts a COLLECT verb at all — money received is a verified receipt now', async () => {
    const id = await draft();
    const res = await patch(patchBooking, '/api/v1/bookings', { action: 'COLLECT', bookingId: id }, cookie);
    // The verb is gone from the body schema, so this is a validation refusal,
    // not a state-machine one; and nothing wrote the legacy timestamp.
    expect(res.status).toBe(422);
    const booking = await prisma.booking.findFirstOrThrow({ where: { id, tenantId } });
    expect(booking.collectedAt).toBeNull();
  });

  it('refuses to cancel while a commission is still live', async () => {
    const id = await draft();
    await patch(patchBooking, '/api/v1/bookings', { action: 'CONFIRM', bookingId: id }, cookie);
    await accrueCommission({ ctx, bookingId: id });

    const res = await patch(
      patchBooking,
      '/api/v1/bookings',
      { action: 'CANCEL', bookingId: id, reason: 'Client withdrew' },
      cookie,
    );
    // Otherwise the amount stays owed against a sale that is gone.
    expect(res.status).toBe(409);
  });

  it('cancels once the commissions are reversed, and records the reason', async () => {
    const id = await draft();
    await patch(patchBooking, '/api/v1/bookings', { action: 'CONFIRM', bookingId: id }, cookie);
    await accrueCommission({ ctx, bookingId: id });
    await clawback({ ctx, bookingId: id, reason: 'Client withdrew before handover' });

    const res = await patch(
      patchBooking,
      '/api/v1/bookings',
      { action: 'CANCEL', bookingId: id, reason: 'Client withdrew' },
      cookie,
    );
    expect(res.status).toBe(200);

    const booking = await prisma.booking.findFirstOrThrow({ where: { id, tenantId } });
    expect(booking.status).toBe('CANCELLED');
    // cancelReason, not notes: the database pairs the reason with cancelledAt,
    // and writing it into notes both broke that constraint and destroyed
    // whatever the salesperson had recorded about the sale.
    expect(booking.cancelReason).toBe('Client withdrew');
    expect(booking.cancelledAt).not.toBeNull();
  });

  it('rejects a body the union does not describe', async () => {
    const id = await draft();
    const res = await patch(
      patchBooking,
      '/api/v1/bookings',
      { action: 'CONFIRM', bookingId: id, saleValue: 999 },
      cookie,
    );
    expect(res.status).toBe(422);
  });
});

/**
 * Confirmation and inventory, as one act.
 *
 * The finding these cover: confirmation never touched inventory, so two
 * concurrent confirmations against one flat both returned 200 and the unit
 * still read AVAILABLE afterwards — inventory the next agent is shown and can
 * sell again. The client's policy, given 2026-09-12, is that every confirmed
 * booking identifies one specific unit; these are that policy and the control
 * that enforces it.
 */
describe('a confirmed sale and the flat it is a sale of', () => {
  it('refuses to confirm a booking that names no unit', async () => {
    // Reachable: a draft may be written against a project alone.
    const res = await post(
      createBooking,
      '/api/v1/bookings',
      { leadId, projectId, saleValue: 1_000_000, bookingDate: new Date().toISOString() },
      cookie,
    );
    expect(res.status).toBe(200);

    const confirmed = await confirm(res.body.id as string);
    expect(confirmed.status).toBe(422);
    expect(JSON.stringify(confirmed.body)).toMatch(/unit/i);

    const after = await prisma.booking.findFirstOrThrow({ where: { id: res.body.id, tenantId } });
    expect(after.status).toBe('DRAFT');
  });

  it('takes the unit in the same transaction that confirms the booking', async () => {
    const unit = await fixtureUnit(tenantId, projectId, 'AVAILABLE');
    const id = await draft(1_000_000, unit.id);

    expect((await confirm(id)).status).toBe(200);
    expect(await unitStatus(unit.id)).toBe('BOOKED');
  });

  it('leaves both the booking and the unit untouched when the move is refused', async () => {
    const unit = await fixtureUnit(tenantId, projectId, 'SOLD');
    const id = await draft(1_000_000, unit.id);

    const res = await confirm(id);
    expect(res.status).toBeGreaterThanOrEqual(400);

    // Atomicity, both ways: the sale did not happen and the flat did not move.
    expect((await prisma.booking.findFirstOrThrow({ where: { id, tenantId } })).status).toBe('DRAFT');
    expect(await unitStatus(unit.id)).toBe('SOLD');
  });

  it('refuses to sell a flat out from under another agent\u2019s live hold', async () => {
    const unit = await prisma.unitInventory.create({
      data: {
        tenantId,
        projectId,
        unitNumber: `HELD-${randomBytes(4).toString('hex')}`,
        status: 'HELD',
        heldById: 'somebody-else',
        heldUntil: new Date(Date.now() + 86_400_000),
      },
    });
    const id = await draft(1_000_000, unit.id);

    expect((await confirm(id)).status).toBeGreaterThanOrEqual(400);
    expect(await unitStatus(unit.id)).toBe('HELD');
  });

  it('lets exactly one of two concurrent confirmations win', async () => {
    const unit = await fixtureUnit(tenantId, projectId, 'AVAILABLE');
    const first = await draft(1_000_000, unit.id);
    const second = await draft(1_000_000, unit.id);

    // Two route handlers, two transactions, two connections. The loser waits on
    // the unit's row lock and is refused once it reads BOOKED.
    const [a, b] = await Promise.all([confirm(first), confirm(second)]);

    expect([a, b].filter((r) => r.status === 200)).toHaveLength(1);
    const loser = [a, b].find((r) => r.status !== 200)!;
    expect(loser.status).toBeGreaterThanOrEqual(400);
    // A refusal with a reason, not a 500.
    expect(loser.status).toBeLessThan(500);

    expect(await prisma.booking.count({ where: { tenantId, unitInventoryId: unit.id, status: 'CONFIRMED' } })).toBe(1);
  });

  it('puts the flat back on the market when the sale is cancelled', async () => {
    const unit = await fixtureUnit(tenantId, projectId, 'AVAILABLE');
    const id = await draft(1_000_000, unit.id);
    expect((await confirm(id)).status).toBe(200);
    expect(await unitStatus(unit.id)).toBe('BOOKED');

    const res = await patch(
      patchBooking,
      '/api/v1/bookings',
      { action: 'CANCEL', bookingId: id, reason: 'Client withdrew' },
      cookie,
    );
    expect(res.status).toBe(200);
    expect(await unitStatus(unit.id)).toBe('AVAILABLE');

    // And the unit can be sold again, which is the point of releasing it.
    const next = await draft(1_000_000, unit.id);
    expect((await confirm(next)).status).toBe(200);
  });

  it('refuses a second confirmed booking even when the application is bypassed', async () => {
    const unit = await fixtureUnit(tenantId, projectId, 'AVAILABLE');
    const id = await draft(1_000_000, unit.id);
    expect((await confirm(id)).status).toBe(200);

    // Straight at the table, with no route, no service and no lock — the shape
    // of a script, a console session, or the next route that forgets.
    await expect(
      prisma.booking.create({
        data: {
          tenantId,
          reference: `BK-BYPASS-${randomBytes(4).toString('hex')}`,
          leadId,
          projectId,
          unitInventoryId: unit.id,
          ownerId: userId,
          status: 'CONFIRMED',
          saleValue: D(1_000_000),
          bookingDate: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('refuses a confirmed booking with no unit even when the application is bypassed', async () => {
    await expect(
      prisma.booking.create({
        data: {
          tenantId,
          reference: `BK-NOUNIT-${randomBytes(4).toString('hex')}`,
          leadId,
          projectId,
          ownerId: userId,
          status: 'CONFIRMED',
          saleValue: D(1_000_000),
          bookingDate: new Date(),
        },
      }),
    ).rejects.toThrow();
  });
});

/**
 * The two races the row lock exists for, on one booking rather than one unit.
 *
 * The unit-level race above is the double-sale. These are the same booking
 * pressed twice, and a confirmation crossing a cancellation — the case the
 * unlocked first read cannot see, and which `lockBooking()` re-reads for.
 */
describe('one booking, two hands on it at once', () => {
  const cancel = (bookingId: string) =>
    patch(patchBooking, '/api/v1/bookings', { action: 'CANCEL', bookingId, reason: 'Client withdrew' }, cookie);

  const bookingStatus = async (id: string) =>
    (await prisma.booking.findFirstOrThrow({ where: { id, tenantId } })).status;

  it('lets exactly one of two concurrent confirmations of the same booking through', async () => {
    const unit = await fixtureUnit(tenantId, projectId, 'AVAILABLE');
    const id = await draft(1_000_000, unit.id);

    const [a, b] = await Promise.all([confirm(id), confirm(id)]);
    expect([a, b].filter((r) => r.status === 200)).toHaveLength(1);
    const loser = [a, b].find((r) => r.status !== 200)!;
    // A refusal with a reason — 409 from the re-read, or 422 from the transition
    // table — never a 500 from the unique index catching what the lock missed.
    expect(loser.status).toBeGreaterThanOrEqual(400);
    expect(loser.status).toBeLessThan(500);

    expect(await bookingStatus(id)).toBe('CONFIRMED');
    expect(await unitStatus(unit.id)).toBe('BOOKED');
  });

  it('ends in one consistent state when a confirmation races a cancellation', async () => {
    const unit = await fixtureUnit(tenantId, projectId, 'AVAILABLE');
    const id = await draft(1_000_000, unit.id);

    const [confirmed, cancelled] = await Promise.all([confirm(id), cancel(id)]);

    // Either order is legitimate — confirm-then-cancel is a real sequence and
    // both may succeed; cancel-then-confirm refuses the confirm. What must never
    // happen is a 500, or a ledger that disagrees with inventory.
    for (const r of [confirmed, cancelled]) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
    expect([confirmed, cancelled].some((r) => r.status === 200)).toBe(true);

    const booking = await bookingStatus(id);
    const stock = await unitStatus(unit.id);
    expect(['CONFIRMED', 'CANCELLED']).toContain(booking);
    // The invariant, both ways: a confirmed sale holds its flat; a cancelled or
    // never-confirmed one has let it go. A confirm that lost the race after it
    // had already moved the unit must have rolled that move back.
    expect(stock).toBe(booking === 'CONFIRMED' ? 'BOOKED' : 'AVAILABLE');
    expect(await prisma.booking.count({ where: { tenantId, unitInventoryId: unit.id, status: 'CONFIRMED' } })).toBe(
      booking === 'CONFIRMED' ? 1 : 0,
    );
  });
});
