import { randomBytes } from 'node:crypto';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
// A mail server that refuses the addresses listed here, as SMTP does with a 4xx.
const refused = vi.hoisted(() => new Set<string>());
vi.mock('@/lib/mailer', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/mailer')>();
  return {
    ...real,
    sendMail: async (to: string, ...rest: [string, string, Parameters<typeof real.sendMail>[3]?]) => {
      if (refused.has(to)) throw new Error('451 try again later');
      return real.sendMail(to, ...rest);
    },
  };
});
import { prisma } from '@/lib/db';
import { mockOutbox } from '@/lib/mailer';
import { invalidateActors } from '@/lib/auth/actorCache';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import { handleJob } from '@/workers/jobs';
import { GET as list, POST as create } from '@/app/api/v1/reports/schedules/route';
import { DELETE as remove } from '@/app/api/v1/reports/schedules/[id]/route';
import { nextRunAt, periodOf } from '@/services/leadership/reportSchedules';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { del, get, post } from '../helpers/request';
import { pageText } from '../helpers/render';
import ReportsPage from '@/app/(workspace)/[workspaceSlug]/sales/reports/page';

/**
 * Scheduled report emails (M16-16): a schedule names a report, a cadence and
 * workspace members to send it to; the maintenance sweep runs it as its
 * creator and mails the CSV, audited as an export.
 */
const suffix = randomBytes(4).toString('hex');
const TZ = 'Asia/Dubai';
let fixture: Fixture;
let tenantId: string;

const person = async (
  key: string,
  grants: [string, 'VIEW' | 'EXPORT'][],
  scope: 'OWN' | 'ORGANIZATION' = 'ORGANIZATION',
) => {
  const role = await prisma.role.create({ data: { tenantId, key: `${key}-${suffix}`, name: key, rank: 50 } });
  await grantPermissions(tenantId, role.id, grants, scope);
  const email = `${key}.${suffix}@test.local`;
  const user = await createWorkspaceUser({ tenantId, roleId: role.id, email, fullName: key });
  return { id: user.id, email, cookie: await createSessionToken(tenantId, user.id) };
};
let exporter: Awaited<ReturnType<typeof person>>;
let viewer: Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  exporter = await person('sched-exporter', [
    ['reports', 'VIEW'],
    ['reports', 'EXPORT'],
  ]);
  // Every report and every call: whatever its creator sees.
  viewer = await person('sched-viewer', [
    ['reports', 'VIEW'],
    ['calls', 'VIEW'],
  ]);
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('when a schedule sends, and what period it covers', () => {
  const dubai = (iso: string) => new Date(`${iso}+04:00`);

  it('daily at 07:00 on the workspace clock, covering yesterday', () => {
    expect(nextRunAt('DAILY', TZ, dubai('2026-10-14T06:00:00'))).toEqual(dubai('2026-10-14T07:00:00'));
    expect(nextRunAt('DAILY', TZ, dubai('2026-10-14T08:00:00'))).toEqual(dubai('2026-10-15T07:00:00'));
    expect(periodOf('DAILY', TZ, dubai('2026-10-15T07:00:00'))).toEqual({
      from: dubai('2026-10-14T00:00:00'),
      to: dubai('2026-10-14T23:59:59.999'),
    });
  });

  it('weekly on Monday, covering the week before', () => {
    // 14 Oct 2026 is a Wednesday.
    expect(nextRunAt('WEEKLY', TZ, dubai('2026-10-14T10:00:00'))).toEqual(dubai('2026-10-19T07:00:00'));
    expect(nextRunAt('WEEKLY', TZ, dubai('2026-10-19T07:00:00'))).toEqual(dubai('2026-10-26T07:00:00'));
    expect(periodOf('WEEKLY', TZ, dubai('2026-10-19T07:00:00'))).toEqual({
      from: dubai('2026-10-12T00:00:00'),
      to: dubai('2026-10-18T23:59:59.999'),
    });
  });

  it('monthly on the 1st, covering the month before', () => {
    expect(nextRunAt('MONTHLY', TZ, dubai('2026-10-14T10:00:00'))).toEqual(dubai('2026-11-01T07:00:00'));
    expect(nextRunAt('MONTHLY', TZ, dubai('2026-12-01T07:00:00'))).toEqual(dubai('2027-01-01T07:00:00'));
    expect(periodOf('MONTHLY', TZ, dubai('2026-11-01T07:00:00'))).toEqual({
      from: dubai('2026-10-01T00:00:00'),
      to: dubai('2026-10-31T23:59:59.999'),
    });
  });
});

describe('a weekly schedule', () => {
  let id: string;
  const path = '/api/v1/reports/schedules';

  it('is created by a role that may export, to members of the workspace', async () => {
    const res = await post(
      create,
      path,
      { report: 'call-report', by: 'lead', cadence: 'WEEKLY', recipients: [exporter.email.toUpperCase()] },
      exporter.cookie,
      {},
    );
    expect(res.status).toBe(200);
    id = res.body.id;
    expect(res.body).toMatchObject({
      report: 'call-report',
      by: 'lead',
      cadence: 'WEEKLY',
      recipients: [exporter.email],
    });
    // The next Monday, 07:00 in Dubai.
    const next = new Date(res.body.nextRunAt);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect(next.getUTCDay()).toBe(1);
    expect(next.getUTCHours()).toBe(3);

    const listed = await get(list, path, exporter.cookie, {});
    expect(listed.body.data.map((s: { id: string }) => s.id)).toEqual([id]);
  });

  it('shows on its creator’s Reports page, and on nobody else’s', async () => {
    cookieJar.value = exporter.cookie;
    const mine = await pageText(ReportsPage({ searchParams: Promise.resolve({}) }));
    expect(mine).toContain('Call Report by lead');
    expect(mine).toContain(exporter.email);
    cookieJar.value = viewer.cookie;
    expect(await pageText(ReportsPage({ searchParams: Promise.resolve({}) }))).not.toContain('Call Report by lead');
  });

  it('refuses an address outside the workspace, a grouping the report lacks, and a role without EXPORT', async () => {
    const body = { report: 'call-report', cadence: 'WEEKLY', recipients: [exporter.email] };
    expect(
      (await post(create, path, { ...body, recipients: ['someone@elsewhere.example'] }, exporter.cookie, {})).status,
    ).toBe(422);
    expect((await post(create, path, { ...body, by: 'project' }, exporter.cookie, {})).status).toBe(422);
    expect((await post(create, path, body, viewer.cookie, {})).status).toBe(403);
  });

  it('fires in the worker and mails the CSV, once, audited as an export', async () => {
    mockOutbox.clear();
    const due = new Date(Date.now() - 60_000);
    await prisma.reportSchedule.updateMany({ where: { tenantId, id }, data: { nextRunAt: due } });

    const result = await handleJob('maintenance', { name: 'report-schedules', data: { tenantIds: [tenantId] } });
    expect(result).toMatchObject({ sent: 1 });
    const mail = mockOutbox.lastTo(exporter.email);
    expect(mail?.subject).toContain('Call report');
    expect(mail?.attachments).toHaveLength(1);
    expect(mail!.attachments![0]!.filename).toMatch(/^call-report-by-lead-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(mail!.attachments![0]!.content.split('\r\n')[0]).toBe('﻿"Lead","Calls","Connected","Talk time (min)"');

    const schedule = await prisma.reportSchedule.findFirstOrThrow({ where: { tenantId, id } });
    expect(schedule.lastRunAt).not.toBeNull();
    expect(schedule.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    const audits = await prisma.auditLog.findMany({
      where: { tenantId, event: 'EXPORT_REQUESTED', recordId: 'call-report' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ scheduleId: id, recipients: 1, runAs: exporter.id });

    // Claimed: a second sweep straight after sends nothing.
    await handleJob('maintenance', { name: 'report-schedules', data: { tenantIds: [tenantId] } });
    expect(mockOutbox.all().filter((m) => m.to === exporter.email)).toHaveLength(1);
  });

  it('does not send once its creator may no longer export', async () => {
    mockOutbox.clear();
    const exportGrant = (granted: boolean) =>
      prisma.rolePermission
        .updateMany({
          where: {
            tenantId,
            permission: { module: 'reports', action: 'EXPORT' },
            role: { users: { some: { id: exporter.id } } },
          },
          data: { granted },
        })
        .then(() => invalidateActors(tenantId));
    await exportGrant(false);
    await prisma.reportSchedule.updateMany({
      where: { tenantId, id },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    });
    const result = await handleJob('maintenance', { name: 'report-schedules', data: { tenantIds: [tenantId] } });
    expect(result).toMatchObject({ sent: 0 });
    expect(mockOutbox.lastTo(exporter.email)).toBeUndefined();
    await exportGrant(true);
  });

  it('is deleted only by its creator; anyone else gets 404', async () => {
    const other = await person('sched-other', [
      ['reports', 'VIEW'],
      ['reports', 'EXPORT'],
    ]);
    expect((await del(remove, `${path}/${id}`, other.cookie, { id })).status).toBe(404);
    expect((await del(remove, `${path}/${id}`, exporter.cookie, { id })).status).toBe(200);
    expect(await prisma.reportSchedule.count({ where: { tenantId, id } })).toBe(0);
  });

  it('is swept from the maintenance queue every quarter hour', async () => {
    const { armMaintenanceScheduler } = await import('@/workers/maintenance');
    const armed = vi.spyOn(Queue.prototype, 'upsertJobScheduler').mockResolvedValue(undefined as never);
    try {
      await armMaintenanceScheduler();
      expect(armed).toHaveBeenCalledWith(
        'report-schedules-quarter-hourly',
        { pattern: '*/15 * * * *' },
        { name: 'report-schedules' },
      );
    } finally {
      armed.mockRestore();
    }
  });
});

describe('what a schedule may send, and to whom', () => {
  const path = '/api/v1/reports/schedules';
  const sweep = () => handleJob('maintenance', { name: 'report-schedules', data: { tenantIds: [tenantId] } });
  /** A schedule already due, made directly: what the sweep does with one saved before a change. */
  const due = (createdById: string, recipients: string[]) =>
    prisma.reportSchedule.create({
      data: {
        tenantId,
        reportKey: 'call-report',
        cadence: 'DAILY',
        recipients,
        nextRunAt: new Date(Date.now() - 60_000),
        createdById,
      },
    });
  const auditsOf = async (scheduleId: string) =>
    (
      await prisma.auditLog.findMany({ where: { tenantId, event: 'EXPORT_REQUESTED', recordId: 'call-report' } })
    ).filter((a) => (a.metadata as { scheduleId?: string } | null)?.scheduleId === scheduleId);

  beforeEach(() => mockOutbox.clear());
  afterEach(() => prisma.reportSchedule.deleteMany({ where: { tenantId } }));

  it('a role that may export but not view reports can neither make one nor have one sent', async () => {
    const exportOnly = await person('sched-export-only', [['reports', 'EXPORT']]);
    const body = { report: 'call-report', by: 'lead', cadence: 'DAILY', recipients: [exportOnly.email] };
    expect((await post(create, path, body, exportOnly.cookie, {})).status).toBe(403);

    await due(exportOnly.id, [exportOnly.email]);
    expect(await sweep()).toMatchObject({ sent: 0 });
    expect(mockOutbox.lastTo(exportOnly.email)).toBeUndefined();
  });

  it('refuses, and never sends to, a member who may not see what its creator sees', async () => {
    const ownOnly = await person('sched-own-viewer', [['reports', 'VIEW']], 'OWN');
    const noReports = await person('sched-no-reports', [['leads', 'VIEW']]);
    const body = { report: 'call-report', by: 'lead', cadence: 'DAILY' };
    for (const member of [ownOnly, noReports]) {
      const res = await post(create, path, { ...body, recipients: [member.email] }, exporter.cookie, {});
      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).toContain(member.email);
    }
    // A member who sees the whole workspace, as its creator does, may have it.
    expect((await post(create, path, { ...body, recipients: [viewer.email] }, exporter.cookie, {})).status).toBe(200);
    await prisma.reportSchedule.deleteMany({ where: { tenantId } });

    const schedule = await due(exporter.id, [exporter.email, ownOnly.email, noReports.email]);
    expect(await sweep()).toMatchObject({ sent: 1 });
    expect(mockOutbox.lastTo(exporter.email)).toBeDefined();
    expect(mockOutbox.lastTo(ownOnly.email)).toBeUndefined();
    expect(mockOutbox.lastTo(noReports.email)).toBeUndefined();
    expect((await auditsOf(schedule.id))[0]!.metadata).toMatchObject({ recipients: 1 });
  });

  it('sends a report that reads calls only to members whose calls reach covers its creator’s', async () => {
    const callsExporter = await person('sched-calls-exporter', [
      ['reports', 'VIEW'],
      ['reports', 'EXPORT'],
      ['calls', 'VIEW'],
    ]);
    // Every report, but no calls grant: on the screen, their own calls only.
    const noCalls = await person('sched-no-calls', [['reports', 'VIEW']]);
    const body = { cadence: 'DAILY', recipients: [noCalls.email] };
    for (const report of ['call-performance', 'call-report', 'rep-activity']) {
      const res = await post(create, path, { ...body, report }, callsExporter.cookie, {});
      expect(res.status, report).toBe(422);
      expect(JSON.stringify(res.body)).toContain(noCalls.email);
    }
    // A report that reads no calls reaches them; one that does reaches a member who sees every call.
    expect((await post(create, path, { ...body, report: 'site-visits' }, callsExporter.cookie, {})).status).toBe(200);
    const toViewer = { ...body, report: 'call-performance', recipients: [viewer.email] };
    expect((await post(create, path, toViewer, callsExporter.cookie, {})).status).toBe(200);
    await prisma.reportSchedule.deleteMany({ where: { tenantId } });

    // One saved before the rule: the sweep leaves them out.
    await due(callsExporter.id, [callsExporter.email, noCalls.email]);
    expect(await sweep()).toMatchObject({ sent: 1 });
    expect(mockOutbox.lastTo(callsExporter.email)).toBeDefined();
    expect(mockOutbox.lastTo(noCalls.email)).toBeUndefined();
  });

  it('sends nothing for a suspended workspace, or one without a lead module, and moves on', async () => {
    const suspended = await due(exporter.id, [exporter.email]);
    await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    try {
      expect(await sweep()).toMatchObject({ sent: 0 });
    } finally {
      await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
    }
    expect(mockOutbox.lastTo(exporter.email)).toBeUndefined();
    // Claimed all the same: it does not hold a place in every quarter hour's batch.
    const after = await prisma.reportSchedule.findFirstOrThrow({ where: { tenantId, id: suspended.id } });
    expect(after.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    await prisma.reportSchedule.deleteMany({ where: { tenantId } });

    await due(exporter.id, [exporter.email]);
    const entitlements = await prisma.moduleEntitlement.findMany({ where: { tenantId } });
    await prisma.moduleEntitlement.updateMany({ where: { tenantId }, data: { state: 'CANCELED' } });
    await invalidateEntitlements(tenantId);
    try {
      expect(await sweep()).toMatchObject({ sent: 0 });
    } finally {
      for (const e of entitlements) {
        await prisma.moduleEntitlement.updateMany({ where: { tenantId, id: e.id }, data: { state: e.state } });
      }
      await invalidateEntitlements(tenantId);
    }
    expect(mockOutbox.lastTo(exporter.email)).toBeUndefined();
  });

  it('audits the copies that went out when a later address is refused', async () => {
    refused.add(viewer.email);
    try {
      const schedule = await due(exporter.id, [exporter.email, viewer.email]);
      expect(await sweep()).toMatchObject({ sent: 0 });
      expect(mockOutbox.lastTo(exporter.email)).toBeDefined();
      const audits = await auditsOf(schedule.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.metadata).toMatchObject({ recipients: 1 });
    } finally {
      refused.clear();
    }
  });
});
