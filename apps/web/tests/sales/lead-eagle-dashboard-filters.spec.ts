// The screens read the session (and Lead Eagle's path) from the request, set per case.
const jar = vi.hoisted(() => ({ cookie: '', path: '/' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: jar.cookie, 'x-pathname': jar.path }),
  cookies: async () => ({
    get: (name: string) => {
      const match = jar.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? { name, value: match[1] } : undefined;
    },
  }),
}));

import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { ReactElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PermissionAction, VisibilityScope } from '@prisma/client';
import { prisma } from '@/lib/db';
import { resolveCtx } from '@/lib/auth/session';
import { realtyDashboard } from '@/services/realty/dashboard';
import { ensureLeadSources } from '@/services/leads/leadSources';
import LeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/page';
import LeadGrid from '@/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid';
import FollowUpsPage from '@/app/(workspace)/[workspaceSlug]/sales/follow-ups/page';
import CallsPage from '@/app/(workspace)/[workspaceSlug]/sales/calls/page';
import SiteVisitsPage from '@/app/(workspace)/[workspaceSlug]/sales/site-visits/page';
import TasksPage from '@/app/(workspace)/[workspaceSlug]/sales/tasks/page';
import BoardPage from '@/app/(workspace)/[workspaceSlug]/realty/dashboard/page';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { leadEagleWorkspace } from '../helpers/leadSource';

/**
 * The Lead Eagle board's filters and drill-down (audit rows M3-16, M3-17,
 * M3-18): a period, a person or team, a source and a project narrow every
 * figure; the choice is remembered per user and carried in the URL; a person
 * outside the viewer's reach is ignored; and every figure under the filters
 * opens a list of exactly what it counted (calls with logged calls, the
 * leaderboard's cells, the visit tiles).
 */
const ctxFrom = (cookie: string) => resolveCtx(new Request('http://internal/', { headers: { cookie } }), 'vitest');
const tag = () => randomBytes(3).toString('hex');
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

const AGENT: [string, PermissionAction][] = [
  ['leads', 'VIEW'],
  ['leads', 'EDIT'],
  ['calls', 'VIEW'],
  ['tasks', 'VIEW'],
  ['visits', 'VIEW'],
];
const MANAGER: [string, PermissionAction][] = [
  ...AGENT,
  ['leads', 'CREATE'],
  ['leads', 'ASSIGN'],
  ['projects', 'VIEW'],
];

const elements = (node: unknown): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...elements(el.props.children)];
};
const params = (href: string) => Object.fromEntries(new URL(href, 'http://x').searchParams);

/** How many rows the list a figure links shows, rendered as its page. */
async function listed(cookie: string, href: string): Promise<number> {
  jar.cookie = cookie;
  jar.path = '/';
  const searchParams = Promise.resolve(params(href));
  const path = href.split('?')[0];
  if (path === '/leads') {
    const grid = elements(await LeadsPage({ searchParams })).find((el) => el.type === LeadGrid);
    return ((grid?.props.rows ?? []) as unknown[]).length;
  }
  if (path === '/follow-ups') {
    const grid = elements(await FollowUpsPage({ searchParams })).find((el) => el.type === ConfigurableGrid);
    return ((grid?.props.rows ?? []) as unknown[]).length;
  }
  if (path === '/calls') {
    const tree = elements(await CallsPage({ searchParams }));
    const grid = tree.find((el) => el.type === ConfigurableGrid);
    return ((grid?.props.rows ?? []) as unknown[]).length + tree.filter((el) => el.props['data-logged-call']).length;
  }
  if (path === '/site-visits') {
    return elements(await SiteVisitsPage({ searchParams })).filter((el) => el.props['data-visit']).length;
  }
  if (path === '/tasks') {
    return elements(await TasksPage({ searchParams })).filter((el) => el.props['data-label'] === 'Task').length;
  }
  throw new Error(`no list for ${href}`);
}

describe('the board under its filters', () => {
  let ws: Awaited<ReturnType<typeof leadEagleWorkspace>>;
  let tenantId: string;
  let manager: { id: string; cookie: string };
  let agentA: { id: string; cookie: string };
  let agentB: { id: string; cookie: string };
  let teamLead: { id: string; cookie: string };
  let teamA: string;
  let projectId: string;
  const src: Record<string, string> = {};

  async function member(name: string, scope: VisibilityScope) {
    const suffix = tag();
    const role = await prisma.role.create({ data: { tenantId, key: `${name}-${suffix}`, name, rank: 80 } });
    await grantPermissions(tenantId, role.id, AGENT, scope);
    const user = await createWorkspaceUser({
      tenantId,
      roleId: role.id,
      email: `${name.replace(/\s/g, '')}-${suffix}@filters.test`,
      fullName: name,
    });
    return { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
  }

  beforeAll(async () => {
    ws = await leadEagleWorkspace('filters', MANAGER);
    tenantId = ws.tenantId;
    manager = { id: ws.userId, cookie: ws.cookie };
    await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: 'Asia/Dubai' } });
    agentA = await member('Agent Amal', 'OWN');
    agentB = await member('Agent Bilal', 'OWN');
    teamLead = await member('Team Lead', 'TEAM');
    teamA = (await prisma.team.create({ data: { tenantId, name: 'Team A', code: `A-${tag()}` } })).id;
    const teamB = (await prisma.team.create({ data: { tenantId, name: 'Team B', code: `B-${tag()}` } })).id;
    await prisma.userTeam.createMany({
      data: [
        { tenantId, userId: agentA.id, teamId: teamA },
        { tenantId, userId: teamLead.id, teamId: teamA },
        { tenantId, userId: agentB.id, teamId: teamB },
      ],
    });
    projectId = (await prisma.project.create({ data: { tenantId, name: 'Marina Heights', code: `P-${tag()}` } })).id;
    await ensureLeadSources(prisma, tenantId);
    for (const entry of await prisma.leadSource.findMany({ where: { tenantId }, select: { id: true, key: true } })) {
      src[entry.key] = entry.id;
    }
    const first = await prisma.leadStage.findFirstOrThrow({ where: { tenantId }, select: { id: true } });
    const booked = await prisma.leadStage.create({
      data: { tenantId, key: 'booked', name: 'Booked', position: 4, category: 'CONVERSION' },
    });

    const lead = (name: string, data: Record<string, unknown>, project = false) =>
      prisma.lead.create({
        data: {
          tenantId,
          reference: `F-${tag()}`,
          fullName: name,
          stageId: first.id,
          ...data,
          ...(project ? { projectInterests: { create: { tenantId, projectId } } } : {}),
        },
        select: { id: true },
      });
    const bayut = { source: 'MARKETPLACE' as const, sourceId: src.bayut };
    const l1 = await lead(
      'L1 Amal bayut project',
      { ownerId: agentA.id, createdAt: ago(2), firstContactedAt: ago(1), stageId: booked.id, ...bayut },
      true,
    );
    const l2 = await lead('L2 Amal old', {
      ownerId: agentA.id,
      createdAt: ago(20),
      source: 'MARKETPLACE',
      sourceId: src.property_finder,
    });
    const l3 = await lead('L3 Bilal bayut', { ownerId: agentB.id, createdAt: ago(3), ...bayut });
    const l4 = await lead('L4 Bilal project', { ownerId: agentB.id, createdAt: ago(40) }, true);
    await prisma.leadStageHistory.create({
      data: { tenantId, leadId: l1.id, toStageId: booked.id, changedById: agentA.id, createdAt: ago(1) },
    });

    const now = Date.now();
    const followUp = (ownerId: string, leadId: string, dueAt: Date) =>
      prisma.followUpTask.create({ data: { tenantId, ownerId, leadId, title: 'Ring', dueAt, kind: 'CALL' } });
    // Due in a few minutes: today on any clock but a minute before midnight.
    await followUp(agentA.id, l1.id, new Date(now + 60_000));
    await followUp(agentA.id, l2.id, ago(3));
    await followUp(agentB.id, l3.id, new Date(now + 60_000));
    await followUp(agentB.id, l4.id, ago(2));

    const call = (callerId: string, leadId: string, createdAt: Date, data: Record<string, unknown>) =>
      prisma.call.create({ data: { tenantId, callerId, leadId, createdAt, ...data } });
    await call(agentA.id, l1.id, ago(1), { status: 'COMPLETED', outcome: 'CONNECTED', durationSecs: 60 });
    await call(agentA.id, l2.id, ago(2), { status: 'MISSED' });
    await call(agentB.id, l3.id, ago(1), { status: 'COMPLETED', outcome: 'NO_ANSWER', durationSecs: 10 });
    await call(agentA.id, l2.id, ago(20), { status: 'COMPLETED', outcome: 'CONNECTED', durationSecs: 5 });
    await call(agentB.id, l4.id, ago(1), { status: 'SCHEDULED' });

    const callOut = await prisma.activityType.upsert({
      where: { tenantId_key: { tenantId, key: 'call_out' } },
      update: {},
      create: { tenantId, key: 'call_out', name: 'Outbound call' },
    });
    await prisma.activity.createMany({
      data: [
        {
          tenantId,
          typeId: callOut.id,
          leadId: l1.id,
          ownerId: agentA.id,
          outcome: 'Connected',
          durationSecs: 30,
          occurredAt: ago(1),
        },
        { tenantId, typeId: callOut.id, leadId: l4.id, ownerId: agentB.id, outcome: 'No answer', occurredAt: ago(1) },
      ],
    });

    const meeting = await prisma.taskType.create({ data: { tenantId, key: 'meeting', name: 'Meeting' } });
    const task = (ownerId: string, leadId: string, status = 'OPEN') =>
      prisma.task.create({
        data: {
          tenantId,
          typeId: meeting.id,
          ownerId,
          leadId,
          title: 'Meeting',
          dueAt: new Date(now + DAY),
          createdAt: ago(1),
          status: status as 'OPEN',
        },
      });
    await task(agentA.id, l1.id);
    await task(agentB.id, l3.id);
    await task(agentB.id, l3.id, 'CANCELLED');

    const visit = (ownerId: string, leadId: string, status: string, scheduledAt: Date, project = false) =>
      prisma.siteVisit.create({
        data: {
          tenantId,
          ownerId,
          leadId,
          kind: 'CLIENT_MEETING',
          address: 'Marina Walk',
          decidedById: manager.id,
          decidedAt: ago(5),
          status: status as 'APPROVED',
          scheduledAt,
          ...(project ? { projectId } : {}),
        },
      });
    await visit(agentA.id, l1.id, 'COMPLETED', ago(2), true);
    await visit(agentB.id, l3.id, 'COMPLETED', ago(1));
    await visit(agentB.id, l4.id, 'APPROVED', new Date(now + DAY), true);
    await visit(agentA.id, l2.id, 'COMPLETED', ago(30));
  }, 120_000);

  afterAll(async () => {
    await ws.cleanup();
  });

  const board = async (cookie: string, filter: Record<string, string> = {}) =>
    realtyDashboard(await ctxFrom(cookie), new Date(), filter);

  it('a period and a team narrow every figure (M3-16)', async () => {
    const all = await board(manager.cookie);
    expect(all.pipeline.totalLeads.value).toBe(4);
    const f = await board(manager.cookie, { range: '7d', team: teamA });
    // Team A's leads received in the last 7 days: L1.
    expect(f.pipeline.totalLeads.value).toBe(1);
    expect(f.funnel.reduce((sum, row) => sum + row.count, 0)).toBe(1);
    expect(f.pipeline.conversion.won).toBe(1);
    // Amal's follow-ups (no period: overdue and today are their own days).
    expect([f.today.overdue.value, f.today.dueToday.value]).toEqual([1, 1]);
    // Amal's calls in 7 days: two placed, one logged; connected two; 90 s.
    expect(f.calls).toMatchObject({ made: 3, connected: 2, seconds: 90 });
    expect(f.leaderboard?.map((row) => [row.name, row.calls, row.meetings, row.visits, row.booked])).toEqual([
      ['Agent Amal', 2, 1, 1, 1],
    ]);
    expect(f.pipeline.visitsCompleted?.value).toBe(1);
    // One person narrows the same way.
    const b = await board(manager.cookie, { owner: agentB.id });
    expect(b.pipeline.totalLeads.value).toBe(2);
    expect(b.calls).toMatchObject({ made: 2, connected: 0 });
    expect(b.pipeline.visitsApproved?.value).toBe(1);
  });

  it('a source and a project narrow every figure (M3-17)', async () => {
    const s = await board(manager.cookie, { source: src.bayut! });
    expect(s.pipeline.totalLeads.value).toBe(2);
    expect(s.business.leadsBySource.map((row) => row.label)).toEqual(['Bayut']);
    // Calls to L1 and L3, and the call logged on L1.
    expect(s.calls).toMatchObject({ made: 3, connected: 2 });
    expect([s.today.overdue.value, s.today.dueToday.value]).toEqual([0, 2]);
    expect(s.pipeline.visitsCompleted?.value).toBe(2);

    // A project: the leads it interests (L1, L4) and the visits to it.
    const p = await board(manager.cookie, { project: projectId });
    expect(p.pipeline.totalLeads.value).toBe(2);
    expect(p.calls).toMatchObject({ made: 3, connected: 2 });
    expect([p.pipeline.visitsApproved?.value, p.pipeline.visitsCompleted?.value]).toEqual([1, 1]);
    expect(p.leaderboard?.map((row) => [row.name, row.meetings])).toEqual([
      ['Agent Amal', 1],
      ['Agent Bilal', 0],
    ]);
  });

  it('a person or team outside the viewer’s reach is ignored, never widening (M3-16)', async () => {
    const own = await board(teamLead.cookie);
    const outside = await board(teamLead.cookie, { owner: agentB.id });
    expect(outside.filter.owner).toBeUndefined();
    expect(outside.pipeline.totalLeads).toEqual(own.pipeline.totalLeads);
    expect(outside.calls).toEqual(own.calls);
    const bogus = await board(agentA.cookie, { owner: 'nobody', team: 'nothing' });
    expect(bogus.filter).toEqual({});
    expect(bogus.pipeline.totalLeads.value).toBe(2);
  });

  for (const who of ['manager', 'team lead'] as const) {
    it(`every figure under the filters opens a list of exactly what it counted, for the ${who} (M3-18)`, async () => {
      const cookie = who === 'manager' ? manager.cookie : teamLead.cookie;
      const filters: Record<string, string>[] = [
        {},
        { range: '7d', team: teamA },
        { source: src.bayut! },
        { project: projectId },
      ];
      for (const filter of filters) {
        const b = await board(cookie, filter);
        const figures: { value: number; href: string }[] = [
          b.pipeline.totalLeads,
          b.today.newLeads,
          b.today.overdue,
          b.today.dueToday,
          { value: b.pipeline.conversion.won, href: b.pipeline.conversion.href },
          ...b.funnel.map((row) => ({ value: row.count, href: row.href })),
          { value: b.calls!.made, href: b.calls!.href },
          { value: b.calls!.connected, href: b.calls!.connectedHref },
          b.today.siteVisits!,
          b.pipeline.visitsApproved!,
          b.pipeline.visitsCompleted!,
          ...(b.leaderboard ?? []).flatMap((row) => [
            { value: row.calls!, href: row.links.calls },
            { value: row.meetings!, href: row.links.meetings },
            { value: row.visits!, href: row.links.visits },
            { value: row.booked, href: row.links.booked },
          ]),
        ];
        for (const figure of figures) {
          expect(await listed(cookie, figure.href), `${JSON.stringify(filter)} ${figure.href}`).toBe(figure.value);
        }
      }
    }, 180_000);
  }

  it('remembers the choice per user and puts it in the URL (M3-16)', async () => {
    const render = async (cookie: string, query: Record<string, string>) => {
      jar.cookie = cookie;
      jar.path = `/${ws.slug}/lead-eagle/dashboard`;
      try {
        await BoardPage({ searchParams: Promise.resolve(query) } as never);
        return null;
      } catch (error) {
        const digest = String((error as { digest?: string }).digest ?? '');
        if (!digest.startsWith('NEXT_REDIRECT')) throw error;
        return digest.split(';')[2]!;
      }
    };
    expect(await render(manager.cookie, { range: '7d', team: teamA })).toBeNull();
    // Opened again with nothing in the URL: back to the remembered choice, in the URL.
    expect(await render(manager.cookie, {})).toBe(`/${ws.slug}/lead-eagle/dashboard?range=7d&team=${teamA}`);
    // Another user's board is their own.
    expect(await render(teamLead.cookie, {})).toBeNull();
    // The form's empty fields come back as the tidy URL.
    expect(await render(teamLead.cookie, { range: '30d', from: '', owner: '' })).toBe(
      `/${ws.slug}/lead-eagle/dashboard?range=30d`,
    );
    // Cleared, it stays cleared.
    expect(await render(manager.cookie, { clear: '1' })).toBe(`/${ws.slug}/lead-eagle/dashboard`);
    expect(await render(manager.cookie, {})).toBeNull();
  });
});

/**
 * Connections the board asks the pool for at once (#180's measure): demand is
 * read at every checkout, so the peak is the code's fan-out on any machine.
 */
describe('one board view fits the connection pool', () => {
  const pool = Object.getPrototypeOf(pg.Pool.prototype) as { connect: (...args: unknown[]) => unknown };
  const connect = pool.connect;
  let peak = 0;
  let size = 0;
  let ws: Awaited<ReturnType<typeof leadEagleWorkspace>>;

  beforeAll(async () => {
    pool.connect = function (this: pg.Pool, ...args: unknown[]) {
      const result = connect.apply(this, args);
      size = (this as unknown as { options: { max: number } }).options.max;
      peak = Math.max(peak, this.totalCount - this.idleCount + this.waitingCount);
      return result;
    };
    ws = await leadEagleWorkspace('board-pool', MANAGER);
  });

  afterAll(async () => {
    pool.connect = connect;
    await ws.cleanup();
  });

  it('the filtered board asks for no more connections at once than the pool holds', async () => {
    jar.cookie = ws.cookie;
    jar.path = `/${ws.slug}/lead-eagle/dashboard`;
    peak = 0;
    const tree = await BoardPage({ searchParams: Promise.resolve({ range: '30d' }) } as never);
    expect(tree).toBeTruthy();
    expect(size).toBeGreaterThan(0);
    expect(peak, `peak ${peak} of a pool of ${size}`).toBeLessThanOrEqual(size);
  });
});
