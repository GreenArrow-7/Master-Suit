/**
 * HRMS-v21 §1 — effective permissions are the union of the primary role and
 * every ACTIVE, in-window role assignment, recomputed on every request.
 *
 * MembershipRole rows used to be bookkeeping: written by the assign flow,
 * read by nothing at request time, so an assigned role granted no actual
 * access. These tests drive a real guarded route with a real session and
 * prove the union, the effective window, revocation, the assignment-scope
 * cap, and the branch grant — each by observing what the API serves, not by
 * inspecting internals.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { GET as leadsList } from '@/app/api/v1/leads/route';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser } from '../helpers/fixtures';
import { get } from '../helpers/request';

const suffix = randomBytes(4).toString('hex');
const DAY = 86_400_000;
const yesterday = () => new Date(Date.now() - DAY);
const tomorrow = () => new Date(Date.now() + DAY);

let tenantId = '';
let bareUserId = '';
let bareCookie = '';
let viewerRoleId = '';
let branchA = '';
let branchB = '';

/** A role granting leads:VIEW at the given scope. */
async function roleGranting(label: string, scope: 'OWN' | 'BRANCH' | 'ORGANIZATION', rank = 10) {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank, defaultScope: scope },
  });
  const permission = await prisma.permission.upsert({
    where: { module_action: { module: 'leads', action: 'VIEW' } },
    update: {},
    create: { module: 'leads', action: 'VIEW' },
  });
  await prisma.rolePermission.create({
    data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope },
  });
  return role.id;
}

async function assign(
  roleId: string,
  overrides: Partial<{ scopeType: string; scopeId: string; effectiveFrom: Date; effectiveTo: Date; status: string }> = {},
) {
  const membership = await prisma.workspaceMembership.findFirstOrThrow({
    where: { tenantId, salesUserId: bareUserId },
  });
  return prisma.membershipRole.create({
    data: {
      tenantId,
      membershipId: membership.id,
      roleId,
      scopeType: overrides.scopeType ?? 'ORGANIZATION',
      scopeId: overrides.scopeId,
      effectiveFrom: overrides.effectiveFrom ?? null,
      effectiveTo: overrides.effectiveTo ?? null,
      status: overrides.status ?? 'ACTIVE',
    },
  });
}

const listLeads = () => get(leadsList, '/api/v1/leads', bareCookie);

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `roleasg-${suffix}`, legalName: 'RoleAsg LLC', displayName: 'RoleAsg', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const branchARow = await prisma.branch.create({ data: { tenantId, name: `A-${suffix}`, code: `A${suffix.slice(0, 4)}` } });
  const branchBRow = await prisma.branch.create({ data: { tenantId, name: `B-${suffix}`, code: `B${suffix.slice(0, 4)}` } });
  branchA = branchARow.id;
  branchB = branchBRow.id;

  // The subject: a primary role with NO permissions at all, homed in branch A.
  const bareRole = await prisma.role.create({
    data: { tenantId, key: `bare-${suffix}`, name: 'Bare', rank: 90, defaultScope: 'OWN' },
  });
  const bare = await createWorkspaceUser({
    tenantId,
    roleId: bareRole.id,
    email: `bare-${suffix}@roleasg.test`,
    fullName: 'Bare User',
    branchId: branchA,
  });
  bareUserId = bare.id;
  bareCookie = await createSessionToken(tenantId, bare.id);

  viewerRoleId = await roleGranting('viewer', 'ORGANIZATION');

  // Leads to observe through: one owned by the subject, one owned by a user in
  // branch B, one owned by nobody in particular elsewhere.
  const stage = await prisma.leadStage.create({
    data: { tenantId, key: `st-${suffix}`, name: 'New', category: 'OPEN', isDefault: true, position: 0 },
  });
  const colleagueRole = await prisma.role.create({
    data: { tenantId, key: `col-${suffix}`, name: 'Colleague', rank: 90, defaultScope: 'OWN' },
  });
  const colleagueB = await createWorkspaceUser({
    tenantId,
    roleId: colleagueRole.id,
    email: `colb-${suffix}@roleasg.test`,
    fullName: 'Branch B Colleague',
    branchId: branchB,
  });
  await prisma.lead.createMany({
    data: [
      { tenantId, reference: `RA-${suffix}-1`, fullName: 'Own Lead', stageId: stage.id, ownerId: bare.id },
      { tenantId, reference: `RA-${suffix}-2`, fullName: 'Branch B Lead', stageId: stage.id, ownerId: colleagueB.id },
    ],
  });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('role assignments as effective permissions', () => {
  it('with no assignment, the bare role is refused', async () => {
    expect((await listLeads()).status).toBe(403);
  });

  it('an active assignment grants its role on the very next request', async () => {
    const assignment = await assign(viewerRoleId);
    const res = await listLeads();
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);

    // Revocation takes effect on the next request too — no re-login involved.
    await prisma.membershipRole.update({
      where: { id: assignment.id, tenantId },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    expect((await listLeads()).status).toBe(403);
  });

  it('an assignment outside its effective window grants nothing', async () => {
    // One row per membership+role by design, so the window states are walked
    // on the same assignment: expired, then not-yet-started.
    const expired = await prisma.membershipRole.updateMany({
      where: { tenantId, roleId: viewerRoleId },
      data: { status: 'ACTIVE', effectiveFrom: null, effectiveTo: yesterday(), revokedAt: null },
    });
    expect(expired.count).toBe(1);
    expect((await listLeads()).status).toBe(403);

    await prisma.membershipRole.updateMany({
      where: { tenantId, roleId: viewerRoleId },
      data: { effectiveFrom: tomorrow(), effectiveTo: null },
    });
    expect((await listLeads()).status).toBe(403);

    await prisma.membershipRole.deleteMany({ where: { tenantId, roleId: viewerRoleId } });
  });

  it("the assignment's scope caps the role: an ORGANIZATION role assigned OWN_RECORD sees only own records", async () => {
    const assignment = await assign(viewerRoleId, { scopeType: 'OWN_RECORD' });
    const res = await listLeads();
    expect(res.status).toBe(200);
    expect(res.body.data.map((l: { fullName: string }) => l.fullName)).toEqual(['Own Lead']);
    await prisma.membershipRole.delete({ where: { id: assignment.id, tenantId } });
  });

  it('a BRANCH assignment naming another branch widens visibility to it', async () => {
    const branchViewer = await roleGranting('branch-viewer', 'BRANCH');
    const assignment = await assign(branchViewer, { scopeType: 'BRANCH', scopeId: branchB });
    const res = await listLeads();
    expect(res.status).toBe(200);
    const names = res.body.data.map((l: { fullName: string }) => l.fullName).sort();
    expect(names).toEqual(['Branch B Lead', 'Own Lead']);
    await prisma.membershipRole.delete({ where: { id: assignment.id, tenantId } });
  });
});
