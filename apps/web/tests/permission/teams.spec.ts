import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { ctxForUser } from '@/lib/auth/session';
import { resolveOwnerIds } from '@/lib/security/visibility';
import { GET as listTeams, POST as createTeam } from '@/app/api/v1/teams/route';
import { PATCH as editTeam } from '@/app/api/v1/teams/[id]/route';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { get, patch, post } from '../helpers/request';

// Audit M1-11: an administrator forms a team, and TEAM scope then binds to it.
const suffix = randomBytes(4).toString('hex');
let tenantId = '';
let adminCookie = '';
let viewerCookie = '';
const people: Record<string, string> = {};

beforeAll(async () => {
  tenantId = (
    await prisma.tenant.create({
      data: { slug: `teams-${suffix}`, legalName: 'Teams LLC', displayName: 'Teams', status: 'ACTIVE' },
    })
  ).id;
  const adminRole = await prisma.role.create({
    data: { tenantId, key: `admin-${suffix}`, name: 'Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, adminRole.id, [
    ['users', 'VIEW'],
    ['users', 'MANAGE_USERS'],
  ]);
  const teamRole = await prisma.role.create({
    data: { tenantId, key: `lead-${suffix}`, name: 'Team lead', rank: 40, defaultScope: 'TEAM' },
  });
  await grantPermissions(tenantId, teamRole.id, [['users', 'VIEW']]);
  const admin = await createWorkspaceUser({
    tenantId,
    roleId: adminRole.id,
    email: `a@t-${suffix}.test`,
    fullName: 'Admin',
  });
  for (const name of ['manager', 'member', 'outsider']) {
    people[name] = (
      await createWorkspaceUser({ tenantId, roleId: teamRole.id, email: `${name}@t-${suffix}.test`, fullName: name })
    ).id;
  }
  adminCookie = await createSessionToken(tenantId, admin.id);
  viewerCookie = await createSessionToken(tenantId, people.member!);
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

it('creates a team with a manager and a member; the manager then sees the member at TEAM scope', async () => {
  const created = await post(
    createTeam,
    '/api/v1/teams',
    { name: 'Marina team', managerId: people.manager, memberIds: [people.member] },
    adminCookie,
  );
  expect(created.status).toBe(200);
  const ctx = await ctxForUser(people.manager!, tenantId, 'teams-spec');
  const seen = await resolveOwnerIds(ctx, 'TEAM');
  expect(seen).toContain(people.member);
  expect(seen).not.toContain(people.outsider);

  // Editing replaces the members.
  const edited = await patch(
    editTeam,
    `/api/v1/teams/${created.body.id}`,
    { memberIds: [people.outsider] },
    adminCookie,
    { id: created.body.id },
  );
  expect(edited.status).toBe(200);
  const after = await resolveOwnerIds(await ctxForUser(people.manager!, tenantId, 'teams-spec-2'), 'TEAM');
  expect(after).toContain(people.outsider);
  expect(after).not.toContain(people.member);
});

it('lists for users:VIEW and refuses creation without users:MANAGE_USERS', async () => {
  expect((await get(listTeams, '/api/v1/teams', viewerCookie)).status).toBe(200);
  expect((await post(createTeam, '/api/v1/teams', { name: 'Mine' }, viewerCookie)).status).toBe(403);
});
