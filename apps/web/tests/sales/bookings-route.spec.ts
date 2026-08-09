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

async function draft(saleValue = 1_000_000) {
  const res = await post(
    createBooking,
    '/api/v1/bookings',
    { leadId, projectId, saleValue, bookingDate: new Date().toISOString() },
    cookie,
  );
  expect(res.status).toBe(200);
  return res.body.id as string;
}

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

  it('will not mark a draft collected', async () => {
    const id = await draft();
    const res = await patch(patchBooking, '/api/v1/bookings', { action: 'COLLECT', bookingId: id }, cookie);
    expect(res.status).toBe(422);
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
