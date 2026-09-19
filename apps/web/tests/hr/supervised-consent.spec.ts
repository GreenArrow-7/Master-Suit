import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { activeConsent, grantConsentSupervised } from '@/services/hr/attendance';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { PermissionMap } from '@/lib/security/rbac';

/**
 * Consent recorded at HR's desk with the employee present: the employee signs by
 * typing their full name; HR submits; the record keeps who recorded it and the
 * signature. Anyone else, or a wrong name, is refused.
 */
const suffix = randomBytes(4).toString('hex');
let tenantId = '';
let employeeId = '';
let hrUserId = '';
let repUserId = '';

async function user(key: string, rank: number, grants: [string, string][]) {
  const role = await prisma.role.create({
    data: { tenantId, key: `${key}-${suffix}`, name: key, rank, defaultScope: 'ORGANIZATION' },
  });
  for (const [module, action] of grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action: action as never } },
      update: {},
      create: { module, action: action as never },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
    });
  }
  const u = await prisma.user.create({
    data: { tenantId, email: `${key}-${suffix}@example.com`, fullName: key, roleId: role.id, status: 'ACTIVE' },
  });
  return { id: u.id, roleId: role.id, rank, grants };
}

const ctxFor = (u: { id: string; roleId: string; rank: number; grants: [string, string][] }) =>
  buildCtx(
    buildActor({
      id: u.id,
      tenantId,
      roleId: u.roleId,
      roleRank: u.rank,
      permissions: new Map(u.grants.map(([m, a]) => [`${m}:${a}`, 'ORGANIZATION'])) as PermissionMap,
    }),
  );

let hr: Awaited<ReturnType<typeof user>>;
let rep: Awaited<ReturnType<typeof user>>;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `supcon-${suffix}`, legalName: 'SupCon LLC', displayName: 'SupCon', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  hr = await user('hr_admin', 20, [
    ['employee', 'VIEW'],
    ['employee', 'EDIT'],
  ]);
  rep = await user('rep', 60, [['employee', 'VIEW']]);
  hrUserId = hr.id;
  repUserId = rep.id;
  const platformUser = await prisma.platformUser.create({
    data: {
      email: `staff-${suffix}@example.com`,
      normalizedEmail: `staff-${suffix}@example.com`,
      fullName: 'Maya  Al Farsi',
      status: 'ACTIVE',
    },
  });
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  const profile = await prisma.employeeProfile.create({
    data: { tenantId, membershipId: membership.id, employeeNumber: `SC-${suffix}`, employmentStatus: 'ACTIVE' },
  });
  employeeId = profile.id;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('supervised biometric consent', () => {
  it('refuses a wrong signature and a non-HR recorder', async () => {
    await expect(grantConsentSupervised(ctxFor(hr), employeeId, { signature: 'M. Farsi' })).rejects.toMatchObject({
      status: 409,
    });
    await expect(grantConsentSupervised(ctxFor(rep), employeeId, { signature: 'Maya Al Farsi' })).rejects.toMatchObject(
      { status: 403 },
    );
    expect(await activeConsent(ctxFor(hr), employeeId)).toBeNull();
  });

  it('records the consent with the signature and who recorded it, once', async () => {
    const consent = await grantConsentSupervised(ctxFor(hr), employeeId, { signature: ' maya al farsi ' });
    expect(consent.recordedById).toBe(hrUserId);
    expect(consent.attestation).toBe('maya al farsi');
    expect(consent.grantedAt).toBeTruthy();
    const again = await grantConsentSupervised(ctxFor(hr), employeeId, { signature: 'Maya Al Farsi' });
    expect(again.id).toBe(consent.id);
    expect(repUserId).not.toBe(hrUserId);
  });
});
