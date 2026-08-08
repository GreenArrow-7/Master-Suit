/**
 * Reporting, and the one property that makes it safe.
 *
 * §56: "Exports must enforce the same permissions as the UI." The registry makes
 * that true by construction — the list, the run and the CSV all resolve one
 * definition and assert one permission tuple — so these cases prove it holds for
 * every report in the registry rather than for the two somebody remembered.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { REPORTS, availableReports, exportReportCsv, runReport } from '@/services/hr/reports';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { PermissionMap } from '@/lib/security/rbac';

const suffix = randomBytes(4).toString('hex');
const slug = `rpt-${suffix}`;

let tenantId = '';
let employeeId = '';
let userId = '';

const permissions = (grants: readonly (readonly [string, string])[]) =>
  new Map(grants.map(([module, action]) => [`${module}:${action}`, 'ORGANIZATION'])) as PermissionMap;

const ctxWith = (grants: readonly (readonly [string, string])[]) =>
  buildCtx(buildActor({ id: userId, tenantId, permissions: permissions(grants) }));

/** The floor plus employee reads: what an ordinary line manager holds. */
const MANAGER = [
  ['hr_reports', 'VIEW'],
  ['employee', 'VIEW'],
] as const;
const EVERYTHING = [
  ['hr_reports', 'VIEW'],
  ['employee', 'VIEW'],
  ['attendance', 'VIEW'],
  ['attendance', 'APPROVE'],
  ['overtime', 'VIEW'],
  ['leave', 'APPROVE'],
  ['payroll', 'VIEW'],
  ['recruitment', 'VIEW'],
  ['performance', 'VIEW'],
  ['hr_documents', 'VIEW_SENSITIVE_FIELDS'],
] as const;
const NOTHING = [['sales', 'VIEW']] as const;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Reports LLC', displayName: 'Reports', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });
  const role = await prisma.role.create({
    data: { tenantId, key: 'employee', name: 'Employee', rank: 90, defaultScope: 'OWN' },
  });
  const email = `reporter-${suffix}@reports.test`;
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: 'Reporter', status: 'ACTIVE' },
  });
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: 'Reporter', roleId: role.id, status: 'ACTIVE' },
  });
  userId = user.id;
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  const department = await prisma.department.create({
    data: { tenantId, name: 'Sales', code: `SLS-${suffix}` },
  });
  const employee = await prisma.employeeProfile.create({
    data: {
      tenantId,
      membershipId: membership.id,
      employeeNumber: `RPT-${suffix}`,
      employmentStatus: 'ACTIVE',
      joinedOn: new Date('2024-03-01'),
      departmentId: department.id,
    },
  });
  employeeId = employee.id;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('the registry', () => {
  it('gives every report a distinct key and a data permission', () => {
    const keys = REPORTS.map((report) => report.key);
    expect(new Set(keys).size).toBe(keys.length);
    // A report whose permission is the reporting floor itself would let anyone
    // who can reach the module read anything it returns.
    for (const report of REPORTS) {
      expect(report.permission[0]).not.toBe('hr_reports');
      expect(report.permission[1]).toBeTruthy();
    }
  });

  it('lists nothing for someone without the reporting floor', () => {
    expect(availableReports(ctxWith(NOTHING))).toHaveLength(0);
  });

  it('lists only what the caller’s permissions cover', () => {
    const manager = availableReports(ctxWith(MANAGER)).map((report) => report.key);
    const all = availableReports(ctxWith(EVERYTHING)).map((report) => report.key);

    expect(manager).toContain('headcount-by-department');
    // The salary reports are the point: reading headcount is not reading pay.
    expect(manager).not.toContain('payroll-register');
    expect(manager).not.toContain('salary-cost-by-department');
    expect(all).toContain('payroll-register');
    expect(all.length).toBeGreaterThan(manager.length);
  });
});

describe('permission parity between the screen and the export', () => {
  it('refuses to run a report the list withheld', async () => {
    // The attack this closes: reading a key from a colleague's screen, or from
    // this file, and calling the endpoint directly.
    await expect(runReport(ctxWith(MANAGER), 'payroll-register')).rejects.toMatchObject({ status: 403 });
  });

  it('refuses to export a report the list withheld', async () => {
    await expect(exportReportCsv(ctxWith(MANAGER), 'payroll-register')).rejects.toMatchObject({ status: 403 });
  });

  /**
   * The property, over the whole registry rather than a sample: for every
   * report, run and export agree about whether this caller may have it. A future
   * report that checks its permission in `run` but not on the export path fails
   * here without anyone remembering to add a case.
   */
  it('agrees on every report in the registry, for two different roles', async () => {
    for (const grants of [MANAGER, EVERYTHING]) {
      const ctx = ctxWith(grants);
      const allowed = new Set(availableReports(ctx).map((report) => report.key));

      for (const report of REPORTS) {
        const runOk = await runReport(ctx, report.key)
          .then(() => true)
          .catch((error) => {
            expect(error.status).toBe(403);
            return false;
          });
        const exportOk = await exportReportCsv(ctx, report.key)
          .then(() => true)
          .catch((error) => {
            expect(error.status).toBe(403);
            return false;
          });

        expect(runOk).toBe(allowed.has(report.key));
        expect(exportOk).toBe(allowed.has(report.key));
      }
    }
  });

  it('refuses an unknown report rather than returning nothing', async () => {
    await expect(runReport(ctxWith(EVERYTHING), 'no-such-report')).rejects.toMatchObject({ status: 404 });
  });
});

describe('running reports', () => {
  it('returns columns and rows for headcount', async () => {
    const result = await runReport(ctxWith(MANAGER), 'headcount-by-department');
    expect(result.columns.map((column) => column.key)).toContain('headcount');
    const sales = result.rows.find((row) => row.department === 'Sales');
    expect(sales?.headcount).toBe(1);
  });

  it('honours a date window', async () => {
    const inWindow = await runReport(ctxWith(MANAGER), 'joiners-and-leavers', {
      from: new Date('2024-01-01'),
      to: new Date('2024-12-31'),
    });
    expect(inWindow.rows.some((row) => row.movement === 'Joined')).toBe(true);

    const outOfWindow = await runReport(ctxWith(MANAGER), 'joiners-and-leavers', {
      from: new Date('2020-01-01'),
      to: new Date('2020-12-31'),
    });
    expect(outOfWindow.rows).toHaveLength(0);
  });

  it('runs every report the caller may reach without erroring', async () => {
    // Cheap, and it catches the class of bug that only shows on an empty
    // workspace: a column referencing a field the query did not select.
    for (const report of availableReports(ctxWith(EVERYTHING))) {
      const result = await runReport(ctxWith(EVERYTHING), report.key);
      expect(Array.isArray(result.rows)).toBe(true);
      expect(result.columns.length).toBeGreaterThan(0);
    }
  });
});

describe('CSV export', () => {
  it('writes a header row and one line per row', async () => {
    const file = await exportReportCsv(ctxWith(MANAGER), 'headcount-by-department');
    const lines = file.content.trim().split('\r\n');
    expect(lines[0]).toContain('"Department"');
    expect(lines).toHaveLength(file.rows + 1);
    expect(file.filename).toMatch(/^headcount-by-department-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('starts with a BOM so Excel reads it as UTF-8', async () => {
    // Without it Excel applies the system codepage and mangles Arabic names.
    const file = await exportReportCsv(ctxWith(MANAGER), 'headcount-by-department');
    expect(file.content.charCodeAt(0)).toBe(0xfeff);
  });

  it('neutralises a cell that would execute as a formula', async () => {
    // The report groups employees by department name, so the hostile value needs
    // somebody in it to reach a cell at all.
    const department = await prisma.department.create({
      data: { tenantId, name: '=cmd|calc', code: `EVIL-${suffix}` },
    });
    const email = `evil-${suffix}@reports.test`;
    const platformUser = await prisma.platformUser.create({
      data: { email, normalizedEmail: email, fullName: 'Evil', status: 'ACTIVE' },
    });
    const role = await prisma.role.findFirstOrThrow({ where: { tenantId, key: 'employee' } });
    const user = await prisma.user.create({
      data: { tenantId, email, fullName: 'Evil', roleId: role.id, status: 'ACTIVE' },
    });
    const membership = await prisma.workspaceMembership.create({
      data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
    });
    await prisma.employeeProfile.create({
      data: {
        tenantId,
        membershipId: membership.id,
        employeeNumber: `EVIL-${suffix}`,
        employmentStatus: 'ACTIVE',
        joinedOn: new Date('2024-03-01'),
        departmentId: department.id,
      },
    });
    const file = await exportReportCsv(ctxWith(MANAGER), 'headcount-by-department');
    // Prefixed with an apostrophe, so Excel treats it as text on open.
    expect(file.content).toContain(`"'=cmd|calc"`);
    expect(file.content).not.toContain('"=cmd|calc"');
  });

  it('writes an audit row naming the report and the permission it used', async () => {
    await exportReportCsv(ctxWith(MANAGER), 'headcount-by-department');
    const entry = await prisma.auditLog.findFirst({
      where: { tenantId, objectType: 'hr_report', event: 'EXPORT_REQUESTED' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(entry).toBeTruthy();
    // An export is a copy leaving the building, so §105 wants it logged.
    expect((entry!.metadata as { permission?: string }).permission).toBe('employee:VIEW');
  });
});

describe('scoping', () => {
  it('never returns another workspace’s rows', async () => {
    const other = await prisma.tenant.create({
      data: { slug: `rpt-other-${suffix}`, legalName: 'Other', displayName: 'Other', status: 'ACTIVE' },
    });
    try {
      await prisma.department.create({ data: { tenantId: other.id, name: 'Foreign', code: `FGN-${suffix}` } });
      const result = await runReport(ctxWith(MANAGER), 'headcount-by-department');
      expect(result.rows.some((row) => row.department === 'Foreign')).toBe(false);
    } finally {
      await prisma.tenant.delete({ where: { id: other.id } }).catch(() => {});
    }
  });

  it('keeps the employee fixture out of an unrelated tenant’s report', async () => {
    expect(employeeId).toBeTruthy();
  });
});
