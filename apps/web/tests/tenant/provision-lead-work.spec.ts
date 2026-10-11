import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Admin > Roles reads the session from the request's cookie, set per case.
const cookieJar = vi.hoisted(() => ({ value: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: cookieJar.value, 'x-pathname': '/' }),
  cookies: async () => ({ get: () => undefined }),
}));

import { prisma, withPlatformTx } from '@/lib/db';
import { provisionLeadWork } from '@/services/platform/provisioning';
import { POST as wizardCreate } from '@/app/api/v1/platform/workspaces/route';
import { PATCH as editWorkspace } from '@/app/api/v1/platform/workspaces/[workspaceId]/route';
import { PATCH as editSubscription } from '@/app/api/v1/platform/subscriptions/[subscriptionId]/route';
import { GET as rolesApi } from '@/app/api/v1/workspaces/[workspaceSlug]/roles/[action]/route';
import RolesPage from '@/app/(workspace)/[workspaceSlug]/admin/roles/page';
import { GET as leadsList, POST as leadCreate } from '@/app/api/v1/leads/route';
import { GET as leadsExport } from '@/app/api/v1/leads/export/route';
import { GET as followUps } from '@/app/api/v1/follow-ups/route';
import { GET as calls } from '@/app/api/v1/calls/route';
import { GET as siteVisits } from '@/app/api/v1/site-visits/route';
import { GET as requirements } from '@/app/api/v1/requirements/route';
import { GET as allocation } from '@/app/api/v1/allocation/route';
import { GET as projects } from '@/app/api/v1/projects/route';
import { GET as listings } from '@/app/api/v1/listings/route';
import { GET as reports } from '@/app/api/v1/reports/route';
import { GET as visitGet, PATCH as visitChange } from '@/app/api/v1/site-visits/[id]/route';
import { POST as visitPunch } from '@/app/api/v1/site-visits/[id]/punch/route';
import { ctxForUser } from '@/lib/auth/session';
import { leaderQueues } from '@/services/visits/lifecycle';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { get, patch, post } from '../helpers/request';
import { createPlatformSessionToken, createSessionToken } from '../helpers/session';

/**
 * The starting lists a workspace needs before it can take a lead — for every
 * module that works leads, not Sales alone (a Real-Estate-only or
 * Lead-Eagle-only workspace from the wizard could not create its first lead) —
 * and never a reset of a workspace that has made its own.
 */
const suffix = randomBytes(4).toString('hex');
const tenantIds: string[] = [];

async function workspace(label: string) {
  const tenant = await prisma.tenant.create({
    data: { slug: `prov-${label}-${suffix}`, legalName: `${label} LLC`, displayName: label, status: 'ACTIVE' },
  });
  tenantIds.push(tenant.id);
  return tenant.id;
}

const counts = async (tenantId: string) => ({
  stages: await prisma.leadStage.count({ where: { tenantId } }),
  activityTypes: await prisma.activityType.count({ where: { tenantId } }),
  taskTypes: await prisma.taskType.count({ where: { tenantId } }),
});

let fresh = '';
let customised = '';

beforeAll(async () => {
  fresh = await workspace('fresh');
  customised = await workspace('custom');
  await prisma.leadStage.create({ data: { tenantId: customised, key: 'enquiry', name: 'Enquiry', position: 1 } });
});

afterAll(async () => {
  for (const id of tenantIds) await prisma.tenant.delete({ where: { id } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { endsWith: `${suffix}@prov.test` } } });
  await prisma.subscriptionPlan.deleteMany({ where: { code: { startsWith: 'prov-', endsWith: suffix } } });
});

describe('provisionLeadWork', () => {
  it('gives a new workspace its stages, activity types and task types, with a default stage', async () => {
    await withPlatformTx((tx) => provisionLeadWork(tx, fresh, ['SALES']));
    expect(await counts(fresh)).toEqual({ stages: 4, activityTypes: 6, taskTypes: 4 });
    expect(await prisma.leadStage.count({ where: { tenantId: fresh, isDefault: true } })).toBe(1);
  });

  it('adds nothing the second time', async () => {
    await withPlatformTx((tx) => provisionLeadWork(tx, fresh, ['SALES']));
    expect(await counts(fresh)).toEqual({ stages: 4, activityTypes: 6, taskTypes: 4 });
  });

  it('leaves a workspace’s own stages alone, and still fills what is empty', async () => {
    await withPlatformTx((tx) => provisionLeadWork(tx, customised, ['SALES']));
    expect(await counts(customised)).toEqual({ stages: 1, activityTypes: 6, taskTypes: 4 });
  });
});

/**
 * Lead Eagle's starter roles (M2-03): a workspace that gets Lead Eagle — from
 * the wizard, from sign-up (self-serve-signup.spec), from the console's editor
 * or from a plan change — lists five editable roles beside the Company
 * Administrator. Never a second role under a name the workspace already uses,
 * never an administrator's edit undone, and a console save that leaves Lead
 * Eagle on neither brings back a role they deleted nor backfills a workspace.
 */
describe('the Lead Eagle starter roles', () => {
  const ADMIN_ROLES = [
    { name: 'Company Administrator', defaultScope: 'ORGANIZATION', isSystem: true },
    { name: 'Manager', defaultScope: 'ORGANIZATION', isSystem: false },
    { name: 'Team Lead', defaultScope: 'TEAM', isSystem: false },
    { name: 'Agent', defaultScope: 'OWN', isSystem: false },
    { name: 'Telecaller', defaultScope: 'OWN', isSystem: false },
    { name: 'Viewer', defaultScope: 'ORGANIZATION', isSystem: false },
  ];
  const STARTER = ['Manager', 'Team Lead', 'Agent', 'Telecaller', 'Viewer'];
  let ownerCookie = '';
  let planCode = '';
  let hrPlanCode = '';
  let wizardMade = '';

  /** Admin > Roles, as the workspace's first administrator sees it. */
  async function adminRoles(tenantId: string) {
    const { slug } = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const admin = await prisma.user.findFirstOrThrow({ where: { tenantId, role: { key: 'company_admin' } } });
    const res = await get(
      rolesApi,
      `/api/v1/workspaces/${slug}/roles/roles`,
      await createSessionToken(tenantId, admin.id),
      {
        workspaceSlug: slug,
        action: 'roles',
      },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as { name: string; defaultScope: string; isSystem: boolean; editable: boolean }[];
  }
  const names = async (tenantId: string) =>
    (await prisma.role.findMany({ where: { tenantId }, orderBy: { rank: 'asc' }, select: { name: true } })).map(
      (role) => role.name,
    );
  /** One role's grants, `module:ACTION` → scope. */
  async function grants(tenantId: string, name: string) {
    const rows = await prisma.rolePermission.findMany({
      where: { tenantId, role: { name } },
      include: { permission: true },
    });
    return new Map(rows.map((row) => [`${row.permission.module}:${row.permission.action}`, row.scope]));
  }

  async function wizard(label: string, enabledModules: string[]) {
    const slug = `prov-w-${label}-${suffix}`;
    const res = await post(
      wizardCreate,
      '/api/v1/platform/workspaces',
      {
        workspaceName: label,
        slug,
        legalName: `${label} LLC`,
        displayName: label,
        planCode,
        primaryAdminName: 'First Admin',
        primaryAdminEmail: `admin.${label}.${suffix}@prov.test`,
        primaryAdminPassword: 'Provisioned-Pass-2026!',
        enabledModules,
        maxEmployees: 10,
        maxUsers: 10,
        maxStorageMb: 512,
      },
      ownerCookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    tenantIds.push(res.body.workspace.id);
    return res.body.workspace.id as string;
  }

  const save = (id: string, body: Record<string, unknown>) =>
    patch(editWorkspace, `/api/v1/platform/workspaces/${id}`, body, ownerCookie, { workspaceId: id });

  beforeAll(async () => {
    const owner = await prisma.platformUser.create({
      data: {
        email: `prov.owner.${suffix}@prov.test`,
        normalizedEmail: `prov.owner.${suffix}@prov.test`,
        fullName: 'Provisioning Owner',
        passwordHash: 'x',
        status: 'ACTIVE',
        platformRole: 'OWNER',
      },
    });
    ownerCookie = await createPlatformSessionToken(owner.id);
    planCode = `prov-le-${suffix}`;
    hrPlanCode = `prov-hr-${suffix}`;
    await prisma.subscriptionPlan.create({
      data: {
        code: planCode,
        name: 'Lead Eagle',
        modules: ['LEAD_EAGLE'],
        seatLimit: 10,
        storageMb: 512,
        planModules: { create: [{ module: 'LEAD_EAGLE' }] },
      },
    });
    await prisma.subscriptionPlan.create({
      data: {
        code: hrPlanCode,
        name: 'HR',
        modules: ['HRMS'],
        seatLimit: 10,
        storageMb: 512,
        planModules: { create: [{ module: 'HRMS' }] },
      },
    });
    wizardMade = await wizard('le', ['LEAD_EAGLE']);
  });

  it('a Lead Eagle workspace from the wizard lists the five in Admin > Roles, editable, each at its scope', async () => {
    const roles = await adminRoles(wizardMade);
    expect(roles.map(({ name, defaultScope, isSystem }) => ({ name, defaultScope, isSystem }))).toEqual(ADMIN_ROLES);
    expect(roles.filter((role) => !role.isSystem).every((role) => role.editable)).toBe(true);
  });

  it('the Admin > Roles screen shows each role’s scope beside its name, as the API gives it', async () => {
    const { slug } = await prisma.tenant.findUniqueOrThrow({ where: { id: wizardMade } });
    const admin = await prisma.user.findFirstOrThrow({
      where: { tenantId: wizardMade, role: { key: 'company_admin' } },
    });
    cookieJar.value = await createSessionToken(wizardMade, admin.id);
    const screen = async () =>
      RolesPage({ params: Promise.resolve({ workspaceSlug: slug }), searchParams: Promise.resolve({}) });

    const elements = (node: unknown): ReactElement<Record<string, unknown>>[] => {
      if (Array.isArray(node)) return node.flatMap(elements);
      if (!node || typeof node !== 'object' || !('props' in node)) return [];
      const el = node as ReactElement<Record<string, unknown>>;
      return [el, ...elements(el.props.children)];
    };
    const text = (node: unknown): string =>
      typeof node === 'string'
        ? node
        : Array.isArray(node)
          ? node.map(text).join('')
          : node && typeof node === 'object' && 'props' in node
            ? text((node as ReactElement<{ children?: unknown }>).props.children)
            : '';
    const rows = async () =>
      elements(await screen())
        .filter((el) => el.props.className === 'lf-roles__row')
        .map((row) => {
          const parts = elements(row.props.children);
          const name = text(parts.find((el) => el.type === 'strong'));
          return `${name} ${text(parts.find((el) => el.props.className === 'lf-roles__scope'))}`;
        });
    expect(await rows()).toEqual([
      'Agent · Own',
      'Company Administrator · Organization',
      'Manager · Organization',
      'Team Lead · Team',
      'Telecaller · Own',
      'Viewer · Organization',
    ]);

    // A role's own scope is only the default for new grants; access follows each
    // grant. A role made at Own (the New role form's default) whose grants reach
    // the whole workspace says so, rather than reading "Own".
    const custom = await prisma.role.create({
      data: { tenantId: wizardMade, key: `desk-${suffix}`, name: 'Desk Lead', rank: 45, defaultScope: 'OWN' },
    });
    try {
      await grantPermissions(wizardMade, custom.id, [['leads', 'VIEW']], 'ORGANIZATION');
      await grantPermissions(wizardMade, custom.id, [['tasks', 'VIEW']], 'OWN');
      expect(await rows()).toContain('Desk Lead · Own (up to Organization)');
    } finally {
      await prisma.rolePermission.deleteMany({ where: { tenantId: wizardMade, roleId: custom.id } });
      await prisma.role.deleteMany({ where: { tenantId: wizardMade, id: custom.id } });
    }
  });

  it('gives each role what its job needs: telecallers no contact details or exports, viewers only VIEW', async () => {
    const agent = await grants(wizardMade, 'Agent');
    expect(agent.get('leads:VIEW')).toBe('OWN');
    expect(agent.get('leads:VIEW_SENSITIVE_FIELDS')).toBe('OWN');
    expect(agent.get('calls:CREATE')).toBe('OWN');
    expect(agent.get('attendance:VIEW')).toBe('OWN');
    expect(agent.has('leads:ASSIGN')).toBe(false);
    expect(agent.has('attendance:APPROVE')).toBe(false);

    const telecaller = await grants(wizardMade, 'Telecaller');
    expect(telecaller.get('leads:CREATE')).toBe('OWN');
    expect([...telecaller.keys()].filter((key) => /:(VIEW_SENSITIVE_FIELDS|EXPORT)$/.test(key))).toEqual([]);

    const teamLead = await grants(wizardMade, 'Team Lead');
    expect(teamLead.get('leads:VIEW')).toBe('TEAM');
    expect(teamLead.get('leads:ASSIGN')).toBe('TEAM');
    expect(teamLead.get('attendance:APPROVE')).toBe('TEAM');
    // Handing out the pool is not scoped to a team, so it stays with the manager.
    expect(teamLead.has('allocation:APPROVE')).toBe(false);

    const manager = await grants(wizardMade, 'Manager');
    expect(manager.get('leads:ASSIGN')).toBe('ORGANIZATION');
    expect(manager.get('leads:EXPORT')).toBe('ORGANIZATION');
    expect(manager.get('reports:EXPORT')).toBe('ORGANIZATION');
    expect(manager.get('allocation:APPROVE')).toBe('ORGANIZATION');
    expect(manager.has('roles:MANAGE_CONFIGURATION')).toBe(false);

    const viewer = await grants(wizardMade, 'Viewer');
    expect(viewer.get('leads:VIEW')).toBe('ORGANIZATION');
    expect(new Set([...viewer.keys()].map((key) => key.split(':')[1]))).toEqual(new Set(['VIEW']));
  });

  it('lets each role open every Lead Eagle register; refuses the viewer a new lead and the telecaller an export', async () => {
    const { slug } = await prisma.tenant.findUniqueOrThrow({ where: { id: wizardMade } });
    const registers = [
      [leadsList, '/api/v1/leads'],
      [followUps, '/api/v1/follow-ups'],
      [calls, '/api/v1/calls'],
      [siteVisits, '/api/v1/site-visits'],
      [requirements, '/api/v1/requirements'],
      [allocation, '/api/v1/allocation'],
      [projects, '/api/v1/projects'],
      [listings, '/api/v1/listings'],
      [reports, '/api/v1/reports?report=lead-conversion'],
    ] as const;
    const cookies: Record<string, string> = {};
    for (const name of STARTER) {
      const role = await prisma.role.findFirstOrThrow({ where: { tenantId: wizardMade, name } });
      const key = name.toLowerCase().replace(' ', '-');
      const user = await createWorkspaceUser({
        tenantId: wizardMade,
        roleId: role.id,
        email: `${key}.${suffix}@prov.test`,
        fullName: name,
      });
      cookies[name] = await createSessionToken(wizardMade, user.id);
      for (const [handler, path] of registers) {
        const res = await get(handler, path, cookies[name]);
        expect(res.status, `${name} ${path} in ${slug}: ${JSON.stringify(res.body)}`).toBe(200);
      }
    }
    const lead = { fullName: 'Viewer Attempt', phone: `+9715${String(Date.now()).slice(-8)}` };
    expect((await post(leadCreate, '/api/v1/leads', lead, cookies.Viewer)).status).toBe(403);
    expect((await get(leadsExport, '/api/v1/leads/export', cookies.Telecaller)).status).toBe(403);
  });

  it('a Sales-only workspace from the wizard still gets the administrator alone', async () => {
    const id = await wizard('sales', ['SALES']);
    expect(await names(id)).toEqual(['Company Administrator']);
  });

  it('switching Lead Eagle on in the console adds them once; later saves neither repeat them nor bring back a deleted one', async () => {
    const id = await workspace('edit-on');
    await prisma.moduleEntitlement.create({ data: { tenantId: id, module: 'HRMS', state: 'ACTIVE' } });
    expect((await save(id, { enabledModules: ['HRMS', 'LEAD_EAGLE'] })).status).toBe(200);
    expect(await names(id)).toEqual(STARTER);

    await prisma.role.deleteMany({ where: { tenantId: id, name: 'Telecaller' } });
    // The console form sends the modules with every save.
    expect((await save(id, { companyPhone: '+971 4 000 0000', enabledModules: ['HRMS', 'LEAD_EAGLE'] })).status).toBe(
      200,
    );
    expect(await names(id)).toEqual(['Manager', 'Team Lead', 'Agent', 'Viewer']);
  });

  it('saving a workspace that already had Lead Eagle adds no roles (no backfill)', async () => {
    const id = await workspace('edit-had');
    await prisma.moduleEntitlement.create({ data: { tenantId: id, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
    expect((await save(id, { enabledModules: ['LEAD_EAGLE'] })).status).toBe(200);
    expect(await names(id)).toEqual([]);
  });

  it('a plan change that brings Lead Eagle brings the roles and the lists a lead needs', async () => {
    const id = await workspace('plan');
    const hr = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { code: hrPlanCode } });
    await prisma.moduleEntitlement.create({ data: { tenantId: id, module: 'HRMS', state: 'ACTIVE' } });
    const subscription = await prisma.tenantSubscription.create({
      data: { tenantId: id, planId: hr.id, state: 'ACTIVE' },
    });
    const res = await patch(
      editSubscription,
      `/api/v1/platform/subscriptions/${subscription.id}`,
      { planCode },
      ownerCookie,
      { subscriptionId: subscription.id },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await counts(id)).toEqual({ stages: 4, activityTypes: 6, taskTypes: 4 });
    expect(await names(id)).toEqual(STARTER);
  });

  it('a plan change that keeps Lead Eagle adds no role and brings back none', async () => {
    const id = await workspace('plan-keep');
    const le = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { code: planCode } });
    const both = await prisma.subscriptionPlan.create({
      data: {
        code: `prov-lehr-${suffix}`,
        name: 'Lead Eagle and HR',
        modules: ['LEAD_EAGLE', 'HRMS'],
        seatLimit: 10,
        storageMb: 512,
        planModules: { create: [{ module: 'LEAD_EAGLE' }, { module: 'HRMS' }] },
      },
    });
    await prisma.moduleEntitlement.create({ data: { tenantId: id, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
    await withPlatformTx((tx) => provisionLeadWork(tx, id, ['LEAD_EAGLE']));
    await prisma.role.deleteMany({ where: { tenantId: id, key: 'telecaller' } });
    const subscription = await prisma.tenantSubscription.create({
      data: { tenantId: id, planId: le.id, state: 'ACTIVE' },
    });
    const res = await patch(
      editSubscription,
      `/api/v1/platform/subscriptions/${subscription.id}`,
      { planCode: both.code },
      ownerCookie,
      { subscriptionId: subscription.id },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await names(id)).toEqual(['Manager', 'Team Lead', 'Agent', 'Viewer']);
  });

  it('switched on again, adds only what is missing and leaves an edited role as the administrator left it', async () => {
    const id = await workspace('again');
    await withPlatformTx((tx) => provisionLeadWork(tx, id, ['LEAD_EAGLE']));
    const agent = await prisma.role.findFirstOrThrow({ where: { tenantId: id, key: 'agent' } });
    await prisma.role.update({
      where: { tenantId: id, id: agent.id },
      data: { defaultScope: 'TEAM', description: 'Ours' },
    });
    await prisma.rolePermission.deleteMany({
      where: { tenantId: id, roleId: agent.id, permission: { module: 'leads', action: 'EXPORT' } },
    });
    await prisma.role.deleteMany({ where: { tenantId: id, key: 'telecaller' } });
    const edited = await grants(id, 'Agent');

    await withPlatformTx((tx) => provisionLeadWork(tx, id, ['LEAD_EAGLE']));
    expect(await names(id)).toEqual(STARTER);
    expect(await prisma.role.findFirstOrThrow({ where: { tenantId: id, id: agent.id } })).toMatchObject({
      defaultScope: 'TEAM',
      description: 'Ours',
    });
    expect(await grants(id, 'Agent')).toEqual(edited);
  });

  it('adds no second role under a name the workspace already uses', async () => {
    const id = await workspace('named');
    await prisma.role.create({
      data: { tenantId: id, key: 'sales_manager', name: 'manager', rank: 25, defaultScope: 'BRANCH' },
    });
    await withPlatformTx((tx) => provisionLeadWork(tx, id, ['LEAD_EAGLE']));
    expect(await names(id)).toEqual(['manager', 'Team Lead', 'Agent', 'Telecaller', 'Viewer']);
  });

  /**
   * Site visits as the starter roles meet them. A decision, a change and a read
   * reach as far as the role's scope; past it the visit is not found. They used
   * to load a visit by id alone, so the team lead's TEAM approval and the
   * agent's OWN edit reached every visit in the workspace.
   */
  describe('site visits under the starter roles', () => {
    const people: Record<string, { id: string; cookie: string }> = {};
    let clientId = '';

    beforeAll(async () => {
      const on = async (name: string, tag: string) => {
        const role = await prisma.role.findFirstOrThrow({ where: { tenantId: wizardMade, name } });
        const user = await createWorkspaceUser({
          tenantId: wizardMade,
          roleId: role.id,
          email: `visit-${tag}.${suffix}@prov.test`,
          fullName: `Visit ${tag}`,
        });
        return user.id;
      };
      const ids = {
        lead: await on('Team Lead', 'lead'),
        mine: await on('Agent', 'mine'),
        other: await on('Agent', 'other'),
      };
      // "mine" reports to the team lead; "other" is outside the team.
      await prisma.user.update({ where: { tenantId: wizardMade, id: ids.mine }, data: { managerId: ids.lead } });
      for (const [tag, id] of Object.entries(ids)) {
        people[tag] = { id, cookie: await createSessionToken(wizardMade, id) };
      }
      const stage = await prisma.leadStage.findFirstOrThrow({ where: { tenantId: wizardMade, isDefault: true } });
      const client = await prisma.lead.create({
        data: { tenantId: wizardMade, reference: `PV-${suffix}`, fullName: 'Visit Client', stageId: stage.id },
      });
      clientId = client.id;
    });

    const visit = (owner: string, status: 'REQUESTED' | 'APPROVED' | 'COMPLETED' = 'REQUESTED') =>
      prisma.siteVisit.create({
        data: {
          tenantId: wizardMade,
          ownerId: people[owner]!.id,
          leadId: clientId,
          kind: 'CLIENT_MEETING',
          address: 'Marina café',
          scheduledAt: new Date(Date.now() + 3_600_000),
          status,
          ...(status !== 'REQUESTED' && { decidedById: people.lead!.id, decidedAt: new Date() }),
        },
      });
    const change = async (id: string, body: Record<string, unknown>, as: string) =>
      (await patch(visitChange, `/api/v1/site-visits/${id}`, body, people[as]!.cookie, { id })).status;
    const statusOf = async (id: string) =>
      (await prisma.siteVisit.findFirstOrThrow({ where: { tenantId: wizardMade, id } })).status;

    it('a team lead approves its team’s visit; another team’s is not found and stays requested', async () => {
      const theirs = await visit('other');
      const ours = await visit('mine');
      expect(await change(theirs.id, { action: 'transition', status: 'APPROVED' }, 'lead')).toBe(404);
      expect(await statusOf(theirs.id)).toBe('REQUESTED');
      expect(await change(ours.id, { action: 'transition', status: 'APPROVED' }, 'lead')).toBe(200);
      expect(await statusOf(ours.id)).toBe('APPROVED');
    });

    it('an agent cannot cancel, punch, amend or open a colleague’s visit; its owner still amends it', async () => {
      const approved = await visit('other', 'APPROVED');
      const done = await visit('other', 'COMPLETED');
      const amend = { action: 'amend', reason: 'Wrong outcome recorded', outcome: 'Booked a second viewing' };
      expect(await change(approved.id, { action: 'transition', status: 'CANCELLED' }, 'mine')).toBe(404);
      expect(await statusOf(approved.id)).toBe('APPROVED');
      const punched = await post(
        visitPunch,
        `/api/v1/site-visits/${approved.id}/punch`,
        { direction: 'in', latitude: 25.08, longitude: 55.14 },
        people.mine!.cookie,
        { id: approved.id },
      );
      expect(punched.status).toBe(404);
      expect(await change(done.id, amend, 'mine')).toBe(404);
      const read = await get(visitGet, `/api/v1/site-visits/${done.id}`, people.mine!.cookie, { id: done.id });
      expect(read.status).toBe(404);
      expect(await change(done.id, amend, 'other')).toBe(200);
    });

    it('counts a team lead’s approval queue over its team’s visits, not the workspace’s', async () => {
      await prisma.siteVisit.deleteMany({ where: { tenantId: wizardMade } });
      await visit('mine');
      await visit('other');
      await visit('other');
      const queues = await leaderQueues(await ctxForUser(people.lead!.id, wizardMade, 'provision-lead-work'));
      expect(queues.awaitingApproval).toBe(1);
    });
  });
});

/**
 * The migration that repairs workspaces already created without the lists. Run
 * here as written, with one condition added: only this spec's workspaces, so a
 * parallel spec's tenants are never touched.
 */
describe('the repair migration 20261006000000_provision_lead_work', () => {
  const sql = readFileSync(
    path.join(__dirname, '..', '..', 'prisma', 'migrations', '20261006000000_provision_lead_work', 'migration.sql'),
    'utf8',
  );
  const run = (ids: string[]) =>
    withPlatformTx(async (tx) => {
      const scoped = sql.replaceAll(
        'WHERE t."deletedAt" IS NULL',
        `WHERE t."deletedAt" IS NULL AND t."id" IN (${ids.map((id) => `'${id}'`).join(', ')})`,
      );
      for (const statement of scoped.split(/;\s*\n/).filter((part) => /INSERT INTO/.test(part))) {
        await tx.$executeRawUnsafe(statement);
      }
    });
  const entitle = (tenantId: string, module: 'SALES' | 'REAL_ESTATE' | 'HRMS', state: 'ACTIVE' | 'CANCELED') =>
    prisma.moduleEntitlement.create({ data: { tenantId, module, state } });

  let realtyOnly = '';
  let ownStages = '';
  let hrOnly = '';
  let cancelled = '';

  beforeAll(async () => {
    realtyOnly = await workspace('m-realty');
    ownStages = await workspace('m-own');
    hrOnly = await workspace('m-hr');
    cancelled = await workspace('m-cancelled');
    await entitle(realtyOnly, 'REAL_ESTATE', 'ACTIVE');
    await entitle(ownStages, 'SALES', 'ACTIVE');
    await prisma.leadStage.create({ data: { tenantId: ownStages, key: 'enquiry', name: 'Enquiry', position: 1 } });
    await entitle(hrOnly, 'HRMS', 'ACTIVE');
    await entitle(cancelled, 'REAL_ESTATE', 'CANCELED');
    await run([realtyOnly, ownStages, hrOnly, cancelled]);
  });

  it('repairs a Real-Estate-only workspace that has no lists', async () => {
    expect(await counts(realtyOnly)).toEqual({ stages: 4, activityTypes: 6, taskTypes: 4 });
    expect(await prisma.leadStage.count({ where: { tenantId: realtyOnly, isDefault: true } })).toBe(1);
  });

  it('keeps a workspace’s own stages, and fills only its empty lists', async () => {
    expect(await counts(ownStages)).toEqual({ stages: 1, activityTypes: 6, taskTypes: 4 });
  });

  it('touches neither an HR-only workspace nor one whose lead module is cancelled', async () => {
    expect(await counts(hrOnly)).toEqual({ stages: 0, activityTypes: 0, taskTypes: 0 });
    expect(await counts(cancelled)).toEqual({ stages: 0, activityTypes: 0, taskTypes: 0 });
  });

  it('adds nothing when it runs again', async () => {
    await run([realtyOnly, ownStages]);
    expect(await counts(realtyOnly)).toEqual({ stages: 4, activityTypes: 6, taskTypes: 4 });
    expect(await counts(ownStages)).toEqual({ stages: 1, activityTypes: 6, taskTypes: 4 });
  });
});
