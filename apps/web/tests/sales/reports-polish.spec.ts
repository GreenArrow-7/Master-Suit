/**
 * The lead reports, polished (M16-00, M16-01, M16-02, M16-05, M16-10, M16-12):
 * a Lead-Eagle-only workspace is not offered the money reports; every report
 * narrows by the board's period, person, team, source and project, on the
 * workspace's clock, and its CSV link carries the same; a portal lead with no
 * catalogue entry is counted under its portal; Rep Activity counts each
 * agent's calls, stage moves and notes; and the attendance summary and its
 * audited CSV work without HRMS.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

import { prisma } from '@/lib/db';
import { csvCell } from '@/lib/csv';
import { resolveCtx } from '@/lib/auth/session';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import type { PermissionAction } from '@prisma/client';
import { ensureLeadSources } from '@/services/leads/leadSources';
import { reportParams, runReport, toCsv } from '@/services/leadership/reports';
import { GET as reportRoute } from '@/app/api/v1/reports/route';
import { GET as hrExport } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/reports/[reportKey]/export/route';
import ReportsPage from '@/app/(workspace)/[workspaceSlug]/sales/reports/page';
import AttendancePage from '@/app/(workspace)/[workspaceSlug]/people/attendance/page';
import { createEmployee, createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { leadEagleWorkspace } from '../helpers/leadSource';
import { pageText } from '../helpers/render';
import { createSessionToken } from '../helpers/session';

const tag = () => randomBytes(3).toString('hex');
const ctxFrom = (cookie: string) => resolveCtx(new Request('http://internal/', { headers: { cookie } }), 'vitest');

const MANAGER: [string, PermissionAction][] = [
  ['reports', 'VIEW'],
  ['reports', 'EXPORT'],
  ['leads', 'VIEW'],
  ['calls', 'VIEW'],
  ['projects', 'VIEW'],
  ['employee', 'VIEW'],
  ['attendance', 'VIEW'],
];
const AGENT: [string, PermissionAction][] = [
  ['reports', 'VIEW'],
  ['leads', 'VIEW'],
  ['calls', 'VIEW'],
];

let ws: Awaited<ReturnType<typeof leadEagleWorkspace>>;
let tenantId: string;
let agentA: { id: string; cookie: string };
let agentB: { id: string; cookie: string };
let teamId: string;
let projectId: string;
let bayutId: string;
const stage: Record<'new' | 'qualified', string> = { new: '', qualified: '' };

async function member(name: string) {
  const role = await prisma.role.create({ data: { tenantId, key: `${name}-${tag()}`, name, rank: 80 } });
  await grantPermissions(tenantId, role.id, AGENT, 'OWN');
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${name.replace(/\s/g, '')}-${tag()}@reports.test`,
    fullName: name,
  });
  return { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
}

const lead = (data: Record<string, unknown>) =>
  prisma.lead.create({
    data: { tenantId, reference: `RP-${tag()}`, fullName: 'Report lead', stageId: stage.new, ...data } as never,
  });

const api = async (cookie: string, query: string) => {
  const res = await reportRoute(new Request(`http://localhost/api/v1/reports?${query}`, { headers: { cookie } }), {
    params: Promise.resolve({}),
  });
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
};
const screen = async (cookie: string, params: Record<string, string>) => {
  jar.cookie = cookie;
  jar.path = `/${ws.slug}/lead-eagle/reports`;
  return pageText(ReportsPage({ searchParams: Promise.resolve(params) }));
};
const stages = (rows: { stage: string; open: number }[]) => Object.fromEntries(rows.map((r) => [r.stage, r.open]));

beforeAll(async () => {
  ws = await leadEagleWorkspace('reports', MANAGER);
  tenantId = ws.tenantId;
  await prisma.tenant.updateMany({ where: { id: tenantId }, data: { timezone: 'Asia/Dubai' } });
  stage.new = (await prisma.leadStage.findFirstOrThrow({ where: { tenantId, isDefault: true } })).id;
  stage.qualified = (
    await prisma.leadStage.create({
      data: { tenantId, key: `qualified-${tag()}`, name: 'Qualified', category: 'OPEN', position: 1 },
    })
  ).id;
  agentA = await member('Agent Able');
  agentB = await member('Agent Baker');
  teamId = (await prisma.team.create({ data: { tenantId, name: 'Team Tango', code: `T-${tag()}` } })).id;
  await prisma.userTeam.create({ data: { tenantId, teamId, userId: agentA.id } });
  projectId = (await prisma.project.create({ data: { tenantId, name: 'Report Tower', code: `RT-${tag()}` } })).id;

  const a1 = await lead({ ownerId: agentA.id });
  const a2 = await lead({ ownerId: agentA.id, stageId: stage.qualified });
  await lead({ ownerId: agentB.id });
  await prisma.leadProject.create({ data: { tenantId, leadId: a1.id, projectId } });

  // M16-02: two portal leads from before the catalogue (no entry), one from after.
  await ensureLeadSources(prisma, tenantId);
  bayutId = (await prisma.leadSource.findFirstOrThrow({ where: { tenantId, key: 'bayut' } })).id;
  await lead({ ownerId: ws.userId, source: 'MARKETPLACE', sourceDetail: 'bayut:R-1' });
  await lead({ ownerId: ws.userId, source: 'MARKETPLACE', sourceDetail: 'property_finder:R-2' });
  await lead({ ownerId: ws.userId, source: 'MARKETPLACE', sourceDetail: 'bayut:R-3', sourceId: bayutId });

  // M16-12: follow-ups either side of midnight in Dubai (UTC+4).
  const followUp = (ownerId: string, dueAt: string) =>
    prisma.followUpTask.create({
      data: { tenantId, ownerId, leadId: a1.id, title: 'Call back', dueAt: new Date(dueAt) },
    });
  await followUp(agentA.id, '2026-10-01T21:30:00Z'); // 2 Oct, 01:30 in Dubai
  await followUp(agentA.id, '2026-10-01T19:00:00Z'); // 1 Oct, 23:00 in Dubai
  await followUp(agentB.id, '2026-10-02T08:00:00Z'); // 2 Oct, 12:00 in Dubai

  // M16-05: Agent Able places one call, logs another, moves one lead and writes one note.
  const type = (key: string, name: string) => prisma.activityType.create({ data: { tenantId, key, name } });
  const [callOut, note] = [await type('call_out', 'Outgoing call'), await type('note', 'Note')];
  await prisma.call.create({
    data: { tenantId, callerId: agentA.id, leadId: a1.id, status: 'COMPLETED', outcome: 'CONNECTED' },
  });
  await prisma.activity.create({
    data: { tenantId, typeId: callOut.id, ownerId: agentA.id, leadId: a2.id, outcome: 'No answer' },
  });
  await prisma.activity.create({ data: { tenantId, typeId: note.id, ownerId: agentA.id, leadId: a2.id } });
  await prisma.leadStageHistory.create({
    data: { tenantId, leadId: a2.id, fromStageId: stage.new, toStageId: stage.qualified, changedById: agentA.id },
  });
});

afterAll(async () => {
  await ws.cleanup();
});

describe('a Lead-Eagle-only workspace’s report menu (M16-00)', () => {
  it('offers the lead reports and not the revenue, booking-value and campaign ones', async () => {
    const menu = await screen(ws.cookie, {});
    for (const title of ['Follow-up Adherence', 'Source to Booking', 'Pipeline Summary', 'Rep Activity Summary']) {
      expect(menu).toContain(title);
    }
    for (const title of ['Revenue Forecast', 'Team Performance', 'Campaign Performance']) {
      expect(menu).not.toContain(title);
    }
  });

  it('refuses a money report by URL, on the API and on the screen', async () => {
    expect((await api(ws.cookie, 'report=revenue-forecast')).status).toBe(404);
    const refused = await screen(ws.cookie, { report: 'campaign-performance' }).then(
      () => null,
      (error: { digest?: string }) => String(error.digest),
    );
    expect(refused).toContain('404');
  });

  it('shows the pipeline by stage without the opportunity value', async () => {
    const report = await runReport(await ctxFrom(ws.cookie), 'pipeline-summary', {
      from: new Date(Date.now() - 86_400_000),
      to: new Date(Date.now() + 86_400_000),
    });
    expect(report.columns.map((c) => c.key)).toEqual(['stage', 'open', 'entered']);
  });

  it('offers them again once the plan has Sales', async () => {
    await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });
    await invalidateEntitlements(tenantId);
    try {
      expect((await api(ws.cookie, 'report=revenue-forecast')).status).toBe(200);
      expect(await screen(ws.cookie, {})).toContain('Revenue Forecast');
    } finally {
      await prisma.moduleEntitlement.deleteMany({ where: { tenantId, module: 'SALES' } });
      await invalidateEntitlements(tenantId);
    }
  });
});

describe('report filters (M16-01, M16-12)', () => {
  it('narrows the pipeline to a person or a team', async () => {
    const mine = await api(ws.cookie, `report=pipeline-summary&owner=${agentA.id}`);
    expect(mine.status).toBe(200);
    expect(stages(mine.body.rows)).toEqual({ New: 1, Qualified: 1 });
    const team = await api(ws.cookie, `report=pipeline-summary&team=${teamId}`);
    expect(stages(team.body.rows)).toEqual({ New: 1, Qualified: 1 });
    const everyone = await api(ws.cookie, 'report=pipeline-summary');
    expect(stages(everyone.body.rows)).toEqual({ New: 5, Qualified: 1 });
  });

  it('reads a day as the workspace’s day, and a person with it', async () => {
    const day = 'from=2026-10-02&to=2026-10-02';
    const all = await api(ws.cookie, `report=follow-up-adherence&${day}`);
    expect(all.body.rows.map((r: { agent: string; due: number }) => [r.agent, r.due]).sort()).toEqual([
      ['Agent Able', 1],
      ['Agent Baker', 1],
    ]);
    const able = await api(ws.cookie, `report=follow-up-adherence&${day}&owner=${agentA.id}`);
    expect(able.body.rows).toEqual([expect.objectContaining({ agent: 'Agent Able', due: 1 })]);
    // The 23:00 follow-up is the day before in Dubai, though the same UTC date.
    const before = await api(ws.cookie, `report=follow-up-adherence&from=2026-10-01&to=2026-10-01&owner=${agentA.id}`);
    expect(before.body.rows).toEqual([expect.objectContaining({ due: 1 })]);
  });

  it('offers the filters on the screen, and its CSV link carries them', async () => {
    const text = await screen(ws.cookie, {
      report: 'follow-up-adherence',
      from: '2026-10-02',
      to: '2026-10-02',
      owner: agentA.id,
    });
    expect(text).toContain('Agent Able');
    expect(text).toContain('Team Tango');
    expect(text).toContain(
      `/api/v1/reports?report=follow-up-adherence&from=2026-10-02&to=2026-10-02&owner=${agentA.id}&format=csv`,
    );
  });

  it('narrows by source and by project', async () => {
    const bayut = await api(ws.cookie, `report=source-analysis&source=${bayutId}`);
    expect(bayut.body.rows).toEqual([expect.objectContaining({ source: 'Bayut', leads: 1 })]);
    const tower = await api(ws.cookie, `report=pipeline-summary&project=${projectId}`);
    expect(stages(tower.body.rows)).toEqual({ New: 1, Qualified: 0 });
  });

  it('ignores a person outside the viewer’s reach rather than widening or emptying the report', async () => {
    const ctx = await ctxFrom(agentA.cookie);
    const { range, filter } = await reportParams(ctx, { owner: agentB.id });
    expect(filter.owner).toBeUndefined();
    const report = await runReport(ctx, 'pipeline-summary', range, filter);
    expect(stages(report.rows as never)).toEqual({ New: 1, Qualified: 1 });
  });

  it('records the filters with the export', async () => {
    const res = await reportRoute(
      new Request(`http://localhost/api/v1/reports?report=pipeline-summary&team=${teamId}&format=csv`, {
        headers: { cookie: ws.cookie },
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, event: 'EXPORT_REQUESTED', recordId: 'pipeline-summary' },
    });
    expect(row.metadata).toMatchObject({ report: 'pipeline-summary', team: teamId });
  });
});

describe('sources and sub-sources (M16-02)', () => {
  it('counts a portal lead with no catalogue entry under its portal, beside the entry’s', async () => {
    const range = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
    const ctx = await ctxFrom(ws.cookie);
    for (const key of ['source-analysis', 'lead-quality', 'source-to-booking'] as const) {
      const rows = Object.fromEntries((await runReport(ctx, key, range)).rows.map((r) => [r.source, r]));
      expect(rows.Bayut, key).toMatchObject({ leads: 2 });
      expect(rows['Property Finder'], key).toMatchObject({ leads: 1 });
    }
  });
});

describe('rep activity (M16-05)', () => {
  it('counts each agent’s calls, stage moves and notes, on screen and in the file', async () => {
    const range = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
    const report = await runReport(await ctxFrom(ws.cookie), 'rep-activity', range);
    expect(report.rows.find((r) => r.who === 'Agent Able')).toMatchObject({
      activities: 2,
      calls: 2,
      connected: 1,
      moves: 1,
      notes: 1,
    });
    // Who, activities, calls, connected, stage moves, notes, leads responded to, average first response.
    expect(toCsv(report)).toContain(['Agent Able', 2, 2, 1, 1, 1, 0, null].map(csvCell).join(','));
  });
});

describe('the attendance summary without HRMS (M16-10)', () => {
  const download = (key: string) =>
    hrExport(
      new Request(`http://localhost/api/v1/workspaces/${ws.slug}/hr/reports/${key}/export?from=2026-10-01`, {
        headers: { cookie: ws.cookie },
      }),
      { params: Promise.resolve({ workspaceSlug: ws.slug, reportKey: key }) },
    );

  it('downloads it, audited, and still refuses the HR reports', async () => {
    const worker = await createEmployee({ tenantId, label: 'Clocker', suffix: tag() });
    await prisma.hrAttendanceRecord.create({
      data: { tenantId, employeeId: worker.employeeId, workDate: new Date('2026-10-05'), workMinutes: 480 },
    });
    const res = await download('attendance-summary');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('8');
    const audited = await prisma.auditLog.findFirst({
      where: { tenantId, event: 'EXPORT_REQUESTED', objectType: 'hr_report', recordId: 'attendance-summary' },
    });
    expect(audited).not.toBeNull();
    expect((await download('headcount-by-department')).status).toBe(403);
  });

  it('shows the per-person summary on the attendance screen, with its export', async () => {
    jar.cookie = ws.cookie;
    jar.path = `/${ws.slug}/attendance`;
    const text = await pageText(
      AttendancePage({
        params: Promise.resolve({ workspaceSlug: ws.slug }),
        searchParams: Promise.resolve({ from: '2026-10-01', to: '2026-10-31' }),
      }),
    );
    expect(text).toContain('Per person');
    expect(text).toContain(
      `/api/v1/workspaces/${ws.slug}/hr/reports/attendance-summary/export?from=2026-10-01&to=2026-10-31`,
    );
  });
});
