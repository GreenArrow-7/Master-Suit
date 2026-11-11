/**
 * An assignment's scope cannot be widened by getting it wrong.
 *
 * `MembershipRole.scopeType` is a `String` column, so nothing in the database
 * constrains it. The API validated it as `z.string().max(40)` and the resolver
 * mapped anything it did not recognise to `ORGANIZATION` — the column's
 * default. The result: `BRACNH` was accepted, stored, and conferred the role's
 * scopes **unnarrowed at workspace level**. A typo widened access silently, in
 * the one place where silence is least affordable.
 *
 * Each case here fails on the old behaviour. That was checked by reverting the
 * three enforcement points and watching them go red, not assumed.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assignRole } from '@/services/identity/roles';
import { scopeCapFor } from '@/lib/security/assignmentScope';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import type { Ctx } from '@/lib/security/rbac';

const suffix = randomBytes(4).toString('hex');
const slug = `assignscope-${suffix}`;

let tenantId = '';
let otherTenantId = '';
let ctx: Ctx;
let membershipId = '';
let roleId = '';
let branchId = '';
let otherBranchId = '';

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'AssignScope LLC', displayName: 'AssignScope', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  const other = await prisma.tenant.create({
    data: { slug: `${slug}-other`, legalName: 'Other LLC', displayName: 'Other', status: 'ACTIVE' },
  });
  otherTenantId = other.id;

  const admin = await prisma.role.create({
    data: { tenantId, key: `admin-${suffix}`, name: 'Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, admin.id, [
    ['users', 'MANAGE_USERS'],
    ['roles', 'MANAGE_CONFIGURATION'],
  ] as const);

  const assignable = await prisma.role.create({
    data: { tenantId, key: `rep-${suffix}`, name: 'Rep', rank: 60, defaultScope: 'ORGANIZATION' },
  });
  roleId = assignable.id;

  const actor = await createWorkspaceUser({
    tenantId,
    roleId: admin.id,
    email: `admin-${suffix}@assign.test`,
    fullName: 'Admin',
  });
  ctx = buildCtx(
    buildActor({
      id: actor.id,
      tenantId,
      roleId: admin.id,
      roleRank: 10,
      grants: [
        ['users', 'MANAGE_USERS'],
        ['roles', 'MANAGE_CONFIGURATION'],
      ] as const,
    }),
  );

  const subject = await createWorkspaceUser({
    tenantId,
    roleId: assignable.id,
    email: `subject-${suffix}@assign.test`,
    fullName: 'Subject',
  });
  membershipId = subject.membershipId;

  const branch = await prisma.branch.create({ data: { tenantId, name: 'Marina', code: `MAR${suffix}` } });
  branchId = branch.id;
  const elsewhere = await prisma.branch.create({
    data: { tenantId: otherTenantId, name: 'Elsewhere', code: `ELS${suffix}` },
  });
  otherBranchId = elsewhere.id;
});

afterAll(async () => {
  for (const id of [tenantId, otherTenantId]) {
    if (id) await prisma.tenant.delete({ where: { id } }).catch(() => {});
  }
});

/** Clear the assignment between cases: it is unique per (membership, role). */
const clearAssignment = () => prisma.membershipRole.deleteMany({ where: { tenantId, membershipId, roleId } });

describe('an assignment scope must be one we recognise', () => {
  it('refuses a misspelt scope instead of reading it as ORGANIZATION', async () => {
    await clearAssignment();
    await expect(
      assignRole(ctx, { membershipId, roleId, scopeType: 'BRACNH', scopeId: branchId }),
    ).rejects.toMatchObject({
      errors: expect.arrayContaining([expect.objectContaining({ field: 'scopeType', code: 'unknown_scope' })]),
    });
    expect(await prisma.membershipRole.count({ where: { tenantId, membershipId, roleId } })).toBe(0);
  });

  it('refuses a lower-case scope, which is a different string', async () => {
    await clearAssignment();
    await expect(assignRole(ctx, { membershipId, roleId, scopeType: 'branch', scopeId: branchId })).rejects.toThrow();
  });

  it('accepts the scopes it documents', async () => {
    for (const scope of ['ORGANIZATION', 'OWN'] as const) {
      await clearAssignment();
      const assignment = await assignRole(ctx, { membershipId, roleId, scopeType: scope });
      expect(assignment.scopeType).toBe(scope);
    }
  });

  it('still defaults to ORGANIZATION when no scope is given', async () => {
    // The three other writers of this column omit it on purpose. Failing closed
    // on an omitted scope would break account creation and invitations.
    await clearAssignment();
    const assignment = await assignRole(ctx, { membershipId, roleId });
    expect(assignment.scopeType).toBe('ORGANIZATION');
  });
});

describe('a scope that names a record must name a real one, here', () => {
  it('refuses BRANCH with no branch', async () => {
    await clearAssignment();
    await expect(assignRole(ctx, { membershipId, roleId, scopeType: 'BRANCH' })).rejects.toMatchObject({
      errors: expect.arrayContaining([expect.objectContaining({ field: 'scopeId', code: 'required' })]),
    });
  });

  it("refuses another workspace's branch", async () => {
    await clearAssignment();
    await expect(
      assignRole(ctx, { membershipId, roleId, scopeType: 'BRANCH', scopeId: otherBranchId }),
    ).rejects.toThrow(/branch/i);
    expect(await prisma.membershipRole.count({ where: { tenantId, membershipId, roleId } })).toBe(0);
  });

  it('accepts a branch of this workspace', async () => {
    await clearAssignment();
    const assignment = await assignRole(ctx, { membershipId, roleId, scopeType: 'BRANCH', scopeId: branchId });
    expect(assignment.scopeType).toBe('BRANCH');
    expect(assignment.scopeId).toBe(branchId);
  });

  it('refuses a record id on a scope that names none', async () => {
    await clearAssignment();
    await expect(
      assignRole(ctx, { membershipId, roleId, scopeType: 'ORGANIZATION', scopeId: branchId }),
    ).rejects.toMatchObject({
      errors: expect.arrayContaining([expect.objectContaining({ field: 'scopeId', code: 'not_applicable' })]),
    });
  });
});

describe('re-assigning a revoked role takes the new scope', () => {
  it('does not keep the scope it had before', async () => {
    await clearAssignment();
    await assignRole(ctx, { membershipId, roleId, scopeType: 'BRANCH', scopeId: branchId });
    await prisma.membershipRole.updateMany({
      where: { tenantId, membershipId, roleId },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    const again = await assignRole(ctx, { membershipId, roleId, scopeType: 'OWN' });
    // The update branch used to set status and dates and leave scopeType alone,
    // so this came back BRANCH — wider than what was asked for.
    expect(again.scopeType).toBe('OWN');
    expect(again.scopeId).toBeNull();
  });
});

describe('the resolver fails closed', () => {
  it('treats an unrecognised stored scope as granting nothing', () => {
    // The row can only exist from before this rule, or from a direct write.
    // Whatever put it there, it must not read as workspace-wide.
    expect(scopeCapFor('BRACNH')).toBeNull();
    expect(scopeCapFor('')).toBeNull();
    expect(scopeCapFor('ORGANIZATION')).toBe('ORGANIZATION');
    expect(scopeCapFor('DEPARTMENT')).toBe('TEAM');
  });
});
