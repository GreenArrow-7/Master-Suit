/**
 * Branch administration, which did not exist.
 *
 * A `Branch` row could be created only by the demo seed. There was no API and
 * no screen, so a workspace the seed had not touched could never fill the
 * "Branch / office" field on Add user — and could never use the BRANCH record
 * scope, which the role editor offers beside ORGANIZATION and TEAM and which
 * binds to exactly this set. A role granted it saw nothing, silently.
 *
 * The delete guard is here because archiving a branch somebody is posted to
 * leaves that person holding a BRANCH scope over a branch that is gone — the
 * same reasoning as the department guard it mirrors.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  DELETE as hrRetire,
  GET as hrRead,
  PATCH as hrEdit,
  POST as hrCreate,
} from '@/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { del, get, patch, post } from '../helpers/request';

const suffix = randomBytes(4).toString('hex');
const slug = `branches-${suffix}`;

let tenantId = '';
let adminCookie = '';
let roleId = '';

const at = { path: `/api/v1/workspaces/${slug}/hr/branches`, params: { workspaceSlug: slug, resource: 'branches' } };

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Branches LLC', displayName: 'Branches', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

  const role = await prisma.role.create({
    data: { tenantId, key: `hr-${suffix}`, name: 'HR', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  roleId = role.id;
  await grantPermissions(tenantId, role.id, [
    ['employee', 'VIEW'],
    ['employee', 'EDIT'],
    ['employee', 'CREATE'],
    ['employee', 'DELETE'],
  ] as const);
  const admin = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `hr-${suffix}@branches.test`,
    fullName: 'HR Admin',
  });
  adminCookie = await createSessionToken(tenantId, admin.id);
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('branch administration', () => {
  let branchId = '';

  it('creates a branch, upper-casing its code', async () => {
    const res = await post(hrCreate, at.path, { name: 'Business Bay', code: `bb${suffix}` }, adminCookie, at.params);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    branchId = res.body.id as string;
    expect(res.body.code).toBe(`BB${suffix}`.toUpperCase());
  });

  it('lists it, which is what Add user reads', async () => {
    const res = await get(hrRead, at.path, adminCookie, at.params);
    expect(res.status).toBe(200);
    const rows = (Array.isArray(res.body) ? res.body : (res.body.data ?? [])) as { id: string }[];
    expect(rows.map((row) => row.id)).toContain(branchId);
  });

  it('edits it', async () => {
    const res = await patch(hrEdit, `${at.path}?id=${branchId}`, { city: 'Dubai' }, adminCookie, at.params);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.city).toBe('Dubai');
  });

  it('refuses to archive a branch somebody is still posted to', async () => {
    const posted = await createWorkspaceUser({
      tenantId,
      roleId,
      email: `posted-${suffix}@branches.test`,
      fullName: 'Posted Person',
      branchId,
    });

    const refused = await del(hrRetire, `${at.path}?id=${branchId}`, adminCookie, at.params);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toMatch(/still posted/i);

    await prisma.user.updateMany({ where: { tenantId, id: posted.id }, data: { branchId: null } });
  });

  it('archives it once nobody is posted there, and it leaves the list', async () => {
    const res = await del(hrRetire, `${at.path}?id=${branchId}`, adminCookie, at.params);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const after = await get(hrRead, at.path, adminCookie, at.params);
    const rows = (Array.isArray(after.body) ? after.body : (after.body.data ?? [])) as { id: string }[];
    expect(rows.map((row) => row.id)).not.toContain(branchId);
  });
});
