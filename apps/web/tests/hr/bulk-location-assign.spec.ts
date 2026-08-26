/**
 * HRMS-v21 location admin: assigning several employees to a fence in one action
 * (the bulk case) and the address-search proxy the map picker depends on.
 *
 * The endpoint took a single employeeId; v21 assigns a floor at once. The array
 * form is the general case and a single id is its one-element instance — this
 * proves both, and that a non-existent employee id fails the whole batch rather
 * than half-assigning it.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as hrCreate } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser } from '../helpers/fixtures';
import { post } from '../helpers/request';

const suffix = randomBytes(4).toString('hex');
const slug = `bulkloc-${suffix}`;

let tenantId = '';
let adminCookie = '';
let locationId = '';
const employeeIds: string[] = [];

const at = (resource: string) => ({
  path: `/api/v1/workspaces/${slug}/hr/${resource}`,
  params: { workspaceSlug: slug, resource },
});

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'BulkLoc LLC', displayName: 'BulkLoc', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

  const role = await prisma.role.create({
    data: { tenantId, key: `hr-${suffix}`, name: 'HR', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  for (const [module, action] of [
    ['employee', 'VIEW'],
    ['employee', 'EDIT'],
    ['employee', 'CREATE'],
  ] as const) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
    });
  }
  const admin = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `hr-${suffix}@bulk.test`,
    fullName: 'HR Admin',
  });
  adminCookie = await createSessionToken(tenantId, admin.id);

  const location = await prisma.hrWorkLocation.create({
    data: { tenantId, name: `HQ ${suffix}`, latitude: 25.2, longitude: 55.27, radiusMeters: 150, status: 'ACTIVE' },
  });
  locationId = location.id;

  for (let i = 0; i < 3; i++) {
    const platformUser = await prisma.platformUser.create({
      data: {
        email: `emp${i}-${suffix}@bulk.test`,
        normalizedEmail: `emp${i}-${suffix}@bulk.test`,
        fullName: `Employee ${i}`,
        status: 'ACTIVE',
      },
    });
    const membership = await prisma.workspaceMembership.create({
      data: { tenantId, platformUserId: platformUser.id, status: 'ACTIVE', joinedAt: new Date() },
    });
    const profile = await prisma.employeeProfile.create({
      data: { tenantId, membershipId: membership.id, employeeNumber: `E${i}-${suffix}`, employmentStatus: 'ACTIVE' },
    });
    employeeIds.push(profile.id);
  }
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('bulk work-location assignment', () => {
  it('assigns three employees in one call', async () => {
    const res = await post(
      hrCreate,
      at('location-assignments').path,
      { employeeIds, locationId, checkoutRule: 'SAME_LOCATION' },
      adminCookie,
      at('location-assignments').params,
    );
    expect(res.status).toBe(200);
    expect(res.body.assigned).toBe(3);
    const rows = await prisma.hrEmployeeLocationAssignment.count({ where: { tenantId, locationId } });
    expect(rows).toBe(3);
  });

  it('still accepts a single employeeId', async () => {
    const solo = await prisma.employeeProfile.findFirstOrThrow({ where: { tenantId }, select: { id: true } });
    const other = await prisma.hrWorkLocation.create({
      data: {
        tenantId,
        name: `Branch ${suffix}`,
        latitude: 25.1,
        longitude: 55.2,
        radiusMeters: 120,
        status: 'ACTIVE',
      },
    });
    const res = await post(
      hrCreate,
      at('location-assignments').path,
      { employeeId: solo.id, locationId: other.id },
      adminCookie,
      at('location-assignments').params,
    );
    expect(res.status).toBe(200);
    expect(res.body.assigned).toBe(1);
  });

  it('fails the whole batch if any employee id is unknown', async () => {
    const before = await prisma.hrEmployeeLocationAssignment.count({ where: { tenantId, locationId } });
    const res = await post(
      hrCreate,
      at('location-assignments').path,
      { employeeIds: [employeeIds[0], 'cnonexistent000000000000'], locationId },
      adminCookie,
      at('location-assignments').params,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    const after = await prisma.hrEmployeeLocationAssignment.count({ where: { tenantId, locationId } });
    expect(after).toBe(before);
  });
});

describe('geocode proxy', () => {
  it('returns normalised results from the upstream geocoder', async () => {
    // The upstream is mocked: the test asserts our shaping, not Nominatim's uptime.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([{ lat: '25.08', lon: '55.14', display_name: 'Dubai Marina, Dubai, UAE' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { GET } = await import('@/app/api/v1/geocode/route');
    const { get } = await import('../helpers/request');
    const res = await get(GET, '/api/v1/geocode?q=Dubai Marina', adminCookie, {});
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toEqual({ label: 'Dubai Marina, Dubai, UAE', latitude: 25.08, longitude: 55.14 });
    fetchMock.mockRestore();
  });
});
