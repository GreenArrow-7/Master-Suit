/**
 * What an administrator may grant, and what caps it.
 *
 * Every path that gives somebody a role checks **rank**: you may not grant a
 * role at or above your own level. `assignRole` → `assertMayGrantRole`
 * (`roles.ts:40`), `changeUserRole` (`accounts.ts:698`), invitations
 * (`invitations.ts:78`).
 *
 * **Nothing checks scope**, and rank and scope are orthogonal: a low-ranked
 * role can carry ORGANIZATION-scoped permission rows. So an administrator whose
 * own authority is narrow can hand out a role that reaches the whole workspace.
 *
 * These are characterisation tests. They record what the system does today so
 * that it cannot change by accident while the question below is open — they are
 * not an endorsement of it.
 *
 * ── The open question ───────────────────────────────────────────────────────
 *
 * Should an assigner's own scope cap what they may grant?
 *
 * It is not obviously a bug. Roles are defined by whoever administers the
 * workspace; a branch manager assigning an existing "Sales Agent" role is using
 * a role somebody senior designed. Capping it would stop a branch manager
 * onboarding an agent who legitimately needs a workspace-wide read.
 *
 * It is also not obviously safe: it is the one way an administrator can confer
 * reach they do not themselves have. Answering it is a business decision, so
 * this file states the behaviour precisely and leaves it unchanged.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assignRole } from '@/services/identity/roles';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import type { Actor, Ctx } from '@/lib/security/rbac';

const suffix = randomBytes(4).toString('hex');
const slug = `ceiling-${suffix}`;

let tenantId = '';
let branchScopedCtx: Ctx;
let membershipId = '';
let orgWideRoleId = '';
let seniorRoleId = '';

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

describe('scope is NOT enforced — recorded, not endorsed', () => {
  it('a branch-scoped administrator may assign at ORGANIZATION by omitting the scope', async () => {
    await clear();
    const assignment = await assignRole(branchScopedCtx, { membershipId, roleId: orgWideRoleId });

    // The assigner administers roles at BRANCH. The assignment they just made
    // applies workspace-wide, because omitting the scope takes the column
    // default and nothing compares it against the assigner's own reach.
    expect(assignment.scopeType).toBe('ORGANIZATION');
  });

  it('and may do so explicitly, too', async () => {
    await clear();
    const assignment = await assignRole(branchScopedCtx, {
      membershipId,
      roleId: orgWideRoleId,
      scopeType: 'ORGANIZATION',
    });
    expect(assignment.scopeType).toBe('ORGANIZATION');
  });

  it('so omitting the scope is not itself the escalation — the missing ceiling is', async () => {
    // Worth stating plainly: closing the omitted-scope path alone would change
    // nothing, because the explicit path is open as well. A fix has to be a
    // ceiling, not a default.
    await clear();
    const implicit = await assignRole(branchScopedCtx, { membershipId, roleId: orgWideRoleId });
    const implicitScope = implicit.scopeType;
    await clear();
    const explicit = await assignRole(branchScopedCtx, {
      membershipId,
      roleId: orgWideRoleId,
      scopeType: 'ORGANIZATION',
    });
    expect(implicitScope).toBe(explicit.scopeType);
  });
});
