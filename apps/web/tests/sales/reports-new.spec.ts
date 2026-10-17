import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The reports screen reads its session the way Next serves it.
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
import { prisma } from '@/lib/db';
import { runReport, toCsv, REPORT_KEYS } from '@/services/leadership/reports';
import { GET as reportRoute } from '@/app/api/v1/reports/route';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { pageText } from '../helpers/render';
import ReportsPage from '@/app/(workspace)/[workspaceSlug]/sales/reports/page';

/**
 * The reports the 11 Oct audit found missing (M16-03, M16-07, M16-09, M16-13):
 * projects, site visits, calls, and the same rows regrouped by user, month,
 * project or lead. Each case is the audit's acceptance, seeded and read back.
 */
const suffix = randomBytes(4).toString('hex');
// Mid-month dates, so the workspace's clock (Asia/Dubai) cannot move one across a month.
const RANGE = { from: new Date('2026-08-01T00:00:00+04:00'), to: new Date('2026-09-30T23:59:59+04:00') };
const aug = (day: number) => new Date(`2026-08-${String(day).padStart(2, '0')}T10:00:00+04:00`);
const sep = (day: number) => new Date(`2026-09-${String(day).padStart(2, '0')}T10:00:00+04:00`);

let fixture: Fixture;
let tenantId: string;
let agent: string;
let other: { id: string; fullName: string };
let leads: string[];
const projectName = `Marina Heights ${suffix}`;
const bookedProjectName = `Creek Vista ${suffix}`;
const ctx = () => buildCtx(buildActor({ id: agent, tenantId, grants: [['reports', 'VIEW']] }));
const AGENT = 'manath Administrator';

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  agent = fixture.a.userId;
  leads = fixture.a.leadIds;
  const role = await prisma.user.findFirstOrThrow({ where: { tenantId, id: agent }, select: { roleId: true } });
  other = await createWorkspaceUser({
    tenantId,
    roleId: role.roleId,
    email: `other.${suffix}@test.local`,
    fullName: `Other Agent ${suffix}`,
  });

  // M16-07: one agent's visits, 2 completed, 1 no-show, 1 requested.
  const project = await prisma.project.create({ data: { tenantId, name: projectName, code: `MH-${suffix}` } });
  const visit = (leadId: string, scheduledAt: Date, status: 'COMPLETED' | 'NO_SHOW' | 'REQUESTED', ownerId = agent) =>
    prisma.siteVisit.create({ data: { tenantId, ownerId, leadId, projectId: project.id, scheduledAt, status } });
  await visit(leads[0]!, aug(10), 'COMPLETED');
  await visit(leads[1]!, sep(10), 'COMPLETED');
  await visit(leads[2]!, sep(12), 'NO_SHOW');
  await visit(leads[3]!, sep(20), 'REQUESTED');

  // M16-03: a project with one booked unit and one visited lead (another agent's visit).
  const booked = await prisma.project.create({ data: { tenantId, name: bookedProjectName, code: `CV-${suffix}` } });
  const unit = await prisma.unitInventory.create({
    data: { tenantId, projectId: booked.id, unitNumber: `U-${suffix}`, status: 'BOOKED' },
  });
  await prisma.siteVisit.create({
    data: {
      tenantId,
      ownerId: other.id,
      leadId: leads[4]!,
      projectId: booked.id,
      scheduledAt: aug(20),
      status: 'COMPLETED',
    },
  });
  await prisma.booking.create({
    data: {
      tenantId,
      reference: `BK-${suffix}`,
      leadId: leads[4]!,
      ownerId: other.id,
      projectId: booked.id,
      unitInventoryId: unit.id,
      status: 'CONFIRMED',
      saleValue: '1500000',
      bookingDate: aug(25),
    },
  });

  // M16-09: three calls by one agent, two connected (120 s + 60 s).
  const call = (status: 'COMPLETED', outcome: 'CONNECTED' | 'NO_ANSWER', durationSecs: number | null) =>
    prisma.call.create({
      data: { tenantId, callerId: agent, leadId: leads[0]!, status, outcome, durationSecs, createdAt: aug(12) },
    });
  await call('COMPLETED', 'CONNECTED', 120);
  await call('COMPLETED', 'CONNECTED', 60);
  await call('COMPLETED', 'NO_ANSWER', null);

  // M16-13: notes by month, and follow-ups on time, late and overdue.
  const note = await prisma.activityType.create({ data: { tenantId, key: `note-${suffix}`, name: 'Note' } });
  for (const occurredAt of [aug(3), aug(4), sep(3)]) {
    await prisma.activity.create({ data: { tenantId, typeId: note.id, ownerId: agent, occurredAt } });
  }
  const followUp = (dueAt: Date, extra: Record<string, unknown> = {}) =>
    prisma.followUpTask.create({
      data: { tenantId, leadId: leads[0]!, ownerId: agent, title: 'Call back', dueAt, ...extra },
    });
  await followUp(aug(5), { status: 'COMPLETED', completedAt: aug(4) });
  await followUp(sep(3), { status: 'COMPLETED', completedAt: sep(6) });
  await followUp(sep(8));
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('site-visit report (M16-07)', () => {
  it('counts one agent’s visits scheduled, done and missed, with the show rate', async () => {
    const report = await runReport(ctx(), 'site-visits', RANGE);
    const row = report.rows.find((r) => r.agent === AGENT);
    expect(row).toEqual({ agent: AGENT, scheduled: 4, done: 2, missed: 1, cancelled: 0, rate: '67%' });
    expect(toCsv(report)).toContain(`"${AGENT}","4","2","1","0","67%"`);
  });

  it('regroups by project and by month', async () => {
    const byProject = await runReport(ctx(), 'site-visits', RANGE, { by: 'project' });
    expect(byProject.columns[0]).toEqual({ key: 'project', label: 'Project' });
    expect(byProject.rows.find((r) => r.project === projectName)).toMatchObject({ scheduled: 4, done: 2, missed: 1 });

    const byMonth = await runReport(ctx(), 'site-visits', RANGE, { by: 'month' });
    expect(byMonth.rows).toEqual([
      { month: '2026-08', scheduled: 2, done: 2, missed: 0, cancelled: 0, rate: '100%' },
      { month: '2026-09', scheduled: 3, done: 1, missed: 1, cancelled: 0, rate: '50%' },
    ]);
  });
});

describe('call report (M16-09)', () => {
  it('shows an agent’s calls, connected calls and talk time, and the CSV matches', async () => {
    const report = await runReport(ctx(), 'call-report', RANGE);
    expect(report.rows).toEqual([{ agent: AGENT, calls: 3, connected: 2, minutes: 3 }]);
    expect(toCsv(report)).toContain(`"${AGENT}","3","2","3"`);
  });

  it('counts a call logged by hand beside the provider’s, per lead and per month', async () => {
    const type = await prisma.activityType.create({ data: { tenantId, key: 'call_out', name: 'Outgoing call' } });
    await prisma.activity.create({
      data: {
        tenantId,
        typeId: type.id,
        ownerId: agent,
        leadId: leads[1]!,
        outcome: 'Connected',
        durationSecs: 90,
        occurredAt: sep(5),
      },
    });
    expect((await runReport(ctx(), 'call-report', RANGE)).rows).toEqual([
      { agent: AGENT, calls: 4, connected: 3, minutes: 4.5 },
    ]);

    const byLead = await runReport(ctx(), 'call-report', RANGE, { by: 'lead' });
    expect(byLead.columns[0]).toEqual({ key: 'lead', label: 'Lead' });
    expect(byLead.rows).toEqual([
      { lead: 'manath Lead 0', calls: 3, connected: 2, minutes: 3 },
      { lead: 'manath Lead 1', calls: 1, connected: 1, minutes: 1.5 },
    ]);

    const byMonth = await runReport(ctx(), 'call-report', RANGE, { by: 'month' });
    expect(byMonth.rows).toEqual([
      { month: '2026-08', calls: 3, connected: 2, minutes: 3 },
      { month: '2026-09', calls: 1, connected: 1, minutes: 1.5 },
    ]);
  });
});

describe('project report (M16-03)', () => {
  it('shows a project’s units, availability, bookings and the leads that visited it', async () => {
    const report = await runReport(ctx(), 'project-report', RANGE);
    const row = report.rows.find((r) => r.project === bookedProjectName);
    expect(row).toEqual({
      project: bookedProjectName,
      units: 1,
      available: 0,
      booked: 1,
      leads: 1,
      visited: 1,
      bookings: 1,
      value: 'AED 1,500,000',
    });
    expect(report.rows.find((r) => r.project === projectName)).toMatchObject({ units: 0, leads: 4, visited: 2 });
    expect(toCsv(report)).toContain(`"${bookedProjectName}","1","0","1","1","1","1","AED 1,500,000"`);
  });
});

describe('pivots (M16-13)', () => {
  it('activity log by month: one row per month per type', async () => {
    const report = await runReport(ctx(), 'activity-log', RANGE, { by: 'month' });
    expect(report.columns.map((c) => c.key)).toEqual(['type', 'month', 'count']);
    expect(report.rows.filter((r) => r.type === 'Note')).toEqual([
      { type: 'Note', month: '2026-08', count: 2 },
      { type: 'Note', month: '2026-09', count: 1 },
    ]);
  });

  it('follow-up adherence by month', async () => {
    const report = await runReport(ctx(), 'follow-up-adherence', RANGE, { by: 'month' });
    expect(report.rows).toEqual([
      { month: '2026-08', due: 1, done: 1, onTime: 1, late: 0, overdue: 0, rate: '100%' },
      { month: '2026-09', due: 2, done: 1, onTime: 0, late: 1, overdue: 1, rate: '0%' },
    ]);
    // By user is the report as it was.
    expect((await runReport(ctx(), 'follow-up-adherence', RANGE, { by: 'user' })).rows).toEqual([
      { agent: AGENT, due: 3, done: 2, onTime: 1, late: 1, overdue: 1, rate: '33%' },
    ]);
  });

  it('the route takes ?by=, the CSV follows it, and a grouping the report lacks is refused', async () => {
    const role = await prisma.role.create({ data: { tenantId, key: `rx-${suffix}`, name: 'Exporter', rank: 50 } });
    await grantPermissions(tenantId, role.id, [
      ['reports', 'VIEW'],
      ['reports', 'EXPORT'],
    ]);
    const user = await createWorkspaceUser({
      tenantId,
      roleId: role.id,
      email: `rx.${suffix}@test.local`,
      fullName: 'Exporter',
    });
    const cookie = await createSessionToken(tenantId, user.id);
    const call = (query: string) =>
      reportRoute(
        new Request(
          `http://localhost/api/v1/reports?${query}&from=${RANGE.from.toISOString()}&to=${RANGE.to.toISOString()}`,
          { headers: { cookie } },
        ),
        { params: Promise.resolve({}) },
      );
    const csv = await call('report=activity-log&by=month&format=csv');
    expect(csv.status).toBe(200);
    // text() drops the byte-order mark the file starts with.
    const body = await csv.text();
    expect(body.split('\r\n')[0]).toBe('"Type","Month","Logged"');
    expect(body).toContain('"Note","2026-08","2"');
    expect(csv.headers.get('content-disposition')).toContain('activity-log-by-month-');

    expect((await call('report=lead-conversion&by=month')).status).toBe(422);
    expect((await call('report=site-visits&by=lead')).status).toBe(422);
  });

  it('every pivot a report offers answers', async () => {
    const { PIVOTS } = await import('@/services/leadership/reports');
    for (const key of REPORT_KEYS) {
      for (const by of PIVOTS[key] ?? []) {
        const report = await runReport(ctx(), key, RANGE, { by });
        for (const row of report.rows)
          for (const c of report.columns) expect(row, `${key}/${by}`).toHaveProperty(c.key);
      }
    }
  });
});

describe('the reports screen', () => {
  it('lists the new reports, and offers a report’s groupings, its CSV and its schedule', async () => {
    const role = await prisma.role.create({ data: { tenantId, key: `rs-${suffix}`, name: 'Screen', rank: 50 } });
    await grantPermissions(tenantId, role.id, [
      ['reports', 'VIEW'],
      ['reports', 'EXPORT'],
    ]);
    const user = await createWorkspaceUser({
      tenantId,
      roleId: role.id,
      email: `rs.${suffix}@test.local`,
      fullName: 'Screen',
    });
    cookieJar.value = await createSessionToken(tenantId, user.id);
    const menu = await pageText(ReportsPage({ searchParams: Promise.resolve({}) }));
    for (const title of ['Projects', 'Site Visits', 'Call Report']) expect(menu).toContain(title);

    const from = RANGE.from.toISOString();
    const to = RANGE.to.toISOString();
    const screen = await pageText(
      ReportsPage({ searchParams: Promise.resolve({ report: 'site-visits', by: 'project', from, to }) }),
    );
    expect(screen).toContain('By agent');
    expect(screen).toContain('By month');
    expect(screen).toContain(projectName);
    expect(screen).toContain('&by=project&format=csv');
    // The schedule form is handed this report and its grouping.
    expect(screen).toContain('rs.' + suffix + '@test.local');
  });
});
