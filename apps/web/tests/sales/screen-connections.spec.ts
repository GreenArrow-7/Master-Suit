const cookieJar = vi.hoisted(() => ({ value: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: cookieJar.value, 'x-pathname': '/' }),
  cookies: async () => ({
    get: (name: string) => {
      const match = cookieJar.value.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? { name, value: match[1] } : undefined;
    },
  }),
}));

import { randomBytes } from 'node:crypto';
import type { ReactElement } from 'react';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { ctxForUser } from '@/lib/auth/session';
import { executeTool } from '@/lib/ai/assistant/tools';
import WorkspaceDashboard from '@/app/(workspace)/[workspaceSlug]/dashboard/page';
import SalesHomePage from '@/app/(workspace)/[workspaceSlug]/sales/page';
import DashboardsPage from '@/app/(workspace)/[workspaceSlug]/sales/dashboards/page';
import LeadershipPage from '@/app/(workspace)/[workspaceSlug]/sales/leadership/page';
import IntegrationsPage from '@/app/(workspace)/[workspaceSlug]/admin/integrations/page';
import MetaIntegrationPage from '@/app/(workspace)/[workspaceSlug]/admin/integrations/meta/page';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';

/**
 * Connections one render of a screen asks the pool for at once.
 *
 * The method of tests/sales/lead-page-connections.spec.ts (#180): a tenant query
 * outside `withTx` is a batched transaction on a pooled connection of its own
 * (runPinned, lib/db.ts), so a Promise.all of N reads asks for N connections.
 * Demand (checked out plus waiting) is read at every checkout, so the peak is
 * the code's fan-out on any machine. One render may ask for half the pool at
 * most, so two at once still fit.
 */
const pool = Object.getPrototypeOf(pg.Pool.prototype) as { connect: (...args: unknown[]) => unknown };
const connect = pool.connect;
let peak = 0;
let size = 0;

async function peakOf(run: () => Promise<unknown>) {
  peak = 0;
  await run();
  return peak;
}
/** Soft, so one run reports every screen and viewer. */
const fits = (screen: string, asked: number) =>
  expect.soft(asked, `${screen}: peak ${asked} of a pool of ${size}`).toBeLessThanOrEqual(size / 2);

const elements = (node: unknown): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...elements(el.props.children)];
};
let fixture: Fixture;
let tenantId: string;
let slug: string;
/** Leads, tasks and calls at TEAM, in a team: the scope reads run too. */
let teamViewer: string;

beforeAll(async () => {
  pool.connect = function (this: pg.Pool, ...args: unknown[]) {
    const result = connect.apply(this, args);
    size = (this as unknown as { options: { max: number } }).options.max;
    peak = Math.max(peak, this.totalCount - this.idleCount + this.waitingCount);
    return result;
  };
  fixture = await seedTwoTenants();
  ({ tenantId, slug } = fixture.a);
  cookieJar.value = fixture.a.cookie;
  const { roleId } = await prisma.user.findFirstOrThrow({
    where: { tenantId, id: fixture.a.userId },
    select: { roleId: true },
  });
  // Every panel on: people, approvals, security, the subscription, the leadership and integrations screens.
  await grantPermissions(tenantId, roleId!, [
    ['employee', 'VIEW'],
    ['auditlogs', 'VIEW'],
    ['settings', 'VIEW'],
    ['reports', 'VIEW'],
    ['integrations', 'VIEW'],
    ['activities', 'VIEW'],
    ...(['leave', 'overtime', 'attendance', 'shifts', 'recruitment', 'payroll', 'performance'] as const).map(
      (module) => [module, 'APPROVE'] as const,
    ),
  ]);
  // "My day": the administrator is an employee too.
  const membership = await prisma.workspaceMembership.findFirstOrThrow({
    where: { tenantId, salesUserId: fixture.a.userId },
    select: { id: true },
  });
  await prisma.employeeProfile.create({
    data: {
      tenantId,
      membershipId: membership.id,
      employeeNumber: `CONN-${randomBytes(3).toString('hex')}`,
      employmentStatus: 'ACTIVE',
    },
  });

  const suffix = randomBytes(4).toString('hex');
  const role = await prisma.role.create({ data: { tenantId, key: `team-${suffix}`, name: 'Team', rank: 60 } });
  await grantPermissions(
    tenantId,
    role.id,
    [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
      ['leads', 'ASSIGN'],
      ['tasks', 'VIEW'],
      ['calls', 'VIEW'],
      ['opportunities', 'VIEW'],
    ],
    'TEAM',
  );
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `team-${suffix}@a.test`,
    fullName: 'Team',
  });
  const team = await prisma.team.create({ data: { tenantId, name: 'Team', code: `T-${suffix}` } });
  await prisma.userTeam.create({ data: { tenantId, userId: user.id, teamId: team.id } });
  await prisma.lead.update({ where: { tenantId, id: fixture.a.leadIds[0]! }, data: { ownerId: user.id } });
  teamViewer = await createSessionToken(tenantId, user.id);
});

afterAll(async () => {
  pool.connect = connect;
  await fixture?.cleanup();
});

describe('one render of a screen asks for half the connection pool at most', () => {
  it('the workspace dashboard, with every panel on, and for a TEAM-scoped viewer', async () => {
    for (const viewer of [fixture.a.cookie, teamViewer]) {
      cookieJar.value = viewer;
      let titles: unknown[] = [];
      const asked = await peakOf(async () => {
        const tree = await WorkspaceDashboard({ params: Promise.resolve({ workspaceSlug: slug }) });
        titles = elements(tree).map((el) => el.props.title);
      });
      expect(titles).toContain('Call quality');
      if (viewer === fixture.a.cookie) expect(titles).toContain('My day');
      expect(size).toBeGreaterThan(0);
      fits(viewer === teamViewer ? 'dashboard, TEAM viewer' : 'dashboard, administrator', asked);
    }
  });

  it('the sales home (a manager’s)', async () => {
    cookieJar.value = fixture.a.cookie;
    const asked = await peakOf(async () => {
      // The page hands a manager to ManagerHome, an async component: rendered here as React would.
      const home = (await SalesHomePage()) as ReactElement<Record<string, unknown>>;
      const tree = elements(await (home.type as (props: unknown) => Promise<unknown>)(home.props));
      expect(tree.some((el) => el.props.label === 'leads in scope')).toBe(true);
    });
    fits('sales home', asked);
  });

  it('the sales dashboards', async () => {
    cookieJar.value = fixture.a.cookie;
    const asked = await peakOf(async () => {
      const tree = elements(await DashboardsPage());
      expect(tree.find((el) => 'totalLeads' in el.props)?.props.totalLeads).toBeGreaterThan(0);
    });
    fits('sales dashboards', asked);
  });

  it('the leadership page’s daily board, value and productivity tabs', async () => {
    cookieJar.value = fixture.a.cookie;
    for (const view of ['daily', 'value', 'productivity']) {
      const asked = await peakOf(() => LeadershipPage({ searchParams: Promise.resolve({ view }) }));
      fits(`leadership, ${view}`, asked);
    }
  });

  it('Admin > Integrations and its Meta page', async () => {
    cookieJar.value = fixture.a.cookie;
    const params = Promise.resolve({ workspaceSlug: slug });
    fits('integrations', await peakOf(() => IntegrationsPage({ params })));
    fits('integrations, Meta', await peakOf(() => MetaIntegrationPage({ params, searchParams: Promise.resolve({}) })));
  });

  it('the assistant’s My day', async () => {
    const ctx = await ctxForUser(fixture.a.userId, tenantId, randomBytes(8).toString('hex'));
    const asked = await peakOf(async () => {
      const day = await executeTool(ctx, 'getMyDay', {});
      expect(day.data).toHaveProperty('callsMadeToday', 0);
    });
    fits('My day', asked);
  });
});
