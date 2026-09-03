/**
 * Face data is for attendance, and consent says so explicitly.
 *
 * Enforcement already existed — enrolment and both check-in paths refuse
 * without a live consent row — but the row recorded only *that* the employee
 * consented, not what to. A single "this person consented to face data" is a
 * permission slip with no subject: the day face is wired to door access,
 * workstation unlock, or signing in to Master-Suit itself, that row would
 * silently cover it, on a decision the person made about clocking in.
 *
 * These drive the real service functions in services/hr/attendance.ts.
 *
 * NOT covered here, and deliberately: the biometric matching itself. `enrolFace`
 * hands frames to the face service (apps/face), which is not running in this
 * suite — so what is asserted is the *gate*, which is the security property.
 * Template matching is exercised where that service is available.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { PermissionMap, Scope } from '@/lib/security/rbac';
import {
  ATTENDANCE_FACE_PURPOSE,
  activeConsent,
  enrolFace,
  grantConsent,
  requestChallenge,
  withdrawConsent,
} from '@/services/hr/attendance';

const suffix = randomBytes(4).toString('hex');

let tenantId = '';
let employeeId = '';
let userId = '';
let membershipId = '';

const permissions = (grants: readonly (readonly [string, string])[], scope: Scope) =>
  new Map(grants.map(([module, action]) => [`${module}:${action}`, scope])) as PermissionMap;

/** HR administrator scope, which is what `enrolFace` requires beyond consent. */
const hrCtx = () =>
  buildCtx(
    buildActor({
      id: userId,
      tenantId,
      permissions: permissions(
        [
          ['employee', 'VIEW'],
          ['employee', 'EDIT'],
          ['attendance', 'VIEW'],
          ['attendance', 'EDIT'],
        ],
        'ORGANIZATION',
      ),
    }),
  );

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `biometric-${suffix}`, legalName: 'Biometric LLC', displayName: 'Biometric' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

  const email = `employee-${suffix}@biometric.test`;
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: 'Face Employee', status: 'ACTIVE' },
  });
  const role = await prisma.role.create({
    data: { tenantId, key: `hr-${suffix}`, name: 'HR', rank: 20, defaultScope: 'ORGANIZATION' },
  });
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: 'Face Employee', roleId: role.id, status: 'ACTIVE' },
  });
  userId = user.id;
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  membershipId = membership.id;
  const employee = await prisma.employeeProfile.create({
    data: { tenantId, membershipId: membership.id, employeeNumber: `BIO-${suffix}`, employmentStatus: 'ACTIVE' },
  });
  employeeId = employee.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
});

describe('biometric consent is scoped to attendance', () => {
  it('refuses face enrolment before any consent exists', async () => {
    /**
     * Matched on the message, not merely on 409.
     *
     * The first draft asserted `{ status: 409 }` and passed with the consent
     * gate deleted, because the very next check — too few frames — is also a
     * Conflict. A gate test that a removed gate satisfies is not a test.
     */
    await expect(enrolFace(hrCtx(), employeeId, ['frame-a', 'frame-b'])).rejects.toThrow(
      /biometric consent before enrolling/i,
    );
    expect(await prisma.hrFaceTemplate.count({ where: { tenantId, employeeId } })).toBe(0);
  });

  it('refuses a check-in challenge before any consent exists', async () => {
    await expect(requestChallenge(hrCtx())).rejects.toThrow(/biometric consent before using face check-in/i);
  });

  it('records the purpose, the wording shown, and no biometric data', async () => {
    const consent = await grantConsent(hrCtx(), 'PDPL-2026-01', { consentVersion: 'attendance-face-v1' });

    expect(consent.purpose, 'consent names what it is for').toBe(ATTENDANCE_FACE_PURPOSE);
    expect(consent.policyVersion).toBe('PDPL-2026-01');
    expect(consent.consentVersion, 'the wording the employee was shown').toBe('attendance-face-v1');
    expect(consent.grantedAt).not.toBeNull();
    expect(consent.withdrawnAt).toBeNull();

    // The audit metadata is context, never biometrics.
    const metadata = consent.metadata as Record<string, unknown>;
    expect(Object.keys(metadata).sort()).toEqual(['ip', 'recordedByUserId', 'userAgent']);
    expect(JSON.stringify(metadata)).not.toMatch(/frame|template|embedding|descriptor/i);
  });

  it('is idempotent — consenting twice does not stack rows', async () => {
    const again = await grantConsent(hrCtx());
    const rows = await prisma.biometricConsent.count({
      where: { tenantId, employeeId, withdrawnAt: null },
    });
    expect(rows).toBe(1);
    expect(again.consentVersion, 'the original consent is returned, not replaced').toBe('attendance-face-v1');
  });

  it('resolves consent only for the purpose asked about', async () => {
    const found = await activeConsent(hrCtx(), employeeId, ATTENDANCE_FACE_PURPOSE);
    expect(found).not.toBeNull();
    expect(found!.purpose).toBe(ATTENDANCE_FACE_PURPOSE);

    // The query filters on `purpose`, so a row stored under another value is not
    // returned. There is one value in the enum today by design — a second use of
    // face data has to add its own, which is exactly what forces a fresh consent
    // rather than inheriting this one.
    const rows = await prisma.biometricConsent.findMany({ where: { tenantId, employeeId } });
    expect(rows.every((row) => row.purpose === ATTENDANCE_FACE_PURPOSE)).toBe(true);
  });

  it('lets enrolment past the consent gate once consent exists', async () => {
    /**
     * Past the gate, not through the whole flow: the next thing `enrolFace` does
     * is call the face service, which is not running here. The assertion is
     * therefore that the *consent* refusal is gone — a 409 naming consent would
     * mean the gate still blocks. Biometric matching itself is NOT VERIFIED in
     * this suite.
     */
    await expect(enrolFace(hrCtx(), employeeId, ['frame-a', 'frame-b'])).rejects.not.toMatchObject({
      message: expect.stringContaining('biometric consent'),
    });
  });

  it('withdrawal stops face attendance and destroys the templates', async () => {
    await prisma.hrFaceTemplate.create({
      data: { tenantId, employeeId, embedding: Buffer.from([1, 2, 3]), dim: 3 },
    });
    expect(await prisma.hrFaceTemplate.count({ where: { tenantId, employeeId } })).toBe(1);

    const result = await withdrawConsent(hrCtx(), employeeId);
    expect(result.consentsWithdrawn).toBeGreaterThan(0);
    expect(result.templatesDeleted).toBe(1);
    expect(await prisma.hrFaceTemplate.count({ where: { tenantId, employeeId } })).toBe(0);

    expect(await activeConsent(hrCtx(), employeeId)).toBeNull();
    await expect(requestChallenge(hrCtx())).rejects.toThrow(/biometric consent before using face check-in/i);
    await expect(enrolFace(hrCtx(), employeeId, ['frame-a'])).rejects.toThrow(/biometric consent before enrolling/i);
  });

  it('withdrawal leaves the account, the membership and module access alone', async () => {
    // Biometric attendance permission is not platform login. Withdrawing it must
    // not cost the person their job in the product.
    const membership = await prisma.workspaceMembership.findFirstOrThrow({
      where: { id: membershipId, tenantId },
      include: { platformUser: true, salesUser: true },
    });
    expect(membership.status).toBe('ACTIVE');
    expect(membership.platformUser.status).toBe('ACTIVE');
    expect(membership.salesUser!.status).toBe('ACTIVE');

    const employee = await prisma.employeeProfile.findFirstOrThrow({ where: { id: employeeId, tenantId } });
    expect(employee.deletedAt, 'the employee record survives').toBeNull();

    const entitlement = await prisma.moduleEntitlement.findFirstOrThrow({ where: { tenantId, module: 'HRMS' } });
    expect(entitlement.state, 'HR access is untouched').toBe('ACTIVE');
  });

  it('keeps the withdrawn consent as evidence rather than deleting it', async () => {
    const withdrawn = await prisma.biometricConsent.findMany({ where: { tenantId, employeeId } });
    expect(withdrawn.length, 'the record of what was consented to is retained').toBeGreaterThan(0);
    expect(withdrawn.every((row) => row.withdrawnAt !== null)).toBe(true);
    expect(withdrawn[0]!.purpose).toBe(ATTENDANCE_FACE_PURPOSE);
  });
});
