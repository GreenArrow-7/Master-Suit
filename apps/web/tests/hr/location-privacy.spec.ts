/**
 * Geofence coordinates must never reach a non-administrator.
 *
 * The punch flow measures distance on the server precisely because a
 * client-reported position is untrusted — but `work-locations`,
 * `location-assignments` and `attendance-punches` used to hand the fence
 * centre back in JSON to anyone holding base `employee:VIEW`. Knowing the
 * centre is exactly what a convincing GPS spoof needs, so employees get the
 * fence's name and size, never where it is. Assignments are scoped the same
 * way: who works where is HR data.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { GET as hrRead, PATCH as hrUpdate } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser } from '../helpers/fixtures';
import { get, patch } from '../helpers/request';
import type { Grants } from '../helpers/fixtures';
import type { VisibilityScope } from '@prisma/client';

const suffix = randomBytes(4).toString('hex');
const slug = `locpriv-${suffix}`;

let tenantId = '';
let adminCookie = '';
let plainCookie = '';
let locationId = '';
let plainEmployeeId = '';

const at = (resource: string) => ({
  path: `/api/v1/workspaces/${slug}/hr/${resource}`,
  params: { workspaceSlug: slug, resource },
});

async function member(label: string, grants: Grants, scope: VisibilityScope) {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 20, defaultScope: scope },
  });
  for (const [module, action] of grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope },
    });
  }
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${label}-${suffix}@locpriv.test`,
    fullName: label,
  });
  return user;
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'LocPriv LLC', displayName: 'LocPriv', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

  const admin = await member(
    'hradmin',
    [
      ['employee', 'VIEW'],
      ['employee', 'EDIT'],
    ],
    'ORGANIZATION',
  );
  adminCookie = await createSessionToken(tenantId, admin.id);

  const plain = await member('plain', [['employee', 'VIEW']], 'OWN');
  plainCookie = await createSessionToken(tenantId, plain.id);

  const location = await prisma.hrWorkLocation.create({
    data: {
      tenantId,
      name: `Head Office ${suffix}`,
      latitude: 25.2048,
      longitude: 55.2708,
      radiusMeters: 150,
      status: 'ACTIVE',
    },
  });
  locationId = location.id;

  // The plain user's employee record, assigned to the fence, with one punch
  // whose evidence snapshot carries the centre coordinate.
  const membership = await prisma.workspaceMembership.findFirstOrThrow({
    where: { tenantId, salesUserId: plain.id },
  });
  const employee = await prisma.employeeProfile.create({
    data: { tenantId, membershipId: membership.id, employeeNumber: `LP-${suffix}`, employmentStatus: 'ACTIVE' },
  });
  plainEmployeeId = employee.id;

  const adminMembership = await prisma.workspaceMembership.findFirstOrThrow({
    where: { tenantId, salesUserId: admin.id },
  });
  const adminEmployee = await prisma.employeeProfile.create({
    data: {
      tenantId,
      membershipId: adminMembership.id,
      employeeNumber: `LPA-${suffix}`,
      employmentStatus: 'ACTIVE',
    },
  });

  await prisma.hrEmployeeLocationAssignment.createMany({
    data: [
      { tenantId, employeeId: employee.id, locationId: location.id, status: 'ACTIVE' },
      { tenantId, employeeId: adminEmployee.id, locationId: location.id, status: 'ACTIVE' },
    ],
  });

  await prisma.hrAttendancePunch.create({
    data: {
      tenantId,
      employeeId: employee.id,
      punchType: 'CHECK_IN',
      result: 'REJECTED_GEOFENCE',
      method: 'face',
      latitude: 25.21,
      longitude: 55.28,
      gpsAccuracyM: 10,
      distanceM: 980,
      deviceFingerprint: 'test-device',
      rejectCode: 'OUTSIDE_APPROVED_LOCATION',
      locationId: location.id,
      locLatitude: location.latitude,
      locLongitude: location.longitude,
      locRadiusM: location.radiusMeters,
    },
  });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('work-locations', () => {
  it('returns the fence centre to HR', async () => {
    const res = await get(hrRead, at('work-locations').path, adminCookie, at('work-locations').params);
    expect(res.status).toBe(200);
    expect(res.body[0].latitude).toBeCloseTo(25.2048);
  });

  it('withholds the fence centre from a plain employee', async () => {
    const res = await get(hrRead, at('work-locations').path, plainCookie, at('work-locations').params);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const row of res.body) {
      expect(row).not.toHaveProperty('latitude');
      expect(row).not.toHaveProperty('longitude');
      expect(row).not.toHaveProperty('address');
      // The size of the fence is fine — the status display needs it.
      expect(row.radiusMeters).toBe(150);
    }
  });
});

describe('location-assignments', () => {
  it('shows a plain employee only their own, without coordinates', async () => {
    const res = await get(hrRead, at('location-assignments').path, plainCookie, at('location-assignments').params);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].employeeId).toBe(plainEmployeeId);
    expect(res.body[0].location).not.toHaveProperty('latitude');
  });

  it('shows HR everyone, with coordinates', async () => {
    const res = await get(hrRead, at('location-assignments').path, adminCookie, at('location-assignments').params);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].location.latitude).toBeCloseTo(25.2048);
  });
});

describe('moving an active fence', () => {
  const target = () => ({
    path: `/api/v1/workspaces/${slug}/hr/work-locations?id=${locationId}`,
    params: { workspaceSlug: slug, resource: 'work-locations' },
  });

  it('refuses a geometry change without a written reason', async () => {
    const res = await patch(hrUpdate, target().path, { radiusMeters: 200 }, adminCookie, target().params);
    expect(res.status).toBe(409);
  });

  it('accepts the same change once a reason is given, and audits it', async () => {
    const res = await patch(
      hrUpdate,
      target().path,
      { radiusMeters: 200, changeReason: 'Compound wall moved after renovation' },
      adminCookie,
      target().params,
    );
    expect(res.status).toBe(200);
    expect(res.body.radiusMeters).toBe(200);

    const trail = await prisma.auditLog.findFirst({
      where: { tenantId, recordId: locationId, objectType: 'hr_work_location' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(trail).not.toBeNull();
  });

  it('lets a rename through without ceremony — only geometry needs a reason', async () => {
    const res = await patch(
      hrUpdate,
      target().path,
      { name: `Head Office ${suffix} renamed` },
      adminCookie,
      target().params,
    );
    expect(res.status).toBe(200);
  });
});

describe('attendance-punches', () => {
  it('never returns the location evidence snapshot to the employee', async () => {
    const res = await get(hrRead, at('attendance-punches').path, plainCookie, at('attendance-punches').params);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    const row = res.body[0];
    // A rejected punch would otherwise hand back the exact coordinate a
    // spoofed retry needs.
    expect(row).not.toHaveProperty('locLatitude');
    expect(row).not.toHaveProperty('locLongitude');
    expect(row.rejectCode).toBe('OUTSIDE_APPROVED_LOCATION');
    expect(row.distanceM).toBe(980);
  });
});
