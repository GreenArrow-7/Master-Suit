/**
 * Finding B — booking confirmation vs. unit availability.
 * Finding C — who may record collection, and what "collected" means.
 *
 * Driven over the real route handlers with a real session, so what fails here
 * is what an authenticated caller can actually do.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, type PermissionAction, type VisibilityScope } from '@prisma/client';
import { prisma } from '@/lib/db';
import { POST as createBooking, PATCH as patchBooking } from '@/app/api/v1/bookings/route';
import { createSessionToken } from '../helpers/session';
import { patch, post } from '../helpers/request';

const suffix = randomBytes(4).toString('hex');
const D = (n: number) => new Prisma.Decimal(n);

let tenantId = '';
let projectId = '';
let leadId = '';

/** An agent holding only the booking permissions — no finance authority at all. */
let sellerCookie = '';
let sellerId = '';

const SELLER_GRANTS: readonly (readonly [string, PermissionAction])[] = [
  ['bookings', 'VIEW'],
  ['bookings', 'CREATE'],
  ['bookings', 'EDIT'],
];

async function makeUser(label: string, grants: readonly (readonly [string, PermissionAction])[]) {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: 'ORGANIZATION' },
  });
  for (const [module, action] of grants) {
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

  const email = `${label}-${suffix}@diag.test`;
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: label, roleId: role.id, status: 'ACTIVE' },
  });
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: label, status: 'ACTIVE' },
  });
  await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  return { id: user.id, cookie: await createSessionToken(tenantId, user.id), email };
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `diag-bk-${suffix}`, legalName: 'Diag BK LLC', displayName: 'Diag BK', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const seller = await makeUser('seller', SELLER_GRANTS);
  sellerCookie = seller.cookie;
  sellerId = seller.id;

  const project = await prisma.project.create({ data: { tenantId, name: 'Diag project', code: `P-${suffix}` } });
  projectId = project.id;

  const stage = await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', position: 0, isDefault: true },
  });
  const lead = await prisma.lead.create({
    data: { tenantId, reference: `L-${suffix}`, fullName: 'Buyer', stageId: stage.id, ownerId: sellerId },
  });
  leadId = lead.id;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser
    .deleteMany({ where: { normalizedEmail: { endsWith: `-${suffix}@diag.test` } } })
    .catch(() => {});
});

async function unit(unitNumber: string, status: 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED' = 'AVAILABLE') {
  return prisma.unitInventory.create({
    data: { tenantId, projectId, unitNumber: `${unitNumber}-${suffix}`, status, price: D(1_000_000) },
  });
}

async function draftBookingFor(unitId: string) {
  const res = await post(
    createBooking,
    '/api/v1/bookings',
    {
      leadId,
      projectId,
      unitInventoryId: unitId,
      saleValue: 1_000_000,
      agencyFee: 30_000,
      bookingDate: new Date('2026-08-10T00:00:00Z').toISOString(),
    },
    sellerCookie,
  );
  expect(res.status).toBe(200);
  return res.body.id as string;
}

describe('Finding B — booking confirmation and unit availability', () => {
  it('B1: confirming a booking marks its unit as no longer available', async () => {
    const u = await unit('B1');
    const bookingId = await draftBookingFor(u.id);

    const res = await patch(patchBooking, '/api/v1/bookings', { action: 'CONFIRM', bookingId }, sellerCookie);
    expect(res.status).toBe(200);

    const after = await prisma.unitInventory.findFirstOrThrow({ where: { id: u.id, tenantId } });
    // A confirmed sale against a unit that still reads AVAILABLE is inventory
    // the next agent will be shown and can sell again.
    expect(after.status).not.toBe('AVAILABLE');
  });

  it('B2: a unit already SOLD cannot take a second confirmed booking', async () => {
    const u = await unit('B2', 'SOLD');
    const bookingId = await draftBookingFor(u.id);

    const res = await patch(patchBooking, '/api/v1/bookings', { action: 'CONFIRM', bookingId }, sellerCookie);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('B3: two concurrent confirmations against one unit — only one may win', async () => {
    const u = await unit('B3');
    const first = await draftBookingFor(u.id);
    const second = await draftBookingFor(u.id);

    const [a, b] = await Promise.all([
      patch(patchBooking, '/api/v1/bookings', { action: 'CONFIRM', bookingId: first }, sellerCookie),
      patch(patchBooking, '/api/v1/bookings', { action: 'CONFIRM', bookingId: second }, sellerCookie),
    ]);

    const confirmed = [a, b].filter((r) => r.status === 200).length;
    // Two confirmed bookings on one flat is the double-sale this control exists
    // to prevent.
    expect(confirmed).toBe(1);
  });

  it('B4: a unit held by another agent cannot be booked out from under them', async () => {
    const other = await makeUser('holder', SELLER_GRANTS);
    const u = await prisma.unitInventory.create({
      data: {
        tenantId,
        projectId,
        unitNumber: `B4-${suffix}`,
        status: 'HELD',
        heldById: other.id,
        heldUntil: new Date(Date.now() + 86_400_000),
        price: D(1_000_000),
      },
    });
    const bookingId = await draftBookingFor(u.id);

    const res = await patch(patchBooking, '/api/v1/bookings', { action: 'CONFIRM', bookingId }, sellerCookie);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('Finding C — collection authority and evidence', () => {
  it('C1: booking EDIT alone is not enough to record collection', async () => {
    const u = await unit('C1');
    const bookingId = await draftBookingFor(u.id);
    await patch(patchBooking, '/api/v1/bookings', { action: 'CONFIRM', bookingId }, sellerCookie);

    const res = await patch(
      patchBooking,
      '/api/v1/bookings',
      { action: 'COLLECT', bookingId, collectedAt: new Date().toISOString() },
      sellerCookie,
    );

    // Recording that money arrived is a finance fact. The seller who booked the
    // sale should not also be the one who certifies it was paid.
    expect(res.status).toBe(403);
  });

  it('C2: collection records how much arrived, not just that something did', async () => {
    const u = await unit('C2');
    const bookingId = await draftBookingFor(u.id);
    await patch(patchBooking, '/api/v1/bookings', { action: 'CONFIRM', bookingId }, sellerCookie);
    await patch(patchBooking, '/api/v1/bookings', { action: 'COLLECT', bookingId }, sellerCookie);

    const booking = await prisma.booking.findFirstOrThrow({ where: { id: bookingId, tenantId } });
    expect(booking.collectedAt).not.toBeNull();

    // A timestamp cannot say whether 5% or 100% of the agency fee arrived, and
    // commission eligibility hangs off it. Somewhere there must be an amount.
    const keys = Object.keys(booking);
    expect(keys.some((k) => /collectedAmount|amountCollected|receipt|paymentRef/i.test(k))).toBe(true);
  });
});
