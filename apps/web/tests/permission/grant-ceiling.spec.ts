/**
 * Nobody may hand out authority they do not hold.
 *
 * Every path that gives somebody a role checks **rank**: you may not grant a
 * role at or above your own level. `assignRole` → `assertMayGrantRole`
 * (`roles.ts:40`), `changeUserRole` (`accounts.ts:698`), invitations
 * (`invitations.ts:78`).
 *
 * **Rank and reach are different things**, and only rank used to be checked. A
 * rank-60 "Sales Agent" role can carry ORGANIZATION-scoped permission rows, so
 * a branch manager could assign it and confer a workspace-wide read they did
 * not themselves have.
 *
 * These cases recorded that as characterisation before the ceiling existed. The
 * evidence is kept: the two assertions marked "was the escalation" passed on
 * the old code and fail on it now, which is the point of them.
 *
 * The ceiling is per permission (`lib/security/grantCeiling.ts`): the conferred
 * scope may not be wider than the assigner's own for that same `module:ACTION`,
 * **and** a named branch, team or region must sit inside the assigner's own by
 * id — because ordering is not containment. Marina does not contain Downtown.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assignRole } from '@/services/identity/roles';
import { ceilingBreaches } from '@/lib/security/grantCeiling';
import { changeUserRole } from '@/services/identity/accounts';
import { inviteUser } from '@/services/identity/invitations';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import type { Actor, Ctx } from '@/lib/security/rbac';

const suffix = randomBytes(4).toString('hex');
const slug = `ceiling-${suffix}`;

let tenantId = '';
let branchScopedCtx: Ctx;
let membershipId = '';
let subjectUserId = '';
let orgWideRoleId = '';
let seniorRoleId = '';
let payrollRoleId = '';
let ownBranchId = '';
let otherBranchId = '';
let orgWideCtx: Ctx;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Ceiling LLC', displayName: 'Ceiling', status: 'ACTIVE' },
  });
  tenantId = tenant.id;

  // The assigner: may administer roles, but only within a branch.
  const managerRole = await prisma.role.create({
    data: { tenantId, key: `branch-mgr-${suffix}`, name: 'Branch Manager', rank: 30, defaultScope: 'BRANCH' },
  });
  await grantPermissions(tenantId, managerRole.id, [
    ['roles', 'MANAGE_CONFIGURATION'],
    ['users', 'MANAGE_USERS'],
  ] as const);

  // The role they will hand out: junior in rank, workspace-wide in reach.
  const rep = await prisma.role.create({
    data: { tenantId, key: `rep-${suffix}`, name: 'Rep', rank: 60, defaultScope: 'ORGANIZATION' },
  });
  orgWideRoleId = rep.id;
  await grantPermissions(tenantId, rep.id, [['leads', 'VIEW']] as const);

  const senior = await prisma.role.create({
    data: { tenantId, key: `director-${suffix}`, name: 'Director', rank: 20, defaultScope: 'ORGANIZATION' },
  });
  seniorRoleId = senior.id;

  const manager = await createWorkspaceUser({
    tenantId,
    roleId: managerRole.id,
    email: `mgr-${suffix}@ceiling.test`,
    fullName: 'Branch Manager',
  });
  branchScopedCtx = buildCtx(
    buildActor({
      id: manager.id,
      tenantId,
      roleId: managerRole.id,
      roleRank: 30,
      // Narrow: this person administers roles for one branch, not the
      // workspace. Set directly, because `buildActor`'s `grants` helper writes
      // every permission at ORGANIZATION — which is the very thing under test.
      permissions: new Map([
        ['roles:MANAGE_CONFIGURATION', 'BRANCH'],
        ['users:MANAGE_USERS', 'BRANCH'],
        // Held, but only for their branch — which is the comparison under test.
        ['leads:VIEW', 'BRANCH'],
      ]) as Actor['permissions'],
    }),
  );

  const subject = await createWorkspaceUser({
    tenantId,
    roleId: rep.id,
    email: `subject-${suffix}@ceiling.test`,
    fullName: 'Subject',
  });
  membershipId = subject.membershipId;
  subjectUserId = subject.id;

  const marina = await prisma.branch.create({ data: { tenantId, name: 'Marina', code: `MAR${suffix}` } });
  ownBranchId = marina.id;
  const downtown = await prisma.branch.create({ data: { tenantId, name: 'Downtown', code: `DTN${suffix}` } });
  otherBranchId = downtown.id;
  // The assigner manages Marina and nothing else.
  await prisma.user.updateMany({ where: { tenantId, id: manager.id }, data: { branchId: marina.id } });
  (branchScopedCtx.actor as { branchId: string | null }).branchId = marina.id;

  // A role carrying an approval the branch manager does not hold at all.
  const payroll = await prisma.role.create({
    data: { tenantId, key: `payroll-${suffix}`, name: 'Payroll', rank: 55, defaultScope: 'BRANCH' },
  });
  payrollRoleId = payroll.id;
  await grantPermissions(tenantId, payroll.id, [['payroll', 'APPROVE']] as const);

  // And an administrator whose authority is the whole workspace, to prove the
  // ceiling does not block legitimate delegation.
  orgWideCtx = buildCtx(
    buildActor({
      id: manager.id,
      tenantId,
      roleId: managerRole.id,
      roleRank: 10,
      permissions: new Map([
        ['roles:MANAGE_CONFIGURATION', 'ORGANIZATION'],
        ['users:MANAGE_USERS', 'ORGANIZATION'],
        ['leads:VIEW', 'ORGANIZATION'],
      ]) as Actor['permissions'],
    }),
  );
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

const clear = () => prisma.membershipRole.deleteMany({ where: { tenantId, membershipId } });

describe('rank is enforced', () => {
  it('refuses a role above the assigner', async () => {
    await clear();
    await expect(assignRole(branchScopedCtx, { membershipId, roleId: seniorRoleId })).rejects.toThrow(
      /above your own level/i,
    );
  });
});

describe('reach is enforced per permission', () => {
  it('refuses an ORGANIZATION grant from a branch-scoped administrator — omitted (was the escalation)', async () => {
    await clear();
    await expect(assignRole(branchScopedCtx, { membershipId, roleId: orgWideRoleId })).rejects.toThrow(
      /cannot grant more than you hold/i,
    );
    expect(await prisma.membershipRole.count({ where: { tenantId, membershipId } })).toBe(0);
  });

  it('refuses it when named explicitly, too (was the escalation)', async () => {
    // Both doors, one rule. Closing only the omitted one would have changed
    // nothing, which is why the fix is a ceiling and not a default.
    await clear();
    await expect(
      assignRole(branchScopedCtx, { membershipId, roleId: orgWideRoleId, scopeType: 'ORGANIZATION' }),
    ).rejects.toThrow(/cannot grant more than you hold/i);
  });

  it('names the permission that exceeded the assigner', async () => {
    await clear();
    await expect(assignRole(branchScopedCtx, { membershipId, roleId: orgWideRoleId })).rejects.toThrow(
      /leads:VIEW at ORGANIZATION and you hold BRANCH/,
    );
  });

  it('allows the same role within the branch the assigner actually manages', async () => {
    // The ceiling must not make delegation impossible: narrowing to their own
    // branch is exactly what a branch manager should be able to do.
    await clear();
    const assignment = await assignRole(branchScopedCtx, {
      membershipId,
      roleId: orgWideRoleId,
      scopeType: 'BRANCH',
      scopeId: ownBranchId,
    });
    expect(assignment.scopeType).toBe('BRANCH');
    expect(assignment.scopeId).toBe(ownBranchId);
  });

  it('refuses another branch, which outranks nothing but is somewhere else', async () => {
    // BRANCH is not wider than BRANCH, so a rank comparison passes this and a
    // containment check must not: Marina does not contain Downtown.
    await clear();
    await expect(
      assignRole(branchScopedCtx, {
        membershipId,
        roleId: orgWideRoleId,
        scopeType: 'BRANCH',
        scopeId: otherBranchId,
      }),
    ).rejects.toThrow(/outside your own branch/i);
  });

  it('refuses a permission the assigner does not hold at all', async () => {
    await clear();
    await expect(
      assignRole(branchScopedCtx, { membershipId, roleId: payrollRoleId, scopeType: 'BRANCH', scopeId: ownBranchId }),
    ).rejects.toThrow(/do not hold payroll:APPROVE/);
  });

  it('lets an ORGANIZATION administrator grant as before', async () => {
    await clear();
    const assignment = await assignRole(orgWideCtx, { membershipId, roleId: orgWideRoleId });
    expect(assignment.scopeType).toBe('ORGANIZATION');
  });
});

/**
 * The same ceiling, on the other two paths that bind a person to a role.
 *
 * `assignRole` takes an explicit scope. These two do not: the role applies at
 * its own `defaultScope`. If an omitted scope were exempt, the way around the
 * ceiling would be to use one of these instead — which is why the rule the
 * owner set is that explicit and omitted reach are treated alike.
 */
describe('reach is enforced where no scope is named', () => {
  it('refuses a role change that would confer more than the assigner holds', async () => {
    await expect(changeUserRole(branchScopedCtx, subjectUserId, orgWideRoleId)).rejects.toThrow(
      /cannot grant more than you hold/i,
    );
  });

  it('refuses an invitation into that same role', async () => {
    await expect(
      inviteUser(branchScopedCtx, {
        email: `invitee-${suffix}@ceiling.test`,
        fullName: 'Invitee',
        roleId: orgWideRoleId,
      }),
    ).rejects.toThrow(/cannot grant more than you hold/i);
  });

  it('still lets a workspace-wide administrator do both', async () => {
    await expect(changeUserRole(orgWideCtx, subjectUserId, orgWideRoleId)).resolves.toBeTruthy();
  });
});

/**
 * The one relaxation, and its edges.
 *
 * An OWN grant reaches the grantee's own records and nothing else, so it is
 * not a delegation of the assigner's authority — and every employee baseline
 * is built from it. Without this, an HR administrator could not onboard a
 * salesperson without first being given lead permissions of their own.
 *
 * It is deliberately the narrowest exemption that keeps onboarding working:
 * only the "holds it at all" arm, and only at OWN.
 */
describe('an OWN grant is the floor, not a delegation', () => {
  it('allows a permission the assigner does not hold, at OWN', async () => {
    const starter = await prisma.role.create({
      data: { tenantId, key: `starter-${suffix}`, name: 'Starter', rank: 100, defaultScope: 'OWN' },
    });
    await grantPermissions(tenantId, starter.id, [['payroll', 'APPROVE']] as const, 'OWN');

    await expect(ceilingBreaches(branchScopedCtx, starter.id, 'OWN', null)).resolves.toEqual([]);
  });

  it('still refuses that same permission one step wider', async () => {
    const wider = await prisma.role.create({
      data: { tenantId, key: `wider-${suffix}`, name: 'Wider', rank: 100, defaultScope: 'TEAM' },
    });
    await grantPermissions(tenantId, wider.id, [['payroll', 'APPROVE']] as const, 'TEAM');

    const breaches = await ceilingBreaches(branchScopedCtx, wider.id, 'TEAM', null);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({ module: 'payroll', action: 'APPROVE', assignerHolds: 'NONE' });
  });
});
