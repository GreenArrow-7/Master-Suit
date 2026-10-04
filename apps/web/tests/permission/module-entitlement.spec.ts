/**
 * P1-7 — module entitlement must gate product modules, and nothing else.
 *
 * `api/handler.ts` used to assert `spec.productModule ?? 'SALES'`, so a route
 * that simply forgot to declare one demanded the Sales entitlement. Worse, the
 * identity and roles routes declared `'HRMS'`, which meant a Sales-only
 * customer could not add a second user, reset a password, or change their own —
 * the platform was unsellable on the Sales plan.
 *
 * User administration, role administration and self-service belong to no
 * product module. These tests pin that.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createWorkspaceUser } from '../helpers/fixtures';
import { GET as listUsers } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/[action]/route';
import { GET as listRoles } from '@/app/api/v1/workspaces/[workspaceSlug]/roles/[action]/route';
import { GET as selfStatus } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/self/[action]/route';
import { GET as hrRead } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route';
import { POST as hrAction } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/actions/[action]/route';
import { GET as salesLeads } from '@/app/api/v1/workspaces/[workspaceSlug]/sales/leads/route';
import { GET as leadsList } from '@/app/api/v1/leads/route';
import { GET as opportunitiesList } from '@/app/api/v1/opportunities/route';
import { createSessionToken } from '../helpers/session';
import { get, post } from '../helpers/request';
import type { Grants } from '../helpers/fixtures';

const suffix = randomBytes(4).toString('hex');

interface Workspace {
  slug: string;
  id: string;
  cookie: string;
  plainCookie: string;
}

/**
 * A workspace with exactly the modules given, an admin holding every permission
 * used below, and a plain member holding none.
 */
async function makeWorkspace(label: string, modules: ('HRMS' | 'SALES' | 'REAL_ESTATE')[]): Promise<Workspace> {
  const slug = `${label}-${suffix}`;
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: `${label} LLC`, displayName: label, status: 'ACTIVE' },
  });
  for (const productModule of modules) {
    await prisma.moduleEntitlement.create({ data: { tenantId: tenant.id, module: productModule, state: 'ACTIVE' } });
  }

  const adminRole = await prisma.role.create({
    data: { tenantId: tenant.id, key: `admin-${suffix}`, name: 'Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  const grants: Grants = [
    ['users', 'VIEW'],
    ['users', 'MANAGE_USERS'],
    ['roles', 'VIEW'],
    ['roles', 'MANAGE_CONFIGURATION'],
    ['employee', 'VIEW'],
    ['employee', 'EDIT'],
    ['leads', 'VIEW'],
    ['opportunities', 'VIEW'],
  ];
  for (const [permissionModule, action] of grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: permissionModule, action } },
      update: {},
      create: { module: permissionModule, action },
    });
    await prisma.rolePermission.create({
      data: {
        tenantId: tenant.id,
        roleId: adminRole.id,
        permissionId: permission.id,
        granted: true,
        scope: 'ORGANIZATION',
      },
    });
  }

  // Holds nothing at all — used to prove selfService needs no permission.
  const plainRole = await prisma.role.create({
    data: { tenantId: tenant.id, key: `plain-${suffix}`, name: 'Plain', rank: 100, defaultScope: 'OWN' },
  });

  const admin = await createWorkspaceUser({
    tenantId: tenant.id,
    roleId: adminRole.id,
    email: `admin@${slug}.test`,
    fullName: 'Admin',
  });
  const plain = await createWorkspaceUser({
    tenantId: tenant.id,
    roleId: plainRole.id,
    email: `plain@${slug}.test`,
    fullName: 'Plain',
  });

  return {
    slug,
    id: tenant.id,
    cookie: await createSessionToken(tenant.id, admin.id),
    plainCookie: await createSessionToken(tenant.id, plain.id),
  };
}

let hrOnly: Workspace;
let salesOnly: Workspace;
let both: Workspace;
let realtyOnly: Workspace;

beforeAll(async () => {
  hrOnly = await makeWorkspace('ent-hr', ['HRMS']);
  salesOnly = await makeWorkspace('ent-sales', ['SALES']);
  both = await makeWorkspace('ent-both', ['HRMS', 'SALES']);
  realtyOnly = await makeWorkspace('ent-realty', ['REAL_ESTATE']);
});

afterAll(async () => {
  for (const w of [hrOnly, salesOnly, both, realtyOnly]) {
    if (w?.id) await prisma.tenant.delete({ where: { id: w.id } }).catch(() => {});
  }
});

const hrPath = (w: Workspace) => `/api/v1/workspaces/${w.slug}/hr/departments`;
const hrParams = (w: Workspace) => ({ workspaceSlug: w.slug, resource: 'departments' });
const salesPath = (w: Workspace) => `/api/v1/workspaces/${w.slug}/sales/leads`;

describe('product modules are gated by entitlement', () => {
  it('an HRMS-only workspace cannot reach Sales APIs', async () => {
    const res = await get(salesLeads, salesPath(hrOnly), hrOnly.cookie, { workspaceSlug: hrOnly.slug });
    expect(res.status).toBe(403);
  });

  it('a Sales-only workspace cannot reach HRMS APIs', async () => {
    const res = await get(hrRead, hrPath(salesOnly), salesOnly.cookie, hrParams(salesOnly));
    expect(res.status).toBe(403);
  });

  it('a workspace with both reaches both', async () => {
    const hr = await get(hrRead, hrPath(both), both.cookie, hrParams(both));
    const sales = await get(salesLeads, salesPath(both), both.cookie, { workspaceSlug: both.slug });
    expect(hr.status).toBe(200);
    expect(sales.status).toBe(200);
  });
});

describe('check-in setup is open to every workspace; the rest of HR is not', () => {
  const action = (w: Workspace, name: string, body: Record<string, unknown>) =>
    post(hrAction, `/api/v1/workspaces/${w.slug}/hr/actions/${name}`, body, w.cookie, {
      workspaceSlug: w.slug,
      action: name,
    });

  it('a Sales-only workspace reads its work locations', async () => {
    const res = await get(hrRead, `/api/v1/workspaces/${salesOnly.slug}/hr/work-locations`, salesOnly.cookie, {
      workspaceSlug: salesOnly.slug,
      resource: 'work-locations',
    });
    expect(res.status).toBe(200);
  });

  it('a Sales-only workspace sets the check-out rules, and only those', async () => {
    const res = await action(salesOnly, 'settings-update', { checkoutRequiresLeadWork: true, faceMatchThreshold: 0.5 });
    expect(res.status).toBe(200);
    const stored = await prisma.organizationSetting.findUnique({
      where: { tenantId: salesOnly.id },
      select: { hrPolicy: true },
    });
    expect(stored?.hrPolicy).toEqual({ checkoutRequiresLeadWork: true });
  });

  it('a Sales-only workspace is still refused every other HR action', async () => {
    const res = await action(salesOnly, 'leave-apply', {});
    expect(res.status).toBe(403);
  });
});

describe('Real Estate reaches the registers it shares with Sales, and nothing else of Sales', () => {
  // The Real Estate screens are the Sales screens, and they write through these
  // APIs. When the APIs asserted Sales alone, a workspace that bought only Real
  // Estate saw every screen render and every action on it refused.
  it('a Real-Estate-only workspace reads the shared lead register', async () => {
    const res = await get(leadsList, '/api/v1/leads', realtyOnly.cookie);
    expect(res.status).toBe(200);
  });

  it('a Real-Estate-only workspace is refused a Sales-only register', async () => {
    // The admin holds `opportunities:VIEW`, so the refusal is the entitlement's.
    const res = await get(opportunitiesList, '/api/v1/opportunities', realtyOnly.cookie);
    expect(res.status).toBe(403);
  });

  it('an HRMS-only workspace is still refused the shared register', async () => {
    const res = await get(leadsList, '/api/v1/leads', hrOnly.cookie);
    expect(res.status).toBe(403);
  });
});

describe('platform capabilities are not gated by a product module', () => {
  // The whole point of P1-7: these must work on every plan.
  it.each([
    ['HRMS-only', () => hrOnly],
    ['Sales-only', () => salesOnly],
  ])('%s can list users', async (_label, workspace) => {
    const w = workspace();
    const res = await get(listUsers, `/api/v1/workspaces/${w.slug}/identity/accounts`, w.cookie, {
      workspaceSlug: w.slug,
      action: 'accounts',
    });
    expect(res.status).toBe(200);
  });

  it.each([
    ['HRMS-only', () => hrOnly],
    ['Sales-only', () => salesOnly],
  ])('%s can list roles', async (_label, workspace) => {
    const w = workspace();
    const res = await get(listRoles, `/api/v1/workspaces/${w.slug}/roles/roles`, w.cookie, {
      workspaceSlug: w.slug,
      action: 'roles',
    });
    expect(res.status).toBe(200);
  });

  it.each([
    ['HRMS-only', () => hrOnly],
    ['Sales-only', () => salesOnly],
  ])(
    '%s: a member holding no permission at all can still read their own password status',
    async (_label, workspace) => {
      const w = workspace();
      const res = await get(selfStatus, `/api/v1/workspaces/${w.slug}/identity/self/password-status`, w.plainCookie, {
        workspaceSlug: w.slug,
        action: 'password-status',
      });
      expect(res.status).toBe(200);
    },
  );
});

describe('a suspended workspace loses every module', () => {
  it('refuses a workspace whose status is not ACTIVE', async () => {
    await prisma.tenant.update({ where: { id: both.id }, data: { status: 'SUSPENDED' } });
    try {
      const hr = await get(hrRead, hrPath(both), both.cookie, hrParams(both));
      const sales = await get(salesLeads, salesPath(both), both.cookie, { workspaceSlug: both.slug });
      expect(hr.status).toBeGreaterThanOrEqual(400);
      expect(sales.status).toBeGreaterThanOrEqual(400);
    } finally {
      await prisma.tenant.update({ where: { id: both.id }, data: { status: 'ACTIVE' } });
    }
  });
});
