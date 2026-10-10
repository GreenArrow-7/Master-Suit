import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

import { prisma, withPlatformTx } from '@/lib/db';
import { runReport } from '@/services/leadership/reports';
import { GET as reportRoute } from '@/app/api/v1/reports/route';
import ReportsPage from '@/app/(workspace)/[workspaceSlug]/sales/reports/page';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { pageText } from '../helpers/render';
import { createSessionToken } from '../helpers/session';

/**
 * Lead Eagle plan, gap 7: follow-up adherence, and each source followed through
 * site visits to bookings — the two reports Lead Eagle had and this did not.
 */
const suffix = randomBytes(4).toString('hex');
const day = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * day);

let fixture: Fixture;
let tenantId: string;
const range = () => ({ from: at(-10), to: at(10) });
const ctx = () => buildCtx(buildActor({ id: fixture.a.userId, tenantId, grants: [['reports', 'VIEW']] }));

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  const owner = fixture.a.userId;
  const leadId = fixture.a.leadIds[0]!;
  const followUp = (dueAt: Date, extra: Record<string, unknown> = {}) =>
    prisma.followUpTask.create({ data: { tenantId, leadId, ownerId: owner, title: 'Call back', dueAt, ...extra } });
  await followUp(at(-5), { status: 'COMPLETED', completedAt: at(-6) });
  await followUp(at(-4), { status: 'COMPLETED', completedAt: at(-2) });
  await followUp(at(-3));
  await followUp(at(5));
  await followUp(at(-1), { status: 'CANCELLED' });

  const lead = (source: string, sourceDetail: string | null) =>
    prisma.lead.create({
      data: {
        tenantId,
        reference: `RP-${suffix}-${randomBytes(3).toString('hex')}`,
        fullName: 'Report lead',
        stageId: fixture.a.stageId,
        source: source as never,
        sourceDetail,
      },
    });
  const bayutOne = await lead('MARKETPLACE', 'bayut:REF-1');
  const bayutTwo = await lead('MARKETPLACE', 'bayut:REF-2');
  await lead('PUBLIC_FORM', 'capture:stand-a1b2c3');
  // A property visit goes somewhere (SiteVisit_destination_check).
  const project = await prisma.project.create({ data: { tenantId, name: 'Report project', code: `RP-${suffix}` } });
  await prisma.siteVisit.create({
    data: {
      tenantId,
      ownerId: owner,
      leadId: bayutOne.id,
      projectId: project.id,
      scheduledAt: at(-2),
      status: 'COMPLETED',
    },
  });
  // A confirmed booking names its unit (Booking_confirmed_requires_unit).
  const unit = await prisma.unitInventory.create({ data: { tenantId, projectId: project.id, unitNumber: 'U-1' } });
  const booking = (leadIdValue: string, status: 'CONFIRMED' | 'CANCELLED') =>
    prisma.booking.create({
      data: {
        tenantId,
        reference: `BK-${suffix}-${randomBytes(3).toString('hex')}`,
        leadId: leadIdValue,
        ownerId: owner,
        projectId: project.id,
        unitInventoryId: status === 'CONFIRMED' ? unit.id : null,
        status,
        saleValue: '1000000',
        bookingDate: at(-1),
      },
    });
  await booking(bayutOne.id, 'CONFIRMED');
  await booking(bayutTwo.id, 'CANCELLED');
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('Lead Eagle reports', () => {
  it('follow-up adherence: on time, late, still overdue, not yet due, cancelled left out', async () => {
    const report = await runReport(ctx(), 'follow-up-adherence', range());
    expect(report.rows).toEqual([
      { agent: 'manath Administrator', due: 4, done: 2, onTime: 1, late: 1, overdue: 1, rate: '25%' },
    ]);
  });

  it('source to booking: portals by name, visits and bookings, cancelled ones left out', async () => {
    const report = await runReport(ctx(), 'source-to-booking', range());
    const bySource = Object.fromEntries(report.rows.map((r) => [r.source, r]));
    expect(report.rows[0]!.source).toBe('Bayut');
    expect(bySource.Bayut).toMatchObject({ leads: 2, visited: 1, bookings: 1, value: 'AED 1,000,000', rate: '50%' });
    expect(bySource['QR capture']).toMatchObject({ leads: 1, visited: 0, bookings: 0, rate: '0%' });
    // The fixture's own leads carry the default source.
    expect(bySource.Manual).toMatchObject({ leads: 5, bookings: 0 });
  });
});

/**
 * Several reports carry lead names per row, so the file is a copy of personal
 * data leaving the building: EXPORT, not VIEW, and an audit row saying which
 * report and which period.
 */
describe('report CSV export', () => {
  const as = async (key: string, grants: [string, 'VIEW' | 'EXPORT'][]) => {
    const role = await prisma.role.create({ data: { tenantId, key: `${key}-${suffix}`, name: key, rank: 50 } });
    await grantPermissions(tenantId, role.id, grants);
    const user = await createWorkspaceUser({
      tenantId,
      roleId: role.id,
      email: `${key}.${suffix}@test.local`,
      fullName: key,
    });
    return { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
  };
  const { from, to } = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T00:00:00.000Z' };
  const download = (cookie: string, format: 'csv' | 'json') =>
    reportRoute(
      new Request(`http://localhost/api/v1/reports?report=follow-up-adherence&from=${from}&to=${to}&format=${format}`, {
        headers: { cookie },
      }),
      { params: Promise.resolve({}) },
    );

  const screen = (cookie: string) => {
    cookieJar.value = cookie;
    return pageText(ReportsPage({ searchParams: Promise.resolve({ report: 'follow-up-adherence', from, to }) }));
  };

  it('refuses the file to a role that may only view reports, and still shows it the report', async () => {
    const viewer = await as('report-viewer', [['reports', 'VIEW']]);
    expect((await download(viewer.cookie, 'csv')).status).toBe(403);
    expect((await download(viewer.cookie, 'json')).status).toBe(200);
    // No button that can only answer 403.
    const text = await screen(viewer.cookie);
    expect(text).toContain('Follow-up adherence');
    expect(text).not.toContain('Export CSV');
  });

  it('records who exported which report for which period', async () => {
    const exporter = await as('report-exporter', [
      ['reports', 'VIEW'],
      ['reports', 'EXPORT'],
    ]);
    expect(await screen(exporter.cookie)).toContain('Export CSV');
    const res = await download(exporter.cookie, 'csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');

    const rows = await prisma.auditLog.findMany({
      where: { tenantId, actorUserId: exporter.id, event: 'EXPORT_REQUESTED' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      objectType: 'report',
      recordId: 'follow-up-adherence',
      metadata: { report: 'follow-up-adherence', from, to, rows: expect.any(Number) },
    });
  });
});

/**
 * The grant that keeps today's report viewers able to download, run as written
 * with one condition added: only this spec's workspace.
 */
describe('the migration 20261011000000_reports_export_grant', () => {
  it('gives every role that views reports EXPORT at the same scope, and nothing to anyone else', async () => {
    const role = async (key: string, grants: [string, 'VIEW' | 'EXPORT'][], scope: 'TEAM' | 'ORGANIZATION') => {
      const created = await prisma.role.create({ data: { tenantId, key: `${key}-${suffix}`, name: key, rank: 50 } });
      await grantPermissions(tenantId, created.id, grants, scope);
      return created.id;
    };
    const viewer = await role('grant-viewer', [['reports', 'VIEW']], 'TEAM');
    const exporter = await role(
      'grant-exporter',
      [
        ['reports', 'VIEW'],
        ['reports', 'EXPORT'],
      ],
      'ORGANIZATION',
    );
    const other = await role('grant-other', [['leads', 'VIEW']], 'ORGANIZATION');

    const sql = readFileSync(
      path.join(__dirname, '..', '..', 'prisma', 'migrations', '20261011000000_reports_export_grant', 'migration.sql'),
      'utf8',
    ).replace('WHERE source."module"', `WHERE rp."tenantId" = '${tenantId}' AND source."module"`);
    await withPlatformTx((tx) => tx.$executeRawUnsafe(sql));

    const exportScope = async (roleId: string) =>
      (
        await prisma.rolePermission.findMany({
          where: { tenantId, roleId, permission: { module: 'reports', action: 'EXPORT' } },
          select: { scope: true },
        })
      ).map((r) => r.scope);
    expect(await exportScope(viewer)).toEqual(['TEAM']);
    expect(await exportScope(exporter)).toEqual(['ORGANIZATION']);
    expect(await exportScope(other)).toEqual([]);
  });
});
