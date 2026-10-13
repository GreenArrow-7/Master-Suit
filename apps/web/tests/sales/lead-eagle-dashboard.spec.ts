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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PermissionAction, VisibilityScope } from '@prisma/client';
import { prisma, withPlatformTx } from '@/lib/db';
import { resolveCtx } from '@/lib/auth/session';
import { realtyDashboard } from '@/services/realty/dashboard';
import { ensureLeadSources } from '@/services/leads/leadSources';
import { dayBounds, todayKey } from '@/services/targets/dailyBoard';
import LeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/page';
import LeadGrid from '@/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid';
import FollowUpsPage from '@/app/(workspace)/[workspaceSlug]/sales/follow-ups/page';
import BoardPage from '@/app/(workspace)/[workspaceSlug]/realty/dashboard/page';
import WorkspaceDashboard from '@/app/(workspace)/[workspaceSlug]/dashboard/page';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import { GET as listFollowUps, POST as createFollowUp } from '@/app/api/v1/follow-ups/route';
import { POST as logCall } from '@/app/api/v1/leads/[id]/call-log/route';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { leadEagleWorkspace } from '../helpers/leadSource';
import { pageText } from '../helpers/render';
import { get, post } from '../helpers/request';

/**
 * The Lead Eagle board (audit rows M3-01–05, M3-09–15): every figure counted
 * under the viewer's scope on the workspace's clock, each with the link to the
 * list that shows what it counted.
 *
 * The first block runs the service at a fixed instant, 15 Oct 2026 12:00 in
 * Dubai, against rows placed either side of Dubai's midnight (and of UTC's and
 * India's), so a day read on any clock but the workspace's lands a row on the
 * wrong day. The second block follows each tile's link to its list at the real
 * time and compares the rows with the figure.
 */
const ctxFrom = (cookie: string) => resolveCtx(new Request('http://internal/', { headers: { cookie } }), 'vitest');
const at = (iso: string) => new Date(iso);
const tag = () => randomBytes(3).toString('hex');

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
  ['leads', 'VIEW_SENSITIVE_FIELDS'],
];

async function member(tenantId: string, name: string, grants: [string, PermissionAction][], scope: VisibilityScope) {
  const suffix = tag();
  const role = await prisma.role.create({ data: { tenantId, key: `${name}-${suffix}`, name, rank: 80 } });
  await grantPermissions(tenantId, role.id, grants, scope);
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${name}-${suffix}@board.test`,
    fullName: name,
  });
  return { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
}

/** Lead Eagle's ladder, enough of it: the helper's New (OPEN, default) comes first. */
async function ladder(tenantId: string) {
  const stage = (
    key: string,
    name: string,
    position: number,
    category: 'OPEN' | 'CONVERSION' | 'TERMINAL_NEGATIVE' = 'OPEN',
  ) =>
    prisma.leadStage.create({
      data: {
        tenantId,
        key,
        name,
        position,
        category,
        ...(key === 'meeting_scheduled' ? { requiredFields: ['meetingAt'] } : {}),
      },
    });
  const first = await prisma.leadStage.findFirstOrThrow({ where: { tenantId }, select: { id: true } });
  return {
    new: first.id,
    callback: (await stage('callback', 'Callback', 1)).id,
    meetingScheduled: (await stage('meeting_scheduled', 'Meeting Scheduled', 2)).id,
    meetingDone: (await stage('meeting_done', 'Meeting Done', 3)).id,
    booked: (await stage('booked', 'Booked', 4, 'CONVERSION')).id,
    notInterested: (await stage('not_interested', 'Not Interested', 5, 'TERMINAL_NEGATIVE')).id,
  };
}

const elements = (node: unknown): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...elements(el.props.children)];
};

describe('the board at 12:00 on 15 Oct 2026 in Dubai', () => {
  const NOW = at('2026-10-15T08:00:00Z');
  let ws: Awaited<ReturnType<typeof leadEagleWorkspace>>;
  let tenantId: string;
  let manager: { id: string; cookie: string };
  let agentA: { id: string; cookie: string };
  let agentB: { id: string; cookie: string };
  let stages: Awaited<ReturnType<typeof ladder>>;
  const src: Record<string, string> = {};

  beforeAll(async () => {
    ws = await leadEagleWorkspace('board', MANAGER);
    tenantId = ws.tenantId;
    manager = { id: ws.userId, cookie: ws.cookie };
    await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: 'Asia/Dubai' } });
    agentA = await member(tenantId, 'Agent Amal', AGENT, 'OWN');
    agentB = await member(tenantId, 'Agent Bilal', AGENT, 'OWN');
    stages = await ladder(tenantId);

    await ensureLeadSources(prisma, tenantId);
    for (const entry of await prisma.leadSource.findMany({ where: { tenantId }, select: { id: true, key: true } })) {
      src[entry.key] = entry.id;
    }
    src.marina = (
      await prisma.leadSource.create({
        data: { tenantId, key: 'website_marina', name: 'Marina launch', parentId: src.website! },
      })
    ).id;

    const lead = (name: string, data: Record<string, unknown>) =>
      prisma.lead.create({
        data: { tenantId, reference: `B-${tag()}`, fullName: name, stageId: stages.new, ...data },
        select: { id: true },
      });
    const portal = (key: string) => ({ source: 'MARKETPLACE' as const, sourceDetail: `${key}:x`, sourceId: src[key] });
    // 00:15 on 15 Oct in Dubai, still the 14th in UTC: new today.
    await lead('L1 untouched', { ownerId: agentA.id, createdAt: at('2026-10-14T20:15:00Z'), ...portal('bayut') });
    // 23:45 on 14 Oct in Dubai, already the 15th in India: not new today; first contacted 10:00 on the 15th.
    await lead('L2 callback', {
      ownerId: agentA.id,
      stageId: stages.callback,
      createdAt: at('2026-10-14T19:45:00Z'),
      firstContactedAt: at('2026-10-15T06:00:00Z'),
      ...portal('bayut'),
    });
    const l3 = await lead('L3 meeting', {
      ownerId: agentB.id,
      stageId: stages.meetingScheduled,
      createdAt: at('2026-10-10T08:00:00Z'),
      firstContactedAt: at('2026-10-10T09:00:00Z'),
      ...portal('property_finder'),
    });
    const l4 = await lead('L4 booked', {
      ownerId: agentB.id,
      stageId: stages.booked,
      createdAt: at('2026-10-09T08:00:00Z'),
      firstContactedAt: at('2026-10-09T08:30:00Z'),
    });
    await lead('L5 pool', {
      createdAt: at('2026-10-12T08:00:00Z'),
      source: 'PUBLIC_FORM',
      sourceId: src.marina,
    });
    await lead('L6 closed out', { ownerId: agentA.id, status: 'INVALID', createdAt: at('2026-10-15T07:00:00Z') });
    await lead('L7 met', {
      ownerId: agentB.id,
      stageId: stages.meetingDone,
      createdAt: at('2026-10-01T08:00:00Z'),
      firstContactedAt: at('2026-10-01T09:00:00Z'),
    });
    // Never contacted, but out of the ladder: not "untouched".
    await lead('L8 lost', { ownerId: agentB.id, stageId: stages.notInterested, createdAt: at('2026-10-01T08:00:00Z') });

    // L4 entered Booked inside the period, as Bilal's.
    await prisma.leadStageHistory.create({
      data: {
        tenantId,
        leadId: l4.id,
        toStageId: stages.booked,
        changedById: agentB.id,
        createdAt: at('2026-10-11T08:00:00Z'),
      },
    });

    const followUp = (ownerId: string, dueAt: string, kind: string, status = 'OPEN') =>
      prisma.followUpTask.create({
        data: { tenantId, ownerId, title: `${kind} ${dueAt}`, dueAt: at(dueAt), kind, status: status as 'OPEN' },
      });
    await followUp(agentA.id, '2026-10-15T05:00:00Z', 'CALL'); // 09:00 today
    await followUp(agentA.id, '2026-10-15T10:00:00Z', 'MEETING'); // 14:00 today: not a callback
    await followUp(agentA.id, '2026-10-14T19:30:00Z', 'CALL'); // 23:30 yesterday: overdue
    await followUp(agentB.id, '2026-10-14T20:30:00Z', 'CALL'); // 00:30 today
    await followUp(agentB.id, '2026-10-17T06:00:00Z', 'CALL'); // the day after tomorrow
    await followUp(agentA.id, '2026-10-15T06:00:00Z', 'CALL', 'COMPLETED');
    await followUp(agentA.id, '2026-10-22T06:00:00Z', 'CALL'); // past the strip

    const call = (callerId: string, createdAt: string, data: Record<string, unknown>) =>
      prisma.call.create({ data: { tenantId, callerId, createdAt: at(createdAt), ...data } });
    await call(agentA.id, '2026-10-15T06:00:00Z', { status: 'COMPLETED', outcome: 'CONNECTED', durationSecs: 90 });
    await call(agentA.id, '2026-10-14T06:00:00Z', { status: 'MISSED' });
    await call(agentB.id, '2026-10-13T06:00:00Z', { status: 'COMPLETED', outcome: 'NO_ANSWER', durationSecs: 10 });
    await call(agentB.id, '2026-10-12T06:00:00Z', { status: 'COMPLETED', outcome: 'BUSY' });
    await call(agentB.id, '2026-10-11T06:00:00Z', { status: 'COMPLETED', outcome: 'CONNECTED', durationSecs: 0 });
    await call(agentB.id, '2026-10-15T06:00:00Z', { status: 'SCHEDULED' }); // not made
    await call(agentA.id, '2026-10-01T06:00:00Z', { status: 'COMPLETED', outcome: 'CONNECTED', durationSecs: 30 });
    // 23:30 on 8 Oct in Dubai: before the period (already the 9th in India).
    await call(agentB.id, '2026-10-08T19:30:00Z', { status: 'COMPLETED', outcome: 'CONNECTED', durationSecs: 60 });

    const type = (key: string, name: string) =>
      prisma.activityType.upsert({
        where: { tenantId_key: { tenantId, key } },
        update: {},
        create: { tenantId, key, name },
        select: { id: true },
      });
    const callOut = await type('call_out', 'Outbound call');
    const note = await type('note', 'Lead note');
    await prisma.activity.createMany({
      data: [
        // Logged with Log call (#178): a connected call of two minutes.
        {
          tenantId,
          typeId: callOut.id,
          leadId: l3.id,
          ownerId: agentB.id,
          outcome: 'Interested',
          durationSecs: 120,
          occurredAt: at('2026-10-15T05:00:00Z'),
        },
        {
          tenantId,
          typeId: callOut.id,
          ownerId: agentA.id,
          outcome: 'No answer',
          occurredAt: at('2026-10-14T05:00:00Z'),
        },
        { tenantId, typeId: note.id, leadId: l3.id, ownerId: agentB.id, occurredAt: at('2026-10-15T05:00:00Z') },
      ],
    });

    const meeting = await prisma.taskType.create({ data: { tenantId, key: 'meeting', name: 'Meeting' } });
    const task = (ownerId: string, createdAt: string, status = 'OPEN') =>
      prisma.task.create({
        data: {
          tenantId,
          typeId: meeting.id,
          ownerId,
          title: 'Meeting',
          dueAt: at('2026-10-16T08:00:00Z'),
          createdAt: at(createdAt),
          status: status as 'OPEN',
        },
      });
    await task(agentA.id, '2026-10-14T08:00:00Z');
    await task(agentB.id, '2026-10-14T08:00:00Z', 'CANCELLED');
    await task(agentB.id, '2026-10-01T08:00:00Z');

    const visit = (status: string, scheduledAt: string) =>
      prisma.siteVisit.create({
        data: {
          tenantId,
          ownerId: agentB.id,
          leadId: l3.id,
          kind: 'CLIENT_MEETING',
          address: 'Marina Walk',
          status: status as 'APPROVED',
          scheduledAt: at(scheduledAt),
          decidedById: manager.id,
          decidedAt: at('2026-10-09T08:00:00Z'),
        },
      });
    await visit('COMPLETED', '2026-10-12T08:00:00Z');
    await visit('APPROVED', '2026-10-16T08:00:00Z');
  }, 120_000);

  afterAll(async () => {
    await ws.cleanup();
  });

  const board = async (cookie: string) => realtyDashboard(await ctxFrom(cookie), NOW);

  it('counts leads on the lead list’s terms, each tile with its list (M3-01, M3-02)', async () => {
    const org = await board(manager.cookie);
    expect(org.day).toBe('2026-10-15');
    expect(org.pipeline.totalLeads).toEqual({ value: 7, href: '/leads' });
    expect(org.today.newLeads).toEqual({ value: 1, href: '/leads?from=2026-10-15&to=2026-10-15' });
    expect(org.pipeline.unassigned).toEqual({ value: 1, href: '/leads?filter=unassigned' });
    expect(org.pipeline.untouched).toEqual({ value: 1, href: '/leads?filter=untouched' });

    const a = await board(agentA.cookie);
    expect(a.pipeline.totalLeads.value).toBe(2);
    expect(a.today.newLeads.value).toBe(1);
    // An agent who may not claim a lead has no Unassigned tile.
    expect(a.pipeline.unassigned).toBeNull();
    expect(a.pipeline.untouched.value).toBe(1);

    const b = await board(agentB.cookie);
    expect(b.today.newLeads.value).toBe(0);
    expect(b.pipeline.untouched.value).toBe(0);
  });

  it('splits overdue from due today on Dubai’s day, and counts only calls as callbacks (M3-03, M3-04)', async () => {
    const org = await board(manager.cookie);
    expect(org.today.overdue).toEqual({ value: 1, href: '/follow-ups?due=overdue' });
    expect(org.today.dueToday).toEqual({ value: 3, href: '/follow-ups?due=today' });
    // The 14:00 meeting is due today and is not a callback.
    expect(org.today.callbacks).toEqual({ value: 2, href: '/follow-ups?due=today&kind=CALL' });

    const a = await board(agentA.cookie);
    expect([a.today.overdue.value, a.today.dueToday.value, a.today.callbacks.value]).toEqual([1, 2, 1]);
    const b = await board(agentB.cookie);
    expect([b.today.overdue.value, b.today.dueToday.value, b.today.callbacks.value]).toEqual([0, 1, 1]);
  });

  it('counts leads in the meeting stages, and conversion as won of all (M3-05, M3-09)', async () => {
    const org = await board(manager.cookie);
    expect(org.pipeline.meetingsScheduled).toEqual({ value: 1, href: `/leads?stage=${stages.meetingScheduled}` });
    expect(org.pipeline.meetingsDone).toEqual({ value: 1, href: `/leads?stage=${stages.meetingDone}` });
    expect(org.pipeline.conversion).toEqual({ won: 1, total: 7, percent: 14, href: '/leads?filter=won' });

    // Bilal holds four leads and one is booked: 25%.
    const b = await board(agentB.cookie);
    expect(b.pipeline.conversion).toEqual({ won: 1, total: 4, percent: 25, href: '/leads?filter=won' });
    expect([b.pipeline.meetingsScheduled?.value, b.pipeline.meetingsDone?.value]).toEqual([1, 1]);
    const a = await board(agentA.cookie);
    expect([a.pipeline.meetingsScheduled?.value, a.pipeline.meetingsDone?.value]).toEqual([0, 0]);
    expect(a.pipeline.conversion).toEqual({ won: 0, total: 2, percent: 0, href: '/leads?filter=won' });
  });

  it('names each portal on its own row, a sub-source under its source (M3-10)', async () => {
    const org = await board(manager.cookie);
    const rows = Object.fromEntries(org.business.leadsBySource.map((row) => [row.label, row]));
    expect(rows['Bayut']).toEqual({ label: 'Bayut', count: 2, href: `/leads?source=${src.bayut}` });
    expect(rows['Property Finder']).toEqual({
      label: 'Property Finder',
      count: 1,
      href: `/leads?source=${src.property_finder}`,
    });
    expect(rows['Website']).toEqual({ label: 'Website', count: 1, href: `/leads?source=${src.website}` });
    // With no catalogue entry, the kind of source; no list filters on it.
    expect(rows['Manual']).toEqual({ label: 'Manual', count: 3, href: null });
    expect(org.business.leadsBySource.map((row) => row.count)).toEqual([3, 2, 1, 1]);

    const a = await board(agentA.cookie);
    expect(a.business.leadsBySource).toEqual([{ label: 'Bayut', count: 2, href: `/leads?source=${src.bayut}` }]);
  });

  it('draws the funnel in the workspace’s stage order (M3-11)', async () => {
    const org = await board(manager.cookie);
    expect(org.funnel.map(({ name, count, href }) => [name, count, href])).toEqual([
      ['New', 2, `/leads?stage=${stages.new}`],
      ['Callback', 1, `/leads?stage=${stages.callback}`],
      ['Meeting Scheduled', 1, `/leads?stage=${stages.meetingScheduled}`],
      ['Meeting Done', 1, `/leads?stage=${stages.meetingDone}`],
      ['Booked', 1, `/leads?stage=${stages.booked}`],
      ['Not Interested', 1, `/leads?stage=${stages.notInterested}`],
    ]);
    const a = await board(agentA.cookie);
    expect(a.funnel.map((row) => row.count)).toEqual([1, 1, 0, 0, 0, 0]);
  });

  it('ranks agents by calls over the last seven days (M3-12)', async () => {
    const org = await board(manager.cookie);
    expect(org.period).toEqual({ from: '2026-10-09', to: '2026-10-15' });
    expect(org.leaderboard).toEqual([
      {
        userId: agentB.id,
        name: 'Agent Bilal',
        calls: 4,
        meetings: 0,
        visits: 1,
        booked: 1,
        href: `/leads?owner=${agentB.id}`,
      },
      {
        userId: agentA.id,
        name: 'Agent Amal',
        calls: 3,
        meetings: 1,
        visits: 0,
        booked: 0,
        href: `/leads?owner=${agentA.id}`,
      },
    ]);
    // An agent at OWN scope would rank only themselves: no board.
    expect((await board(agentA.cookie)).leaderboard).toBeNull();
  });

  it('counts calls made, connected and talk time, provider calls with logged ones (M3-13)', async () => {
    expect((await board(manager.cookie)).calls).toEqual({ made: 7, connected: 3, seconds: 220, href: '/calls' });
    expect((await board(agentA.cookie)).calls).toEqual({ made: 3, connected: 1, seconds: 90, href: '/calls' });
    expect((await board(agentB.cookie)).calls).toEqual({ made: 4, connected: 2, seconds: 130, href: '/calls' });
  });

  it('puts received and worked leads on Dubai’s days for 14 days (M3-14)', async () => {
    const org = await board(manager.cookie);
    expect(org.trend).toHaveLength(14);
    expect(org.trend[0]!.date).toBe('2026-10-02');
    const day = (date: string) => org.trend.find((row) => row.date === date);
    expect(day('2026-10-15')).toEqual({
      date: '2026-10-15',
      received: 1,
      worked: 1,
      href: '/leads?from=2026-10-15&to=2026-10-15',
    });
    expect(day('2026-10-14')).toMatchObject({ received: 1, worked: 0 });
    expect(day('2026-10-12')).toMatchObject({ received: 1, worked: 0 });
    expect(day('2026-10-10')).toMatchObject({ received: 1, worked: 1 });
    expect(day('2026-10-09')).toMatchObject({ received: 1, worked: 1 });
    expect(org.trend.reduce((sum, row) => sum + row.received, 0)).toBe(5);
    const b = await board(agentB.cookie);
    expect(b.trend.filter((row) => row.received || row.worked).map((row) => row.date)).toEqual([
      '2026-10-09',
      '2026-10-10',
    ]);
  });

  it('lays out seven days of follow-ups, each day with its list (M3-15)', async () => {
    const org = await board(manager.cookie);
    expect(org.followUpDays.map((row) => [row.date, row.count])).toEqual([
      ['2026-10-15', 3],
      ['2026-10-16', 0],
      ['2026-10-17', 1],
      ['2026-10-18', 0],
      ['2026-10-19', 0],
      ['2026-10-20', 0],
      ['2026-10-21', 0],
    ]);
    expect(org.followUpDays[2]!.href).toBe('/follow-ups?date=2026-10-17');
    const a = await board(agentA.cookie);
    expect(a.followUpDays.map((row) => row.count)).toEqual([2, 0, 0, 0, 0, 0, 0]);
  });

  it('renders every tile and chart on the Lead Eagle board with its link', async () => {
    jar.cookie = manager.cookie;
    jar.path = `/${ws.slug}/lead-eagle/dashboard`;
    try {
      const tree = await BoardPage();
      const text = await pageText(tree);
      for (const label of [
        'New Leads',
        'Unassigned',
        'Untouched',
        'Overdue',
        'Due Today',
        'Callbacks',
        'Meetings Scheduled',
        'Meetings Done',
        'Conversion',
        'Leads by Source',
        'Leads by Stage',
        'Received vs Worked',
        'Follow-ups This Week',
        'Calls',
        'Leaderboard',
      ]) {
        expect(text).toContain(label);
      }
      // Every prop the tree carries, so a tile's or a bar's link too.
      for (const href of [
        '/leads?filter=untouched',
        '/follow-ups?due=today&kind=CALL',
        '/leads?filter=won',
        `/leads?stage=${stages.meetingDone}`,
        `/leads?source=${src.property_finder}`,
        // The page runs on the real clock.
        `/leads?from=${todayKey('Asia/Dubai')}&to=${todayKey('Asia/Dubai')}`,
        `/follow-ups?date=${todayKey('Asia/Dubai')}`,
      ]) {
        expect(text).toContain(href);
      }
      // Bookings and revenue stay off the Lead Eagle board.
      expect(text).not.toContain('Revenue');
    } finally {
      jar.path = '/';
    }
  });
});

describe('each tile opens the list of what it counted', () => {
  let ws: Awaited<ReturnType<typeof leadEagleWorkspace>>;
  let tenantId: string;
  let manager: { id: string; cookie: string };
  let agent: { id: string; cookie: string };
  let stages: Awaited<ReturnType<typeof ladder>>;
  let workedLeadId: string;

  beforeAll(async () => {
    ws = await leadEagleWorkspace('drill', MANAGER);
    tenantId = ws.tenantId;
    manager = { id: ws.userId, cookie: ws.cookie };
    // Sales too, for the Workspace Summary's Unassigned chip.
    await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: 'Asia/Dubai' } });
    agent = await member(tenantId, 'Drill Agent', AGENT, 'OWN');
    stages = await ladder(tenantId);

    const lead = (name: string, data: Record<string, unknown>) =>
      prisma.lead.create({ data: { tenantId, reference: `D-${tag()}`, fullName: name, stageId: stages.new, ...data } });
    await lead('Pool lead', {});
    await lead('Untouched lead', { ownerId: agent.id });
    workedLeadId = (await lead('Worked lead', { ownerId: agent.id, firstContactedAt: new Date() })).id;
    await lead('Won lead', { ownerId: agent.id, stageId: stages.booked, firstContactedAt: new Date() });
    await lead('Closed lead', { ownerId: agent.id, status: 'DUPLICATE' });
    await lead('Their lead', { ownerId: manager.id, lastActivityAt: new Date(), firstContactedAt: new Date() });
    await ensureLeadSources(prisma, tenantId);
    const entry = async (key: string) =>
      (await prisma.leadSource.findFirstOrThrow({ where: { tenantId, key }, select: { id: true } })).id;
    const marina = await prisma.leadSource.create({
      data: { tenantId, key: 'website_marina', name: 'Marina launch', parentId: await entry('website') },
    });
    await lead('Portal lead', {
      ownerId: agent.id,
      stageId: stages.meetingScheduled,
      source: 'MARKETPLACE',
      sourceId: await entry('bayut'),
      firstContactedAt: new Date(),
    });
    await lead('Form lead', {
      ownerId: manager.id,
      source: 'PUBLIC_FORM',
      sourceId: marina.id,
      createdAt: new Date(Date.now() - 3 * 86_400_000),
      firstContactedAt: new Date(),
    });

    const today = dayBounds(todayKey('Asia/Dubai'), 'Asia/Dubai');
    const followUp = (ownerId: string, dueAt: Date, kind: string) =>
      prisma.followUpTask.create({ data: { tenantId, ownerId, title: kind, dueAt, kind } });
    await followUp(agent.id, new Date(today.from.getTime() - 2 * 3_600_000), 'CALL');
    await followUp(agent.id, new Date(today.from.getTime() + 60_000), 'CALL');
    await followUp(agent.id, new Date(today.to.getTime() - 60_000), 'MEETING');
    await followUp(manager.id, new Date(today.to.getTime() + 6 * 3_600_000), 'CALL');
  }, 120_000);

  afterAll(async () => {
    await ws.cleanup();
  });

  const params = (href: string) => Object.fromEntries(new URL(href, 'http://x').searchParams);
  const leadRows = async (cookie: string, href: string) => {
    jar.cookie = cookie;
    const tree = await LeadsPage({ searchParams: Promise.resolve(params(href)) });
    const grid = elements(tree).find((el) => el.type === LeadGrid);
    return ((grid?.props.rows ?? []) as { fullName: string }[]).map((row) => row.fullName);
  };
  const followUpRows = async (cookie: string, href: string) => {
    jar.cookie = cookie;
    const tree = await FollowUpsPage({ searchParams: Promise.resolve(params(href)) });
    const grid = elements(tree).find((el) => el.type === ConfigurableGrid);
    return ((grid?.props.rows ?? []) as { id: string }[]).map((row) => row.id);
  };

  for (const who of ['manager', 'agent'] as const) {
    it(`the lead and follow-up tiles agree with their lists, for the ${who}`, async () => {
      const cookie = who === 'manager' ? manager.cookie : agent.cookie;
      const board = await realtyDashboard(await ctxFrom(cookie));
      const leadTiles = [
        board.pipeline.totalLeads,
        board.pipeline.unassigned,
        board.pipeline.untouched,
        { value: board.pipeline.conversion.won, href: board.pipeline.conversion.href },
      ].filter((tile) => tile !== null);
      expect(leadTiles.length).toBe(who === 'manager' ? 4 : 3);
      for (const tile of leadTiles) {
        expect((await leadRows(cookie, tile.href)).length, tile.href).toBe(tile.value);
      }
      expect(await leadRows(cookie, '/leads?filter=untouched')).toEqual(['Untouched lead']);

      const followUpTiles = [
        board.today.overdue,
        board.today.dueToday,
        board.today.callbacks,
        ...board.followUpDays.map((day) => ({ value: day.count, href: day.href })),
      ];
      for (const tile of followUpTiles) {
        expect((await followUpRows(cookie, tile.href)).length, tile.href).toBe(tile.value);
      }
      expect([board.today.overdue.value, board.today.dueToday.value, board.today.callbacks.value]).toEqual([1, 2, 1]);
    });

    // The lead list's stage, source, owner and date filters (#179).
    it(`each stage, source, meeting and day opens the leads it counted, for the ${who}`, async () => {
      const cookie = who === 'manager' ? manager.cookie : agent.cookie;
      const board = await realtyDashboard(await ctxFrom(cookie));
      const linked = [
        board.today.newLeads,
        board.pipeline.meetingsScheduled!,
        board.pipeline.meetingsDone!,
        ...board.funnel.map((row) => ({ value: row.count, href: row.href })),
        ...board.business.leadsBySource.flatMap((row) => (row.href ? [{ value: row.count, href: row.href }] : [])),
        ...board.trend.map((day) => ({ value: day.received, href: day.href })),
      ];
      for (const tile of linked) {
        expect((await leadRows(cookie, tile.href)).length, tile.href).toBe(tile.value);
      }
      const sources = board.business.leadsBySource.filter((row) => row.href).map((row) => [row.label, row.count]);
      expect(sources).toEqual(
        who === 'manager'
          ? [
              ['Bayut', 1],
              ['Website', 1],
            ]
          : [['Bayut', 1]],
      );
      expect(board.pipeline.meetingsScheduled?.value).toBe(1);
      expect(board.today.newLeads.value).toBe(who === 'manager' ? 6 : 4);
      if (who === 'manager') {
        // A name on the leaderboard opens that person's leads.
        expect(await leadRows(cookie, `/leads?owner=${agent.id}`)).not.toContain('Their lead');
      }
    });
  }

  it('the follow-ups API reads the day and the kind as the list does', async () => {
    const page = await followUpRows(manager.cookie, '/follow-ups?due=today&kind=CALL');
    const res = await get(listFollowUps, '/api/v1/follow-ups?due=today&kind=CALL', manager.cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.data as { id: string }[]).map((row) => row.id).sort()).toEqual([...page].sort());
    const tomorrow = todayKey('Asia/Dubai', new Date(Date.now() + 86_400_000));
    const day = await get(listFollowUps, `/api/v1/follow-ups?date=${tomorrow}`, manager.cookie);
    expect(day.body.data).toHaveLength(1);
    expect((await get(listFollowUps, '/api/v1/follow-ups?date=2026-02-31', manager.cookie)).status).toBe(422);
  });

  it('a follow-up is a call unless it is booked as something else', async () => {
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, fullName: 'Pool lead' } });
    const dueAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const call = await post(
      createFollowUp,
      '/api/v1/follow-ups',
      { leadId: lead.id, title: 'Ring', dueAt },
      manager.cookie,
    );
    expect(call.status, JSON.stringify(call.body)).toBe(200);
    expect(call.body.kind).toBe('CALL');
    const meet = await post(
      createFollowUp,
      '/api/v1/follow-ups',
      { leadId: lead.id, title: 'Show the villa', dueAt, kind: 'MEETING' },
      manager.cookie,
    );
    expect(meet.body.kind).toBe('MEETING');
    const bad = await post(createFollowUp, '/api/v1/follow-ups', { title: 'x', dueAt, kind: 'LUNCH' }, manager.cookie);
    expect(bad.status).toBe(422);
    await prisma.followUpTask.deleteMany({ where: { tenantId, id: { in: [call.body.id, meet.body.id] } } });
  });

  it('the Workspace Summary’s Unassigned chip counts and opens the same list', async () => {
    jar.cookie = manager.cookie;
    const tree = await WorkspaceDashboard({ params: Promise.resolve({ workspaceSlug: ws.slug }) });
    const chip = elements(tree).find((el) => el.props.href === `/${ws.slug}/sales/leads?filter=unassigned`);
    expect(chip, 'the chip links the unassigned list').toBeDefined();
    const count = elements(chip!.props.children).find((el) => el.props.className === 'lf-attn__count');
    expect(count?.props.children).toBe(1);
    expect((await leadRows(manager.cookie, '/leads?filter=unassigned')).length).toBe(1);
  });

  it('the first touch on a lead stamps when it was first contacted, and an earlier one moves it back', async () => {
    const fresh = await prisma.lead.create({
      data: { tenantId, reference: `T-${tag()}`, fullName: 'Fresh lead', stageId: stages.new, ownerId: agent.id },
    });
    const log = (minutesAgo: number) =>
      post(
        logCall,
        `/api/v1/leads/${fresh.id}/call-log`,
        { outcome: 'No answer', occurredAt: new Date(Date.now() - minutesAgo * 60_000).toISOString() },
        agent.cookie,
      );
    const first = await log(60);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const stamp = async () =>
      (await prisma.lead.findFirstOrThrow({ where: { tenantId, id: fresh.id } })).firstContactedAt?.toISOString();
    expect(await stamp()).toBe(first.body.activity.occurredAt);
    const earlier = await log(180);
    expect(await stamp()).toBe(earlier.body.activity.occurredAt);
    await log(30);
    expect(await stamp()).toBe(earlier.body.activity.occurredAt);
    expect(await leadRows(agent.cookie, '/leads?filter=untouched')).toEqual(['Untouched lead']);
    void workedLeadId;
  });
});

/**
 * Leads worked before the stamp existed: the migration dates their first
 * contact from their earliest activity or call. Run here as written, limited
 * to this spec's workspace so a parallel spec's tenants are never touched.
 */
describe('the first-contact backfill in 20261015100000_lead_dashboard', () => {
  const sql = readFileSync(
    path.join(__dirname, '..', '..', 'prisma', 'migrations', '20261015100000_lead_dashboard', 'migration.sql'),
    'utf8',
  );
  let ws: Awaited<ReturnType<typeof leadEagleWorkspace>>;

  beforeAll(async () => {
    ws = await leadEagleWorkspace('backfill', MANAGER);
  }, 60_000);
  afterAll(async () => {
    await ws.cleanup();
  });

  it('dates first contact from the earliest activity or call, and leaves the rest alone', async () => {
    const { tenantId, userId } = ws;
    const stageId = (await prisma.leadStage.findFirstOrThrow({ where: { tenantId } })).id;
    const lead = (name: string, firstContactedAt: Date | null = null) =>
      prisma.lead.create({
        data: { tenantId, reference: `M-${tag()}`, fullName: name, stageId, ownerId: userId, firstContactedAt },
      });
    const worked = await lead('Worked before');
    const kept = await lead('Already stamped', at('2026-09-20T08:00:00Z'));
    const never = await lead('Never worked');
    const type = await prisma.activityType.create({ data: { tenantId, key: 'note', name: 'Note' } });
    await prisma.activity.create({
      data: { tenantId, typeId: type.id, leadId: worked.id, occurredAt: at('2026-10-01T08:00:00Z') },
    });
    await prisma.call.create({
      data: { tenantId, callerId: userId, leadId: worked.id, createdAt: at('2026-09-30T08:00:00Z') },
    });
    await prisma.call.create({
      data: { tenantId, callerId: userId, leadId: kept.id, createdAt: at('2026-09-01T08:00:00Z') },
    });

    const updates = sql.split(/;\s*\n/).filter((part) => /UPDATE "Lead"/.test(part));
    expect(updates).toHaveLength(1);
    await withPlatformTx((tx) =>
      tx.$executeRawUnsafe(
        updates[0]!.replace(
          'WHERE l."firstContactedAt" IS NULL',
          `WHERE l."firstContactedAt" IS NULL AND l."tenantId" = '${tenantId}'`,
        ),
      ),
    );

    const stamped = async (id: string) =>
      (await prisma.lead.findFirstOrThrow({ where: { tenantId, id } })).firstContactedAt?.toISOString() ?? null;
    expect(await stamped(worked.id)).toBe('2026-09-30T08:00:00.000Z');
    expect(await stamped(kept.id)).toBe('2026-09-20T08:00:00.000Z');
    expect(await stamped(never.id)).toBeNull();
  });
});
