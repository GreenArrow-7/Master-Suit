/**
 * HR reports honour the scope they were granted at.
 *
 * ── The failure this exists for ─────────────────────────────────────────────
 *
 * `resolve()` authorised with `can(ctx, module, action)`, and `can` is
 * `scopeFor(...) !== 'NONE'`. The granted scope was checked for existence and
 * then thrown away; every report queried `where: { tenantId }` and nothing else.
 *
 * The seeded `employee` role holds `payroll:VIEW` at **OWN**. During the
 * 2026-09-10 baseline an ordinary employee therefore exported the whole
 * workspace's payroll register — 9 payslips for 9 people, byte-identical to what
 * the payroll officer received. The reports page even told them "someone who can
 * read headcount cannot export salary cost".
 *
 * These tests assert behaviour: given a grant at a scope, how many people's rows
 * come back. They do not assert that any particular field or helper exists, so a
 * different implementation of the same rule still passes.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PermissionAction, VisibilityScope } from '@prisma/client';
import { prisma } from '@/lib/db';
import { availableReports, exportReportCsv, runReport } from '@/services/hr/reports';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { Ctx } from '@/lib/security/rbac';

const suffix = randomBytes(4).toString('hex');
const slug = `reportscope-${suffix}`;

let tenantId = '';
let teamId = '';
/** userId -> employeeId, so assertions can talk about people rather than rows. */
const people = new Map<string, { userId: string; employeeId: string; number: string }>();

async function person(label: string, inTeam: boolean) {
  const email = `${label}-${suffix}@scope.test`;
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 60, defaultScope: 'OWN' },
  });
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: label, roleId: role.id, status: 'ACTIVE' },
  });
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: label, status: 'ACTIVE' },
  });
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  const number = `E-${label}-${suffix}`;
  const employee = await prisma.employeeProfile.create({
    data: {
      tenantId,
      membershipId: membership.id,
      employeeNumber: number,
      joinedOn: new Date('2026-01-01T00:00:00Z'),
      employmentStatus: 'ACTIVE',
    },
  });
  if (inTeam) await prisma.userTeam.create({ data: { tenantId, userId: user.id, teamId } });
  people.set(label, { userId: user.id, employeeId: employee.id, number });
  return people.get(label)!;
}

/** A context holding one permission at one scope — the whole point of the test. */
function ctxAt(userId: string, scope: VisibilityScope, teamIds: string[] = []): Ctx {
  const grants: [string, PermissionAction][] = [
    ['payroll', 'VIEW'],
    ['employee', 'VIEW'],
    ['hr_reports', 'VIEW'],
  ];
  return buildCtx(
    buildActor({
      id: userId,
      tenantId,
      teamIds,
      permissions: new Map(grants.map(([m, a]) => [`${m}:${a}`, scope])),
    }),
  );
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Report Scope LLC', displayName: 'Report Scope', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });
  const team = await prisma.team.create({ data: { tenantId, name: 'Team One', code: `T-${suffix}` } });
  teamId = team.id;

  // Three people: the reader, a team-mate, and a stranger in no team.
  const reader = await person('reader', true);
  const mate = await person('mate', true);
  const stranger = await person('stranger', false);

  // One payroll run, one payslip each. The register is the report that matters.
  const run = await prisma.hrPayrollRun.create({
    data: {
      tenantId,
      periodStart: new Date('2026-08-01T00:00:00Z'),
      periodEnd: new Date('2026-08-31T00:00:00Z'),
      status: 'PAID',
      currency: 'AED',
    },
  });
  for (const p of [reader, mate, stranger]) {
    await prisma.hrPayslip.create({
      data: {
        tenantId,
        runId: run.id,
        employeeId: p.employeeId,
        basic: '10000',
        grossEarnings: '10000',
        totalDeductions: '0',
        netPay: '10000',
        currency: 'AED',
        inputs: {},
      },
    });
  }
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser
    .deleteMany({ where: { normalizedEmail: { endsWith: `-${suffix}@scope.test` } } })
    .catch(() => {});
});

const RANGE = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T00:00:00Z') };

/** Employee numbers present in a report's rows — who the caller actually saw. */
const seen = (rows: Record<string, unknown>[]) =>
  new Set(rows.map((r) => String(r.employeeNumber ?? '')).filter(Boolean));

describe('payroll register, by granted scope', () => {
  it('OWN scope returns only the reader’s own payslip', async () => {
    const reader = people.get('reader')!;
    const result = await runReport(ctxAt(reader.userId, 'OWN'), 'payroll-register', RANGE);
    expect(seen(result.rows)).toEqual(new Set([reader.number]));
  });

  it('TEAM scope returns the team, and not the stranger', async () => {
    const reader = people.get('reader')!;
    const mate = people.get('mate')!;
    const stranger = people.get('stranger')!;
    const result = await runReport(ctxAt(reader.userId, 'TEAM', [teamId]), 'payroll-register', RANGE);
    const numbers = seen(result.rows);
    expect(numbers.has(reader.number)).toBe(true);
    expect(numbers.has(mate.number)).toBe(true);
    expect(numbers.has(stranger.number)).toBe(false);
  });

  it('ORGANIZATION scope returns everyone — the roles that could always see all still can', async () => {
    const reader = people.get('reader')!;
    const result = await runReport(ctxAt(reader.userId, 'ORGANIZATION'), 'payroll-register', RANGE);
    expect(seen(result.rows).size).toBe(3);
  });
});

describe('the CSV export cannot widen what the screen showed', () => {
  it('exports exactly the rows the report returned, at OWN scope', async () => {
    const reader = people.get('reader')!;
    const ctx = ctxAt(reader.userId, 'OWN');
    const onScreen = await runReport(ctx, 'payroll-register', RANGE);
    const file = await exportReportCsv(ctx, 'payroll-register', RANGE);

    expect(file.rows).toBe(onScreen.rows.length);
    expect(file.content).toContain(reader.number);
    expect(file.content).not.toContain(people.get('mate')!.number);
    expect(file.content).not.toContain(people.get('stranger')!.number);
  });
});

describe('grouped reports narrow too', () => {
  it('headcount counts only the people in scope', async () => {
    const reader = people.get('reader')!;
    const total = (rows: Record<string, unknown>[]) => rows.reduce((n, r) => n + Number(r.headcount ?? 0), 0);

    const own = await runReport(ctxAt(reader.userId, 'OWN'), 'headcount-by-department', {});
    const org = await runReport(ctxAt(reader.userId, 'ORGANIZATION'), 'headcount-by-department', {});

    expect(total(own.rows)).toBe(1);
    expect(total(org.rows)).toBe(3);
  });
});

describe('reports about the workspace rather than a person', () => {
  it('refuse below ORGANIZATION scope instead of returning everything', async () => {
    const reader = people.get('reader')!;
    const ctx = buildCtx(
      buildActor({
        id: reader.userId,
        tenantId,
        permissions: new Map([
          ['recruitment:VIEW', 'TEAM'],
          ['employee:VIEW', 'TEAM'],
        ]),
      }),
    );
    await expect(runReport(ctx, 'open-positions', {})).rejects.toThrow(/organization scope/i);
  });

  it('are not offered by the list endpoint either', async () => {
    const reader = people.get('reader')!;
    const ctx = buildCtx(
      buildActor({
        id: reader.userId,
        tenantId,
        permissions: new Map([
          ['recruitment:VIEW', 'TEAM'],
          ['employee:VIEW', 'TEAM'],
        ]),
      }),
    );
    expect(availableReports(ctx).map((r) => r.key)).not.toContain('open-positions');
  });
});

describe('the list endpoint describes what the caller can actually run', () => {
  it('offers nothing it would then refuse', async () => {
    const reader = people.get('reader')!;
    const ctx = ctxAt(reader.userId, 'OWN');
    for (const report of availableReports(ctx)) {
      await expect(runReport(ctx, report.key, RANGE)).resolves.toBeTruthy();
    }
  });
});
