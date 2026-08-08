/**
 * 4.5 — the HR module was create-only.
 *
 *   grep "export const PATCH|export const DELETE" src/app/api/v1/workspaces  →  0
 *
 * A department created with a typo stayed misspelt forever, a public holiday
 * entered on the wrong date could not be corrected, a leave type could not be
 * retired, and an employee who left could not be archived. Everything below is
 * a verb that did not exist.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  GET as hrRead,
  POST as hrCreate,
  PATCH as hrUpdate,
  DELETE as hrArchive,
} from '@/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser } from '../helpers/fixtures';
import { get, post, patch, del } from '../helpers/request';
import type { VisibilityScope } from '@prisma/client';
import type { Grants } from '../helpers/fixtures';

const suffix = randomBytes(4).toString('hex');
const slug = `verbs-${suffix}`;

let tenantId = '';
let adminCookie = '';
let plainCookie = '';

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
    email: `${label}-${suffix}@verbs.test`,
    fullName: label,
  });
  return createSessionToken(tenantId, user.id);
}

const at = (resource: string, id?: string) => ({
  path: `/api/v1/workspaces/${slug}/hr/${resource}${id ? `?id=${id}` : ''}`,
  params: { workspaceSlug: slug, resource },
});

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Verbs LLC', displayName: 'Verbs', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

  adminCookie = await member(
    'hradmin',
    [
      ['employee', 'VIEW'],
      ['employee', 'CREATE'],
      ['employee', 'EDIT'],
      ['employee', 'DELETE'],
    ],
    'ORGANIZATION',
  );
  plainCookie = await member(
    'plain',
    [
      ['employee', 'VIEW'],
      ['employee', 'EDIT'],
      ['employee', 'DELETE'],
    ],
    'OWN',
  );
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('departments', () => {
  it('can be renamed after creation', async () => {
    const created = await post(
      hrCreate,
      at('departments').path,
      { name: 'Sals', code: 'SLS' },
      adminCookie,
      at('departments').params,
    );
    expect(created.status).toBe(200);

    const renamed = await patch(
      hrUpdate,
      at('departments', created.body.id).path,
      { name: 'Sales' },
      adminCookie,
      at('departments').params,
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Sales');
  });

  it('refuses to archive one that still has employees', async () => {
    const dept = await post(
      hrCreate,
      at('departments').path,
      { name: 'Staffed', code: `ST${suffix.slice(0, 3)}` },
      adminCookie,
      at('departments').params,
    );
    const membershipHolder = await prisma.platformUser.create({
      data: {
        email: `dh-${suffix}@verbs.test`,
        normalizedEmail: `dh-${suffix}@verbs.test`,
        fullName: 'DH',
        status: 'ACTIVE',
      },
    });
    const membership = await prisma.workspaceMembership.create({
      data: { tenantId, platformUserId: membershipHolder.id, status: 'ACTIVE', joinedAt: new Date() },
    });
    await prisma.employeeProfile.create({
      data: {
        tenantId,
        membershipId: membership.id,
        employeeNumber: `DH-${suffix}`,
        departmentId: dept.body.id,
        employmentStatus: 'ACTIVE',
      },
    });

    const refused = await del(hrArchive, at('departments', dept.body.id).path, adminCookie, at('departments').params);
    expect(refused.status).toBe(409);
    // Still there, not half-deleted.
    expect(
      await prisma.department.findFirst({ where: { tenantId, id: dept.body.id, deletedAt: null } }),
    ).not.toBeNull();
  });

  it('archives an empty one, and the list stops showing it', async () => {
    const dept = await post(
      hrCreate,
      at('departments').path,
      { name: 'Empty', code: `EM${suffix.slice(0, 3)}` },
      adminCookie,
      at('departments').params,
    );
    const archived = await del(hrArchive, at('departments', dept.body.id).path, adminCookie, at('departments').params);
    expect(archived.status).toBe(200);

    const list = await get(hrRead, at('departments').path, adminCookie, at('departments').params);
    expect(list.body.map((row: { id: string }) => row.id)).not.toContain(dept.body.id);
  });
});

describe('holidays', () => {
  it('can be corrected — the common case is the wrong date', async () => {
    const created = await post(
      hrCreate,
      at('holidays').path,
      { name: 'National Day', holidayDate: '2026-12-01' },
      adminCookie,
      at('holidays').params,
    );
    expect(created.status).toBe(200);

    const fixed = await patch(
      hrUpdate,
      at('holidays', created.body.id).path,
      { holidayDate: '2026-12-02' },
      adminCookie,
      at('holidays').params,
    );
    expect(fixed.status).toBe(200);
    expect(new Date(fixed.body.holidayDate).toISOString()).toContain('2026-12-02');
  });

  it('is really removed, not tombstoned — nothing references it', async () => {
    const created = await post(
      hrCreate,
      at('holidays').path,
      { name: 'Mistake', holidayDate: '2026-11-11' },
      adminCookie,
      at('holidays').params,
    );
    await del(hrArchive, at('holidays', created.body.id).path, adminCookie, at('holidays').params);
    expect(await prisma.hrHoliday.findFirst({ where: { tenantId, id: created.body.id } })).toBeNull();
  });
});

describe('shifts and work locations are deactivated, not deleted', () => {
  it('a shift is flagged inactive so attendance history survives', async () => {
    const created = await post(
      hrCreate,
      at('shifts').path,
      { name: 'Night', code: `N${suffix.slice(0, 3)}`, startTime: '22:00', endTime: '06:00' },
      adminCookie,
      at('shifts').params,
    );
    expect(created.status).toBe(200);

    await del(hrArchive, at('shifts', created.body.id).path, adminCookie, at('shifts').params);
    const row = await prisma.hrShift.findFirst({ where: { tenantId, id: created.body.id } });
    expect(row).not.toBeNull();
    expect(row!.isActive).toBe(false);
  });

  it('a work location is retired', async () => {
    const created = await post(
      hrCreate,
      at('work-locations').path,
      { name: 'Old Office', latitude: 25.2, longitude: 55.3, radiusMeters: 100 },
      adminCookie,
      at('work-locations').params,
    );
    expect(created.status).toBe(200);

    await del(hrArchive, at('work-locations', created.body.id).path, adminCookie, at('work-locations').params);
    const row = await prisma.hrWorkLocation.findFirst({ where: { tenantId, id: created.body.id } });
    expect(row!.status).toBe('RETIRED');
  });
});

describe('designations — the model existed with no endpoint at all', () => {
  it('can be created, listed, renamed and archived', async () => {
    const created = await post(
      hrCreate,
      at('designations').path,
      { name: 'Consutant', code: `C${suffix.slice(0, 3)}` },
      adminCookie,
      at('designations').params,
    );
    expect(created.status).toBe(200);

    const renamed = await patch(
      hrUpdate,
      at('designations', created.body.id).path,
      { name: 'Consultant' },
      adminCookie,
      at('designations').params,
    );
    expect(renamed.body.name).toBe('Consultant');

    const listed = await get(hrRead, at('designations').path, adminCookie, at('designations').params);
    expect(listed.body.map((row: { id: string }) => row.id)).toContain(created.body.id);

    await del(hrArchive, at('designations', created.body.id).path, adminCookie, at('designations').params);
    const after = await get(hrRead, at('designations').path, adminCookie, at('designations').params);
    expect(after.body.map((row: { id: string }) => row.id)).not.toContain(created.body.id);
  });
});

describe('the new verbs are gated', () => {
  it('an actor without ORGANIZATION scope cannot edit HR records', async () => {
    const dept = await post(
      hrCreate,
      at('departments').path,
      { name: 'Guarded', code: `G${suffix.slice(0, 3)}` },
      adminCookie,
      at('departments').params,
    );

    const refused = await patch(
      hrUpdate,
      at('departments', dept.body.id).path,
      { name: 'Hijacked' },
      plainCookie,
      at('departments').params,
    );
    expect(refused.status).toBe(403);

    const unchanged = await prisma.department.findFirst({ where: { tenantId, id: dept.body.id } });
    expect(unchanged!.name).toBe('Guarded');
  });

  it('refuses a record belonging to another workspace', async () => {
    const other = await prisma.tenant.create({
      data: { slug: `other-${suffix}`, legalName: 'Other', displayName: 'Other', status: 'ACTIVE' },
    });
    try {
      const foreign = await prisma.department.create({
        data: { tenantId: other.id, name: 'Theirs', code: `TH${suffix.slice(0, 3)}` },
      });
      const res = await patch(
        hrUpdate,
        at('departments', foreign.id).path,
        { name: 'Reached' },
        adminCookie,
        at('departments').params,
      );
      expect(res.status).toBe(404);
      expect((await prisma.department.findFirst({ where: { tenantId: other.id, id: foreign.id } }))!.name).toBe(
        'Theirs',
      );
    } finally {
      await prisma.tenant.delete({ where: { id: other.id } }).catch(() => {});
    }
  });

  it('refuses a resource that has no update path rather than silently doing nothing', async () => {
    const res = await patch(
      hrUpdate,
      at('attendance', 'whatever').path,
      { status: 'PRESENT' },
      adminCookie,
      at('attendance').params,
    );
    expect(res.status).toBe(404);
  });
});
