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
let otherTenantId = '';
let teamId = '';
let otherTeamId = '';
let branchId = '';
let otherBranchId = '';
let regionId = '';
let otherRegionId = '';
/** userId -> employeeId, so assertions can talk about people rather than rows. */
const people = new Map<string, { userId: string; employeeId: string; number: string }>();

interface Placement {
  team?: string | null;
  branch?: string | null;
  region?: string | null;
  /** Create the User but no EmployeeProfile — the missing-linkage case. */
  unlinked?: boolean;
  tenant?: string;
}

async function person(label: string, place: Placement = {}) {
  const tid = place.tenant ?? tenantId;
  const email = `${label}-${suffix}@scope.test`;
  const role = await prisma.role.create({
    data: { tenantId: tid, key: `${label}-${suffix}`, name: label, rank: 60, defaultScope: 'OWN' },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tid,
      email,
      fullName: label,
      roleId: role.id,
      status: 'ACTIVE',
      branchId: place.branch ?? null,
      regionId: place.region ?? null,
    },
  });
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: label, status: 'ACTIVE' },
  });
  const membership = await prisma.workspaceMembership.create({
    data: {
      tenantId: tid,
      platformUserId: platformUser.id,
      salesUserId: user.id,
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });
  const number = `E-${label}-${suffix}`;
  // `unlinked` skips the EmployeeProfile: a sales user with no HR record, which
  // is a real state during onboarding and must not resolve to "everyone".
  const employee = place.unlinked
    ? null
    : await prisma.employeeProfile.create({
        data: {
          tenantId: tid,
          membershipId: membership.id,
          employeeNumber: number,
          joinedOn: new Date('2026-01-01T00:00:00Z'),
          employmentStatus: 'ACTIVE',
        },
      });
  if (place.team) await prisma.userTeam.create({ data: { tenantId: tid, userId: user.id, teamId: place.team } });
  people.set(label, { userId: user.id, employeeId: employee?.id ?? '', number });
  return people.get(label)!;
}

/** A context holding one permission at one scope — the whole point of the test. */
function ctxAt(
  userId: string,
  scope: VisibilityScope,
  where: { teamIds?: string[]; branchId?: string | null; regionId?: string | null; tenant?: string } = {},
): Ctx {
  const grants: [string, PermissionAction][] = [
    ['payroll', 'VIEW'],
    ['employee', 'VIEW'],
    ['hr_reports', 'VIEW'],
  ];
  return buildCtx(
    buildActor({
      id: userId,
      tenantId: where.tenant ?? tenantId,
      teamIds: where.teamIds ?? [],
      branchId: where.branchId ?? null,
      regionId: where.regionId ?? null,
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

  // Region 1 ─ Branch 1 ─ Team 1        reader, mate
  //          └ Branch 2 ─ Team 2        branchOutsider
  // Region 2 ─ Branch 3                 regionOutsider
  const region = await prisma.region.create({ data: { tenantId, name: 'R1', code: `R1-${suffix}` } });
  const region2 = await prisma.region.create({ data: { tenantId, name: 'R2', code: `R2-${suffix}` } });
  regionId = region.id;
  otherRegionId = region2.id;
  const branch = await prisma.branch.create({
    data: { tenantId, name: 'B1', code: `B1-${suffix}`, regionId: region.id },
  });
  const branch2 = await prisma.branch.create({
    data: { tenantId, name: 'B2', code: `B2-${suffix}`, regionId: region.id },
  });
  const branch3 = await prisma.branch.create({
    data: { tenantId, name: 'B3', code: `B3-${suffix}`, regionId: region2.id },
  });
  branchId = branch.id;
  otherBranchId = branch3.id;
  const team = await prisma.team.create({ data: { tenantId, name: 'T1', code: `T1-${suffix}`, branchId: branch.id } });
  const team2 = await prisma.team.create({
    data: { tenantId, name: 'T2', code: `T2-${suffix}`, branchId: branch2.id },
  });
  teamId = team.id;
  otherTeamId = team2.id;

  const reader = await person('reader', { team: teamId, branch: branchId, region: regionId });
  const mate = await person('mate', { team: teamId, branch: branchId, region: regionId });
  // Same region, different branch — visible at REGION, not at BRANCH.
  const branchOutsider = await person('branchOutsider', { team: otherTeamId, branch: branch2.id, region: regionId });
  // Different region entirely — visible only at ORGANIZATION.
  const regionOutsider = await person('regionOutsider', { branch: otherBranchId, region: otherRegionId });
  // In no team, no branch, no region.
  const stranger = await person('stranger', {});
  // A sales user with no EmployeeProfile at all.
  await person('unlinked', { team: teamId, branch: branchId, region: regionId, unlinked: true });

  // A second workspace, to prove cross-workspace denial rather than assume it.
  const other = await prisma.tenant.create({
    data: { slug: `${slug}-other`, legalName: 'Other LLC', displayName: 'Other', status: 'ACTIVE' },
  });
  otherTenantId = other.id;
  await prisma.moduleEntitlement.create({ data: { tenantId: otherTenantId, module: 'HRMS', state: 'ACTIVE' } });
  const foreigner = await person('foreigner', { tenant: otherTenantId });

  const run = await prisma.hrPayrollRun.create({
    data: {
      tenantId,
      periodStart: new Date('2026-08-01T00:00:00Z'),
      periodEnd: new Date('2026-08-31T00:00:00Z'),
      status: 'PAID',
      currency: 'AED',
    },
  });
  for (const p of [reader, mate, branchOutsider, regionOutsider, stranger]) {
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

  // One payslip in the *other* workspace, so a leak would be visible.
  const otherRun = await prisma.hrPayrollRun.create({
    data: {
      tenantId: otherTenantId,
      periodStart: new Date('2026-08-01T00:00:00Z'),
      periodEnd: new Date('2026-08-31T00:00:00Z'),
      status: 'PAID',
      currency: 'AED',
    },
  });
  await prisma.hrPayslip.create({
    data: {
      tenantId: otherTenantId,
      runId: otherRun.id,
      employeeId: foreigner.employeeId,
      basic: '99999',
      grossEarnings: '99999',
      totalDeductions: '0',
      netPay: '99999',
      currency: 'AED',
      inputs: {},
    },
  });
});

afterAll(async () => {
  if (otherTenantId) await prisma.tenant.delete({ where: { id: otherTenantId } }).catch(() => {});
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser
    .deleteMany({ where: { normalizedEmail: { endsWith: `-${suffix}@scope.test` } } })
    .catch(() => {});
});

const RANGE = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T00:00:00Z') };

/** Employee numbers present in a report's rows — who the caller actually saw. */
const seen = (rows: Record<string, unknown>[]) =>
  new Set(rows.map((r) => String(r.employeeNumber ?? '')).filter(Boolean));

const who = (label: string) => people.get(label)!;

/** The reader, placed in team 1 / branch 1 / region 1, at a given scope. */
const readerAt = (scope: VisibilityScope) =>
  ctxAt(who('reader').userId, scope, { teamIds: [teamId], branchId, regionId });

describe('payroll register, by granted scope', () => {
  it('OWN returns only the reader', async () => {
    const result = await runReport(readerAt('OWN'), 'payroll-register', RANGE);
    expect(seen(result.rows)).toEqual(new Set([who('reader').number]));
  });

  it('TEAM returns the team and stops there', async () => {
    const numbers = seen((await runReport(readerAt('TEAM'), 'payroll-register', RANGE)).rows);
    expect(numbers).toEqual(new Set([who('reader').number, who('mate').number]));
    expect(numbers.has(who('branchOutsider').number)).toBe(false);
  });

  it('BRANCH adds the branch and stops there', async () => {
    const numbers = seen((await runReport(readerAt('BRANCH'), 'payroll-register', RANGE)).rows);
    expect(numbers.has(who('reader').number)).toBe(true);
    expect(numbers.has(who('mate').number)).toBe(true);
    // Same region, different branch.
    expect(numbers.has(who('branchOutsider').number)).toBe(false);
    expect(numbers.has(who('regionOutsider').number)).toBe(false);
  });

  it('REGION adds the other branch in the same region, and stops there', async () => {
    const numbers = seen((await runReport(readerAt('REGION'), 'payroll-register', RANGE)).rows);
    expect(numbers.has(who('branchOutsider').number)).toBe(true);
    // Different region.
    expect(numbers.has(who('regionOutsider').number)).toBe(false);
  });

  it('ORGANIZATION returns everyone — roles that always could still can', async () => {
    const numbers = seen((await runReport(readerAt('ORGANIZATION'), 'payroll-register', RANGE)).rows);
    expect(numbers.size).toBe(5);
    expect(numbers.has(who('regionOutsider').number)).toBe(true);
    expect(numbers.has(who('stranger').number)).toBe(true);
  });
});

describe('cross-workspace', () => {
  it('never returns another workspace’s payslips, even at ORGANIZATION scope', async () => {
    const numbers = seen((await runReport(readerAt('ORGANIZATION'), 'payroll-register', RANGE)).rows);
    expect(numbers.has(who('foreigner').number)).toBe(false);
  });

  it('a reader in the other workspace sees only their own workspace', async () => {
    const ctx = ctxAt(who('foreigner').userId, 'ORGANIZATION', { tenant: otherTenantId });
    const numbers = seen((await runReport(ctx, 'payroll-register', RANGE)).rows);
    expect(numbers).toEqual(new Set([who('foreigner').number]));
  });
});

describe('an explicit filter cannot widen visibility', () => {
  it('asking for a colleague outside scope returns nothing, not that colleague', async () => {
    const ctx = readerAt('OWN');
    const result = await runReport(ctx, 'payroll-register', { ...RANGE, employeeId: who('stranger').employeeId });
    expect(seen(result.rows).has(who('stranger').number)).toBe(false);
  });

  it('a department filter cannot reach outside the audience either', async () => {
    const result = await runReport(readerAt('TEAM'), 'payroll-register', { ...RANGE, departmentId: 'anything' });
    expect(seen(result.rows).has(who('regionOutsider').number)).toBe(false);
  });

  it('leave-balances honours its own employeeId filter without losing the narrowing', async () => {
    // This is the report whose `where` also sets `employeeId`, so a naive
    // narrowing clause would have been silently overwritten by it.
    const ctx = buildCtx(
      buildActor({
        id: who('reader').userId,
        tenantId,
        teamIds: [teamId],
        branchId,
        regionId,
        permissions: new Map([
          ['leave:APPROVE', 'TEAM'],
          ['employee:VIEW', 'TEAM'],
        ]),
      }),
    );
    const result = await runReport(ctx, 'leave-balances', { employeeId: who('regionOutsider').employeeId });
    expect(result.rows).toHaveLength(0);
  });
});

describe('an empty permitted audience means nobody, never everybody', () => {
  it('a reader with no employee record of their own sees no payslips', async () => {
    const ctx = ctxAt(who('unlinked').userId, 'OWN', { teamIds: [teamId], branchId, regionId });
    const result = await runReport(ctx, 'payroll-register', RANGE);
    expect(result.rows).toHaveLength(0);
  });

  it('a TEAM reader in no team sees only themselves', async () => {
    const ctx = ctxAt(who('stranger').userId, 'TEAM', { teamIds: [] });
    const numbers = seen((await runReport(ctx, 'payroll-register', RANGE)).rows);
    expect(numbers).toEqual(new Set([who('stranger').number]));
  });

  it('a removed team membership narrows the audience on the next read', async () => {
    const before = seen((await runReport(readerAt('TEAM'), 'payroll-register', RANGE)).rows);
    expect(before.has(who('mate').number)).toBe(true);

    await prisma.userTeam.deleteMany({ where: { tenantId, userId: who('mate').userId } });
    try {
      const after = seen((await runReport(readerAt('TEAM'), 'payroll-register', RANGE)).rows);
      expect(after.has(who('mate').number)).toBe(false);
      expect(after.has(who('reader').number)).toBe(true);
    } finally {
      await prisma.userTeam.create({ data: { tenantId, userId: who('mate').userId, teamId } });
    }
  });
});

describe('the three consumers agree', () => {
  it('list, report and CSV describe the same audience at every scope', async () => {
    for (const scope of ['OWN', 'TEAM', 'BRANCH', 'REGION', 'ORGANIZATION'] as VisibilityScope[]) {
      const ctx = readerAt(scope);
      expect(
        availableReports(ctx).map((r) => r.key),
        `${scope}: offered`,
      ).toContain('payroll-register');

      const onScreen = await runReport(ctx, 'payroll-register', RANGE);
      const file = await exportReportCsv(ctx, 'payroll-register', RANGE);
      expect(file.rows, `${scope}: export row count`).toBe(onScreen.rows.length);

      const visible = seen(onScreen.rows);
      for (const number of visible) expect(file.content).toContain(number);
      for (const label of ['regionOutsider', 'stranger', 'foreigner']) {
        const p = who(label);
        if (!visible.has(p.number)) {
          expect(file.content, `${scope}: leaked ${label}`).not.toContain(p.number);
        }
      }
    }
  });

  it('offers nothing it would then refuse', async () => {
    const ctx = readerAt('OWN');
    for (const report of availableReports(ctx)) {
      await expect(runReport(ctx, report.key, RANGE)).resolves.toBeTruthy();
    }
  });
});

describe('grouped reports narrow too', () => {
  it('headcount counts only the people in scope', async () => {
    const total = (rows: Record<string, unknown>[]) => rows.reduce((n, r) => n + Number(r.headcount ?? 0), 0);
    expect(total((await runReport(readerAt('OWN'), 'headcount-by-department', {})).rows)).toBe(1);
    expect(total((await runReport(readerAt('TEAM'), 'headcount-by-department', {})).rows)).toBe(2);
    // Six people exist here; `unlinked` has no EmployeeProfile, so five count.
    expect(total((await runReport(readerAt('ORGANIZATION'), 'headcount-by-department', {})).rows)).toBe(5);
  });
});

describe('reports about the workspace rather than a person', () => {
  const recruiterAt = (scope: VisibilityScope) =>
    buildCtx(
      buildActor({
        id: who('reader').userId,
        tenantId,
        permissions: new Map([
          ['recruitment:VIEW', scope],
          ['employee:VIEW', scope],
        ]),
      }),
    );

  it.each(['OWN', 'TEAM', 'BRANCH', 'REGION'] as VisibilityScope[])(
    'refuse at %s scope instead of returning everything',
    async (scope) => {
      await expect(runReport(recruiterAt(scope), 'open-positions', {})).rejects.toThrow(/organization scope/i);
    },
  );

  it('are not offered by the list endpoint below ORGANIZATION either', () => {
    expect(availableReports(recruiterAt('TEAM')).map((r) => r.key)).not.toContain('open-positions');
  });

  it('are permitted at ORGANIZATION scope', async () => {
    await expect(runReport(recruiterAt('ORGANIZATION'), 'open-positions', {})).resolves.toBeTruthy();
  });
});
