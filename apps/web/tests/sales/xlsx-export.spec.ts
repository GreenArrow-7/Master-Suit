/**
 * Excel downloads (M16-15): `format=xlsx` on the report, lead and HR report
 * exports, and on a scheduled report email, answers a real workbook with the
 * CSV's columns and rows, behind the same permission and the same audit row.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readSheet } from 'read-excel-file/node';

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
import { mockOutbox } from '@/lib/mailer';
import type { PermissionAction } from '@prisma/client';
import { handleJob } from '@/workers/jobs';
import { GET as reportRoute } from '@/app/api/v1/reports/route';
import { GET as exportLeads } from '@/app/api/v1/leads/export/route';
import { GET as hrExport } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/reports/[reportKey]/export/route';
import { POST as schedule } from '@/app/api/v1/reports/schedules/route';
import ReportsPage from '@/app/(workspace)/[workspaceSlug]/sales/reports/page';
import { createEmployee, createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { leadEagleWorkspace } from '../helpers/leadSource';
import { pageText } from '../helpers/render';
import { post } from '../helpers/request';
import { createSessionToken } from '../helpers/session';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const tag = () => randomBytes(3).toString('hex');

const MANAGER: [string, PermissionAction][] = [
  ['reports', 'VIEW'],
  ['reports', 'EXPORT'],
  ['leads', 'VIEW'],
  ['leads', 'EXPORT'],
  ['employee', 'VIEW'],
  ['attendance', 'VIEW'],
];

let ws: Awaited<ReturnType<typeof leadEagleWorkspace>>;
let tenantId: string;
let viewer: string;

/** A download as `cookie`: status, headers and body bytes. */
async function download(res: Response) {
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
}
const report = (cookie: string, query: string) =>
  reportRoute(new Request(`http://localhost/api/v1/reports?${query}`, { headers: { cookie } }), {
    params: Promise.resolve({}),
  }).then(download);
const leads = (cookie: string, query: string) =>
  exportLeads(new Request(`http://localhost/api/v1/leads/export?${query}`, { headers: { cookie } }), {
    params: Promise.resolve({}),
  }).then(download);
const hr = (query: string) =>
  hrExport(
    new Request(`http://localhost/api/v1/workspaces/${ws.slug}/hr/reports/attendance-summary/export?${query}`, {
      headers: { cookie: ws.cookie },
    }),
    { params: Promise.resolve({ workspaceSlug: ws.slug, reportKey: 'attendance-summary' }) },
  ).then(download);

/** CSV lines without the BOM, split into cells (none of these values holds a comma or a quote). */
const csvRows = (body: Buffer) =>
  body
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trim()
    .split('\r\n')
    .map((line) => line.split(',').map((cell) => cell.replace(/^"|"$/g, '')));

const audits = (objectType: string) =>
  prisma.auditLog.findMany({
    where: { tenantId, event: 'EXPORT_REQUESTED', objectType },
    orderBy: { occurredAt: 'asc' },
  });

beforeAll(async () => {
  ws = await leadEagleWorkspace('xlsx', MANAGER);
  tenantId = ws.tenantId;
  const stageId = (await prisma.leadStage.findFirstOrThrow({ where: { tenantId, isDefault: true } })).id;
  for (const [i, fullName] of ['Ayla Export', '=HYPERLINK("http://x")', 'Basel Export'].entries()) {
    await prisma.lead.create({
      data: { tenantId, reference: `XL-${tag()}`, fullName, stageId, ownerId: ws.userId, score: 10 * (i + 1) },
    });
  }
  const worker = await createEmployee({ tenantId, label: 'Clocker', suffix: tag() });
  await prisma.hrAttendanceRecord.create({
    data: { tenantId, employeeId: worker.employeeId, workDate: new Date('2026-10-05'), workMinutes: 480 },
  });
  const role = await prisma.role.create({ data: { tenantId, key: `viewer-${tag()}`, name: 'Viewer', rank: 80 } });
  await grantPermissions(tenantId, role.id, [
    ['reports', 'VIEW'],
    ['leads', 'VIEW'],
  ]);
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `viewer-${tag()}@xlsx.test`,
    fullName: 'V',
  });
  viewer = await createSessionToken(tenantId, user.id);
});

afterAll(async () => {
  await ws.cleanup();
});

describe('a report as Excel', () => {
  it('is a workbook of the CSV’s columns and rows, numbers as numbers, audited the same', async () => {
    const csv = await report(ws.cookie, 'report=pipeline-summary&format=csv');
    const file = await report(ws.cookie, 'report=pipeline-summary&format=xlsx');
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe(XLSX);
    expect(file.headers.get('content-disposition')).toMatch(
      /^attachment; filename="pipeline-summary-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );
    expect(file.headers.get('cache-control')).toBe('no-store');
    expect(file.body.subarray(0, 2).toString()).toBe('PK');

    const sheet = await readSheet(file.body);
    const lines = csvRows(csv.body);
    expect(sheet).toHaveLength(lines.length);
    expect(sheet[0]).toEqual(lines[0]);
    // The CSV's text, the workbook's numbers.
    expect(sheet.slice(1).map((row) => row.map((cell) => (cell === null ? '' : String(cell))))).toEqual(lines.slice(1));
    expect(sheet.slice(1).some((row) => row.some((cell) => typeof cell === 'number'))).toBe(true);

    const rows = await audits('report');
    expect(rows.map((r) => (r.metadata as { format: string }).format)).toEqual(['csv', 'xlsx']);
  });

  it('needs EXPORT, as the CSV does', async () => {
    expect((await report(viewer, 'report=pipeline-summary&format=xlsx')).status).toBe(403);
    expect((await report(viewer, 'report=pipeline-summary&format=csv')).status).toBe(403);
    expect((await report(viewer, 'report=pipeline-summary&format=pdf')).status).toBe(422);
  });

  it('has its Excel link beside the CSV one', async () => {
    jar.cookie = ws.cookie;
    jar.path = `/${ws.slug}/lead-eagle/reports`;
    const text = await pageText(ReportsPage({ searchParams: Promise.resolve({ report: 'pipeline-summary' }) }));
    expect(text).toContain('/api/v1/reports?report=pipeline-summary&format=csv');
    expect(text).toContain('/api/v1/reports?report=pipeline-summary&format=xlsx');
    expect(text).toContain('Excel');
  });
});

describe('the lead export as Excel', () => {
  it('streams the grid’s rows as a workbook, formulas kept as text, audited the same', async () => {
    const csv = await leads(ws.cookie, 'cols=reference,fullName,score');
    const file = await leads(ws.cookie, 'cols=reference,fullName,score&format=xlsx');
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe(XLSX);
    expect(file.headers.get('content-disposition')).toMatch(/^attachment; filename="leads-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    expect(file.body.subarray(0, 2).toString()).toBe('PK');

    const sheet = await readSheet(file.body);
    const lines = csvRows(csv.body);
    expect(sheet).toHaveLength(4);
    expect(sheet).toHaveLength(lines.length);
    expect(sheet[0]).toEqual(lines[0]);
    // The CSV blunts a formula with an apostrophe; the workbook holds the text as text.
    expect(lines.map((line) => line[1])).toContain(`'=HYPERLINK(""http://x"")`);
    expect(sheet.map((row) => row[1])).toContain('=HYPERLINK("http://x")');
    expect(sheet.slice(1).map((row) => row[2])).toEqual(expect.arrayContaining([10, 20, 30]));

    const rows = await audits('leads');
    expect(rows.map((r) => (r.metadata as { format: string; rows: number }).format)).toEqual(['csv', 'xlsx']);
    expect(rows.map((r) => (r.metadata as { rows: number }).rows)).toEqual([3, 3]);
  });

  it('needs EXPORT, as the CSV does', async () => {
    expect((await leads(viewer, 'format=xlsx')).status).toBe(403);
  });
});

describe('an HR report as Excel', () => {
  it('answers the same rows as its CSV, audited the same', async () => {
    const csv = await hr('from=2026-10-01');
    const file = await hr('from=2026-10-01&format=xlsx');
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe(XLSX);
    expect(file.headers.get('content-disposition')).toMatch(/attendance-summary-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    expect(file.headers.get('x-row-count')).toBe(csv.headers.get('x-row-count'));
    const sheet = await readSheet(file.body);
    expect(sheet).toHaveLength(csvRows(csv.body).length);
    expect(sheet.flat()).toContain(8);

    const rows = await audits('hr_report');
    expect(rows.map((r) => (r.metadata as { format: string }).format)).toEqual(['csv', 'xlsx']);
    expect((await hr('format=pdf')).status).toBe(422);
  });
});

describe('a scheduled report as Excel', () => {
  it('mails the workbook when the schedule asks for it', async () => {
    const email = (await prisma.user.findFirstOrThrow({ where: { tenantId, id: ws.userId } })).email;
    const made = await post(
      schedule,
      '/api/v1/reports/schedules',
      { report: 'pipeline-summary', cadence: 'DAILY', format: 'xlsx', recipients: [email] },
      ws.cookie,
      {},
    );
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({ format: 'xlsx' });
    await prisma.reportSchedule.updateMany({ where: { tenantId }, data: { nextRunAt: new Date(Date.now() - 60_000) } });

    mockOutbox.clear();
    await handleJob('maintenance', { name: 'report-schedules', data: { tenantIds: [tenantId] } });
    const mail = mockOutbox.lastTo(email);
    expect(mail?.body).toContain('attached as an Excel workbook');
    const [attachment] = mail!.attachments!;
    expect(attachment!.filename).toMatch(/^pipeline-summary-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(attachment!.contentType).toBe(XLSX);
    expect(attachment!.encoding).toBe('base64');
    const sheet = await readSheet(Buffer.from(attachment!.content, 'base64'));
    expect(sheet[0]![0]).toBe('Stage');

    const sent = (await audits('report')).filter((r) => (r.metadata as { scheduleId?: string }).scheduleId);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.metadata).toMatchObject({ format: 'xlsx', recipients: 1 });
  });

  it('keeps a schedule made without a format on the CSV', async () => {
    const email = (await prisma.user.findFirstOrThrow({ where: { tenantId, id: ws.userId } })).email;
    const made = await post(
      schedule,
      '/api/v1/reports/schedules',
      { report: 'lead-conversion', cadence: 'WEEKLY', recipients: [email] },
      ws.cookie,
      {},
    );
    expect(made.body).toMatchObject({ format: 'csv' });
    const bad = await post(
      schedule,
      '/api/v1/reports/schedules',
      { report: 'lead-conversion', cadence: 'WEEKLY', format: 'pdf', recipients: [email] },
      ws.cookie,
      {},
    );
    expect(bad.status).toBe(422);
  });
});
