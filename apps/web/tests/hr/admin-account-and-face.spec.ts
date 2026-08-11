/**
 * Two administrator workflows whose safety lives entirely in the service layer.
 *
 * `createStaffAccount` mints a login. The rank rule from `accounts.ts` — you may
 * never act on an account at or above your own level — has to bind here too,
 * because an administrator who can *create* a peer can promote themselves by
 * proxy and the rule protecting every other path is worthless.
 *
 * `resetFaceEnrolment` erases biometric templates. It refuses without a reason,
 * because an administrator who can silently wipe the evidence of who checked in
 * can also erase their own reason for doing it. It must also leave consent
 * alone: consent is the employee's to give and to withdraw, and HR recording a
 * withdrawal on somebody's behalf is the thing UAE PDPL is there to stop.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createStaffAccount } from '@/services/identity/accounts';
import { resetFaceEnrolment } from '@/services/hr/attendance';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createWorkspaceUser } from '../helpers/fixtures';
import type { PermissionMap } from '@/lib/security/rbac';
import type { PermissionAction } from '@prisma/client';

const suffix = randomBytes(4).toString('hex');
const slug = `acctface-${suffix}`;

let tenantId = '';
let adminCtx: ReturnType<typeof buildCtx>;
let adminRoleId = '';
let staffRoleId = '';
let locationId = '';
let employeeId = '';

async function role(key: string, rank: number, grants: [string, PermissionAction][]) {
  const created = await prisma.role.create({
    data: { tenantId, key: `${key}-${suffix}`, name: key, rank, defaultScope: 'ORGANIZATION' },
  });
  for (const [module, action] of grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: created.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
    });
  }
  return created;
}

/**
 * Rank 10 with organization scope: the workspace administrator these workflows
 * are written for. The rank matters more than the permissions here — it is what
 * `createStaffAccount` compares the requested role against.
 */
function context(userId: string, roleId: string, roleRank: number) {
  return buildCtx(
    buildActor({
      id: userId,
      tenantId,
      roleId,
      roleRank,
      permissions: new Map([
        ['users:MANAGE_USERS', 'ORGANIZATION'],
        ['employee:VIEW', 'ORGANIZATION'],
        ['employee:EDIT', 'ORGANIZATION'],
      ]) as PermissionMap,
    }),
  );
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'AcctFace LLC', displayName: 'AcctFace', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

  const adminRole = await role('acctadmin', 10, [
    ['users', 'VIEW'],
    ['users', 'MANAGE_USERS'],
    ['employee', 'VIEW'],
    ['employee', 'EDIT'],
  ]);
  adminRoleId = adminRole.id;
  staffRoleId = (await role('acctstaff', 60, [['employee', 'VIEW']])).id;

  const admin = await createWorkspaceUser({
    tenantId,
    roleId: adminRoleId,
    email: `admin-${suffix}@acctface.test`,
    fullName: 'Workspace Admin',
  });
  adminCtx = context(admin.id, adminRoleId, 10);

  const location = await prisma.hrWorkLocation.create({
    data: { tenantId, name: `Site ${suffix}`, latitude: 25.2, longitude: 55.27, radiusMeters: 150, status: 'ACTIVE' },
  });
  locationId = location.id;

  // The admin's own employee record, so the assignment can record who made it.
  const membership = await prisma.workspaceMembership.findFirstOrThrow({
    where: { tenantId, salesUserId: admin.id },
  });
  await prisma.employeeProfile.create({
    data: { tenantId, membershipId: membership.id, employeeNumber: `AF-${suffix}`, employmentStatus: 'ACTIVE' },
  });
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } });
});

const hire = (over: Partial<Parameters<typeof createStaffAccount>[1]> = {}) => ({
  fullName: 'New Hire',
  employeeNumber: `NH-${randomBytes(3).toString('hex')}`,
  email: `hire-${randomBytes(4).toString('hex')}@acctface.test`,
  roleId: staffRoleId,
  joinedOn: '2026-01-05',
  status: 'ACTIVE' as const,
  attendanceEligible: true,
  workLocationId: locationId,
  ...over,
});

describe('createStaffAccount', () => {
  it('creates the employee, the login and the attendance assignment together', async () => {
    const input = hire();
    const result = await createStaffAccount(adminCtx, input);

    expect(result.temporaryPassword).toHaveLength(19);
    employeeId = result.employeeId;

    const employee = await prisma.employeeProfile.findFirstOrThrow({
      where: { tenantId, id: result.employeeId },
      include: { membership: { select: { platformUserId: true, salesUserId: true } } },
    });
    expect(employee.employeeNumber).toBe(input.employeeNumber);
    expect(employee.membership.salesUserId).toBe(result.userId);

    const assignment = await prisma.hrEmployeeLocationAssignment.findFirstOrThrow({
      where: { tenantId, employeeId: result.employeeId },
    });
    expect(assignment.locationId).toBe(locationId);
  });

  it('forces a password change at first sign-in and never stores the password in the clear', async () => {
    const result = await createStaffAccount(adminCtx, hire());
    const employee = await prisma.employeeProfile.findFirstOrThrow({
      where: { tenantId, id: result.employeeId },
      include: { membership: { select: { platformUserId: true } } },
    });
    const platformUser = await prisma.platformUser.findUniqueOrThrow({
      where: { id: employee.membership.platformUserId },
      select: { passwordHash: true, passwordChangedAt: true },
    });

    // Null is the signal the sign-in path reads as "still on an issued password".
    expect(platformUser.passwordChangedAt).toBeNull();
    expect(platformUser.passwordHash).not.toContain(result.temporaryPassword);
    expect(platformUser.passwordHash?.startsWith('$argon2')).toBe(true);

    const entries = await prisma.auditLog.findMany({ where: { tenantId, recordId: result.userId } });
    expect(entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(entries)).not.toContain(result.temporaryPassword);
  });

  it('refuses to grant a role at or above the creator’s own level', async () => {
    await expect(createStaffAccount(adminCtx, hire({ roleId: adminRoleId }))).rejects.toThrow(/at or above your own/i);
  });

  it('refuses an attendance-eligible hire with no location, rather than creating one who can never check in', async () => {
    await expect(
      createStaffAccount(adminCtx, hire({ attendanceEligible: true, workLocationId: undefined })),
    ).rejects.toThrow(/attendance location/i);
  });

  it('refuses a duplicate employee code', async () => {
    const first = hire();
    await createStaffAccount(adminCtx, first);
    await expect(createStaffAccount(adminCtx, hire({ employeeNumber: first.employeeNumber }))).rejects.toThrow(
      /already taken/i,
    );
  });
});

describe('resetFaceEnrolment', () => {
  beforeAll(async () => {
    await prisma.biometricConsent.create({
      data: { tenantId, employeeId, grantedAt: new Date(), policyVersion: 'PDPL-2026-01' },
    });
    await prisma.hrFaceTemplate.createMany({
      data: [1, 2, 3, 4].map(() => ({
        tenantId,
        employeeId,
        embedding: Buffer.from(new Float32Array(512).buffer),
        dim: 512,
        modelVersion: 'buffalo_l',
      })),
    });
  });

  it('refuses without a reason', async () => {
    await expect(resetFaceEnrolment(adminCtx, employeeId, '   ')).rejects.toThrow(/reason/i);
    expect(await prisma.hrFaceTemplate.count({ where: { tenantId, employeeId } })).toBe(4);
  });

  it('deletes every template, records the reason, and leaves consent standing', async () => {
    const result = await resetFaceEnrolment(adminCtx, employeeId, 'Samples too blurred to match reliably.');
    expect(result.templatesDeleted).toBe(4);
    expect(await prisma.hrFaceTemplate.count({ where: { tenantId, employeeId } })).toBe(0);

    // Consent is the employee's to withdraw. A reset says the samples are no
    // longer good, not that permission was revoked.
    const consent = await prisma.biometricConsent.findFirstOrThrow({ where: { tenantId, employeeId } });
    expect(consent.withdrawnAt).toBeNull();

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, recordId: employeeId, objectType: 'hr_face_template' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(JSON.stringify(entry.metadata)).toContain('blurred');
  });
});
