import { randomBytes } from 'node:crypto';
import { Queue } from 'bullmq';
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
import { mockOutbox } from '@/lib/mailer';
import { invalidateActors } from '@/lib/auth/actorCache';
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

const person = async (key: string, grants: [string, 'VIEW' | 'EXPORT'][]) => {
  const role = await prisma.role.create({ data: { tenantId, key: `${key}-${suffix}`, name: key, rank: 50 } });
  await grantPermissions(tenantId, role.id, grants);
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
  viewer = await person('sched-viewer', [['reports', 'VIEW']]);
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
