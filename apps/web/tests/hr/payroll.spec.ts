/**
 * Payroll: the money, and the controls that stop it moving twice.
 *
 * The pure block asserts the arithmetic — daily and hourly rates, unpaid
 * absence, overtime on basic, the clamp that stops a payslip going negative.
 *
 * The database block asserts the properties that make a run safe to pay from:
 *
 *   1. pay comes from the effective-dated history, so a raise does not
 *      retroactively restate last month;
 *   2. only APPROVED overtime reaches a payslip;
 *   3. the preparer cannot approve their own run (maker-checker);
 *   4. locking freezes the claims the run paid, and consumes the adjustments, so
 *      neither can be paid a second time;
 *   5. an employee reads their own payslip and nobody else's.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  addAdjustment,
  approveRun,
  buildPayslip,
  calculateRun,
  compensationAsOf,
  compensationHistory,
  createRun,
  lockRun,
  markRunPaid,
  payslipsFor,
  setCompensation,
  submitRun,
} from '@/services/hr/payroll';
import { decideOvertime, requestOvertime } from '@/services/hr/overtime';
import { generateSif } from '@/services/hr/wps';
import { DEFAULT_POLICY, updateHrPolicy } from '@/services/hr/settings';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { PermissionMap } from '@/lib/security/rbac';

const decimal = (value: number) => new Prisma.Decimal(value);

// ── Pure arithmetic ────────────────────────────────────────────────────────

describe('buildPayslip', () => {
  const base = {
    employeeId: 'e1',
    basic: decimal(6000),
    housing: decimal(3000),
    transport: decimal(1000),
    other: decimal(0),
    unpaidDays: 0,
    overtime: { minutes: 0, weightedMinutes: 0 },
    adjustments: [],
    iban: null,
    policy: DEFAULT_POLICY,
  };

  it('pays the full package when nothing is deducted', () => {
    const slip = buildPayslip(base);
    expect(slip.gross.toString()).toBe('10000');
    expect(slip.deductions.toString()).toBe('0');
    expect(slip.net.toString()).toBe('10000');
  });

  it('deducts an unpaid day at the total daily rate', () => {
    // 10000 / 30 = 333.33 per day.
    const slip = buildPayslip({ ...base, unpaidDays: 3 });
    expect(slip.deductions.toString()).toBe('1000');
    expect(slip.net.toString()).toBe('9000');
  });

  it('pays overtime on basic, not on the whole package', () => {
    // Basic 6000 / 30 / 8 = 25.00 an hour. 120 weighted minutes = 2 h = 50.00.
    // Paying it on the 10000 package would give 83.33 — the difference the
    // `payrollOvertimeOnBasic` setting exists to make explicit.
    const slip = buildPayslip({ ...base, overtime: { minutes: 96, weightedMinutes: 120 } });
    expect(slip.gross.minus(decimal(10000)).toString()).toBe('50');
    expect(slip.overtimeMinutes).toBe(96);
  });

  it('pays overtime on the full package when the policy says so', () => {
    const slip = buildPayslip({
      ...base,
      overtime: { minutes: 96, weightedMinutes: 120 },
      policy: { ...DEFAULT_POLICY, payrollOvertimeOnBasic: false },
    });
    // 10000 / 30 / 8 = 41.666… an hour, 2 h = 83.33.
    expect(slip.gross.minus(decimal(10000)).toString()).toBe('83.33');
  });

  it('applies additions and deductions from adjustments', () => {
    const slip = buildPayslip({
      ...base,
      adjustments: [
        { id: 'a1', code: 'BONUS', label: 'Q1 bonus', kind: 'EARNING', amount: decimal(2500) },
        { id: 'a2', code: 'LOAN', label: 'Loan instalment', kind: 'DEDUCTION', amount: decimal(500) },
      ],
    });
    expect(slip.gross.toString()).toBe('12500');
    expect(slip.deductions.toString()).toBe('500');
    expect(slip.net.toString()).toBe('12000');
  });

  it('clamps a payslip at zero rather than going negative', () => {
    // A full month of unpaid leave plus a loan deduction. The company invoicing
    // the employee is a recovery process, not a salary transfer.
    const slip = buildPayslip({
      ...base,
      unpaidDays: 30,
      adjustments: [{ id: 'a1', code: 'LOAN', label: 'Loan', kind: 'DEDUCTION', amount: decimal(500) }],
    });
    expect(slip.net.toString()).toBe('0');
    expect((slip.inputs as { negativeNetClamped: boolean }).negativeNetClamped).toBe(true);
  });

  it('records the rates it used, so the payslip stays explicable', () => {
    const slip = buildPayslip(base);
    const inputs = slip.inputs as { dailyRate: string; hourlyRate: string };
    expect(inputs.dailyRate).toBe('333.33');
    expect(inputs.hourlyRate).toBe('25');
  });
});

// ── Workflow, against the real database ────────────────────────────────────

const suffix = randomBytes(4).toString('hex');
const slug = `pay-${suffix}`;

let tenantId = '';
const employees: Record<string, string> = {};
const userIds: Record<string, string> = {};

const permissions = (grants: readonly (readonly [string, string])[]) =>
  new Map(grants.map(([module, action]) => [`${module}:${action}`, 'ORGANIZATION'])) as PermissionMap;

const ctxFor = (label: string, grants: readonly (readonly [string, string])[]) =>
  buildCtx(buildActor({ id: userIds[label]!, tenantId, permissions: permissions(grants) }));

const OFFICER = [
  ['payroll', 'VIEW'],
  ['payroll', 'CREATE'],
  ['payroll', 'EDIT'],
  ['employee', 'VIEW'],
] as const;
const CHECKER = [
  ['payroll', 'VIEW'],
  ['payroll', 'APPROVE'],
  ['payroll', 'EXPORT'],
  ['employee', 'VIEW'],
] as const;
const STAFF = [['employee', 'VIEW']] as const;
/** `isHrAdmin` is `employee:EDIT` at ORGANIZATION — what HR policy changes require. */
const HR_ADMIN = [
  ['employee', 'VIEW'],
  ['employee', 'EDIT'],
] as const;
const OT_APPROVER = [
  ['overtime', 'APPROVE'],
  ['employee', 'VIEW'],
] as const;

async function makeEmployee(label: string, joinedOn = new Date('2020-01-01')) {
  const email = `${label}-${suffix}@payroll.test`;
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: label, status: 'ACTIVE' },
  });
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: 'ORGANIZATION' },
  });
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: label, roleId: role.id, status: 'ACTIVE' },
  });
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  const employee = await prisma.employeeProfile.create({
    data: {
      tenantId,
      membershipId: membership.id,
      employeeNumber: `${label.toUpperCase()}-${suffix}`,
      employmentStatus: 'ACTIVE',
      joinedOn,
    },
  });
  employees[label] = employee.id;
  userIds[label] = user.id;
  return employee.id;
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Payroll LLC', displayName: 'Payroll', status: 'ACTIVE', timezone: 'Asia/Dubai' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });
  await makeEmployee('worker');
  await makeEmployee('officer');
  await makeEmployee('checker');
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('compensation history', () => {
  it('keeps every salary rather than overwriting the last one', async () => {
    const ctx = ctxFor('officer', OFFICER);
    await setCompensation(ctx, {
      employeeId: employees.worker!,
      effectiveFrom: new Date('2026-01-01'),
      basic: 6000,
      housing: 3000,
      transport: 1000,
      changeReason: 'Joining salary',
    });
    await setCompensation(ctx, {
      employeeId: employees.worker!,
      effectiveFrom: new Date('2026-04-01'),
      basic: 7000,
      housing: 3500,
      transport: 1000,
      changeReason: 'Annual review',
    });

    const history = await compensationHistory(ctx, employees.worker!);
    expect(history).toHaveLength(2);

    // The property that matters: March still reads the January salary.
    const march = await compensationAsOf(ctx, employees.worker!, new Date('2026-03-31'));
    expect(march?.basic.toString()).toBe('6000');
    const may = await compensationAsOf(ctx, employees.worker!, new Date('2026-05-15'));
    expect(may?.basic.toString()).toBe('7000');
  });

  it('mirrors only the latest record onto the profile', async () => {
    const profile = await prisma.employeeProfile.findFirstOrThrow({
      where: { tenantId, id: employees.worker! },
      select: { basicSalary: true, totalSalary: true },
    });
    expect(profile.basicSalary?.toString()).toBe('7000');
    expect(profile.totalSalary?.toString()).toBe('11500');

    // A backdated correction must not drag current pay backwards.
    await setCompensation(ctxFor('officer', OFFICER), {
      employeeId: employees.worker!,
      effectiveFrom: new Date('2025-06-01'),
      basic: 5000,
      changeReason: 'Backdated correction',
    });
    const after = await prisma.employeeProfile.findFirstOrThrow({
      where: { tenantId, id: employees.worker! },
      select: { basicSalary: true },
    });
    expect(after.basicSalary?.toString()).toBe('7000');
  });

  it('refuses to show one employee another’s salary', async () => {
    await expect(compensationHistory(ctxFor('worker', STAFF), employees.officer!)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('a run, end to end', () => {
  let runId = '';

  it('opens and refuses a second run for the same period', async () => {
    const run = await createRun(
      ctxFor('officer', OFFICER),
      new Date('2026-03-01'),
      new Date('2026-03-31'),
      'March payroll',
    );
    runId = run.id;
    expect(run.status).toBe('DRAFT');

    await expect(
      createRun(ctxFor('officer', OFFICER), new Date('2026-03-01'), new Date('2026-03-31')),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('calculates from the salary in force in the period, not today’s', async () => {
    const result = await calculateRun(ctxFor('officer', OFFICER), runId);
    expect(result.payslips).toBeGreaterThan(0);

    const payslip = await prisma.hrPayslip.findFirstOrThrow({
      where: { tenantId, runId, employeeId: employees.worker! },
    });
    // January's 6000, not April's 7000.
    expect(payslip.basic.toString()).toBe('6000');
    expect(payslip.netPay.toString()).toBe('10000');
  });

  it('ignores overtime that nobody approved', async () => {
    await requestOvertime(ctxFor('worker', STAFF), {
      workDate: new Date('2026-03-10'),
      minutes: 120,
      reason: 'Month end close',
    });
    await calculateRun(ctxFor('officer', OFFICER), runId);

    const payslip = await prisma.hrPayslip.findFirstOrThrow({
      where: { tenantId, runId, employeeId: employees.worker! },
    });
    expect(payslip.overtimeMinutes).toBe(0);
    expect(payslip.netPay.toString()).toBe('10000');
  });

  it('pays it once approved, at the rate it was approved at', async () => {
    const claim = await prisma.hrOvertimeRequest.findFirstOrThrow({
      where: { tenantId, employeeId: employees.worker!, workDate: new Date('2026-03-10T00:00:00Z') },
    });
    const approved = await decideOvertime(ctxFor('checker', OT_APPROVER), claim.id, true);
    await calculateRun(ctxFor('officer', OFFICER), runId);

    const payslip = await prisma.hrPayslip.findFirstOrThrow({
      where: { tenantId, runId, employeeId: employees.worker! },
    });
    expect(payslip.overtimeMinutes).toBe(120);
    // 6000 / 30 / 8 = 25.00/h; 120 min × 1.25 = 150 weighted min = 2.5 h = 62.50.
    const expected = 25 * ((120 * approved.multiplier!) / 60);
    expect(Number(payslip.netPay) - 10000).toBeCloseTo(expected, 2);
  });

  it('picks up an adjustment entered against the period', async () => {
    await addAdjustment(ctxFor('officer', OFFICER), {
      employeeId: employees.worker!,
      effectiveOn: new Date('2026-03-20'),
      code: 'BONUS',
      label: 'Q1 bonus',
      kind: 'EARNING',
      amount: 1500,
    });
    await calculateRun(ctxFor('officer', OFFICER), runId);

    const payslip = await prisma.hrPayslip.findFirstOrThrow({
      where: { tenantId, runId, employeeId: employees.worker! },
      include: { lines: true },
    });
    expect(payslip.lines.some((line) => line.code === 'BONUS')).toBe(true);
  });

  it('will not let the preparer approve their own run', async () => {
    await submitRun(ctxFor('officer', OFFICER), runId);
    // The officer would need the approval permission to get this far; granting
    // it proves the refusal is about the record, not the role.
    await expect(
      approveRun(ctxFor('officer', [...OFFICER, ['payroll', 'APPROVE']] as const), runId, true),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses to recalculate once it is out of draft', async () => {
    await expect(calculateRun(ctxFor('officer', OFFICER), runId)).rejects.toMatchObject({ status: 409 });
  });

  it('approves with a second pair of eyes', async () => {
    const approved = await approveRun(ctxFor('checker', CHECKER), runId, true);
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedById).toBe(employees.checker);
  });

  it('freezes the overtime it paid when the run locks', async () => {
    const locked = await lockRun(ctxFor('checker', CHECKER), runId);
    expect(locked.status).toBe('LOCKED');

    const claim = await prisma.hrOvertimeRequest.findFirstOrThrow({
      where: { tenantId, employeeId: employees.worker!, workDate: new Date('2026-03-10T00:00:00Z') },
    });
    expect(claim.lockedAt).not.toBeNull();
    expect(claim.payrollRunId).toBe(runId);

    // And the adjustment cannot be paid again next month.
    const adjustment = await prisma.hrPayrollAdjustment.findFirstOrThrow({
      where: { tenantId, employeeId: employees.worker!, code: 'BONUS' },
    });
    expect(adjustment.consumedByRunId).toBe(runId);
  });

  it('does not pay the same adjustment in the following run', async () => {
    const april = await createRun(ctxFor('officer', OFFICER), new Date('2026-04-01'), new Date('2026-04-30'));
    await calculateRun(ctxFor('officer', OFFICER), april.id);
    const payslip = await prisma.hrPayslip.findFirstOrThrow({
      where: { tenantId, runId: april.id, employeeId: employees.worker! },
      include: { lines: true },
    });
    expect(payslip.lines.some((line) => line.code === 'BONUS')).toBe(false);
    // April also proves the raise applied: 7000 basic, 11500 package.
    expect(payslip.basic.toString()).toBe('7000');
  });

  it('marks paid only after locking', async () => {
    const paid = await markRunPaid(ctxFor('checker', CHECKER), runId);
    expect(paid.status).toBe('PAID');
  });
});

describe('payslip visibility', () => {
  it('lets an employee read their own', async () => {
    const mine = await payslipsFor(ctxFor('worker', STAFF));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((payslip) => payslip.employeeId === employees.worker)).toBe(true);
  });

  it('refuses a colleague’s', async () => {
    await expect(payslipsFor(ctxFor('worker', STAFF), employees.officer!)).rejects.toMatchObject({ status: 403 });
  });

  it('hides a draft run from the employee it concerns', async () => {
    const draft = await createRun(ctxFor('officer', OFFICER), new Date('2026-06-01'), new Date('2026-06-30'));
    await calculateRun(ctxFor('officer', OFFICER), draft.id);

    const mine = await payslipsFor(ctxFor('worker', STAFF));
    expect(mine.some((payslip) => payslip.runId === draft.id)).toBe(false);

    // Payroll sees it, because acting on a draft is the whole job.
    const theirs = await payslipsFor(ctxFor('officer', OFFICER), employees.worker!);
    expect(theirs.some((payslip) => payslip.runId === draft.id)).toBe(true);
  });
});

describe('WPS export', () => {
  it('refuses before the employer identifiers are configured', async () => {
    const run = await prisma.hrPayrollRun.findFirstOrThrow({ where: { tenantId, status: 'PAID' } });
    await expect(generateSif(ctxFor('checker', CHECKER), run.id)).rejects.toMatchObject({ status: 409 });
  });

  it('reports employees it cannot carry instead of dropping them', async () => {
    await prisma.organizationSetting.upsert({
      where: { tenantId },
      update: { hrPolicy: { wpsEmployerId: 'MOL-1234', wpsEmployerBankAgentId: 'ADCB-01' } },
      create: { tenantId, hrPolicy: { wpsEmployerId: 'MOL-1234', wpsEmployerBankAgentId: 'ADCB-01' } },
    });

    // The worker is bankable; the officer is paid but has no bank details. Both
    // need a salary, because `calculateRun` only writes a payslip for someone it
    // can actually pay.
    await prisma.employeeProfile.update({
      where: { tenantId, id: employees.worker! },
      data: { iban: 'AE070331234567890123456', bankAgentId: 'ADCB-01', wpsPersonId: '784-1990-1234567-1' },
    });
    await setCompensation(ctxFor('officer', OFFICER), {
      employeeId: employees.officer!,
      effectiveFrom: new Date('2026-07-01'),
      basic: 9000,
      changeReason: 'Joining salary',
    });

    const run = await createRun(ctxFor('officer', OFFICER), new Date('2026-07-01'), new Date('2026-07-31'));
    await calculateRun(ctxFor('officer', OFFICER), run.id);
    await submitRun(ctxFor('officer', OFFICER), run.id);
    await approveRun(ctxFor('checker', CHECKER), run.id, true);

    const sif = await generateSif(ctxFor('checker', CHECKER), run.id);
    expect(sif.included).toBe(1);
    // Named rather than silently missing from the file: a short file that looks
    // successful is how somebody does not get paid.
    expect(sif.excluded.map((row) => row.employeeId)).toContain(employees.officer);
    expect(sif.excluded[0]!.reason).toMatch(/Missing/);

    const lines = sif.content.trim().split('\r\n');
    expect(lines.filter((line) => line.startsWith('EDR,'))).toHaveLength(1);
    const control = lines.find((line) => line.startsWith('SCR,'))!;
    expect(control).toContain('MOL-1234');
    // The control total must equal what the detail rows add up to, or the bank
    // rejects the file.
    expect(control).toContain(sif.totalSalary);

    // A month with no overtime is entirely fixed income: housing and transport
    // are contractual, so nothing should land in the variable column.
    const edr = lines.find((line) => line.startsWith('EDR,'))!.split(',');
    expect(edr[8]).toBe('0.00');
    expect(edr[7]).toBe(Number(sif.totalSalary).toFixed(2));
  });

  it('refuses to export a run that has not been approved', async () => {
    const draft = await prisma.hrPayrollRun.findFirstOrThrow({ where: { tenantId, status: 'DRAFT' } });
    await expect(generateSif(ctxFor('checker', CHECKER), draft.id)).rejects.toMatchObject({ status: 409 });
  });

  it('refuses an exporter without the permission', async () => {
    const run = await prisma.hrPayrollRun.findFirstOrThrow({ where: { tenantId, status: 'PAID' } });
    await expect(generateSif(ctxFor('worker', STAFF), run.id)).rejects.toMatchObject({ status: 403 });
  });
});

/**
 * A SIF is a text file a bank parses mechanically — but a payroll team opens it
 * in Excel first, to check a run before instructing a transfer. Excel and Sheets
 * execute a cell beginning `=`, `+`, `-` or `@`, so `=HYPERLINK(…)` in an
 * identifier is a phishing link arriving inside the company's own payroll file,
 * at the moment somebody is about to move money.
 *
 * `wpsEmployerId` is a free-text HR policy setting, which makes this reachable
 * today by a tenant's own HR administrator.
 *
 * The fix refuses rather than escapes, and these cases are why: the apostrophe
 * that `lib/csv.ts` prefixes is right for a report a human reads and wrong for a
 * bank file, because `'AE0703…` is not an IBAN. A blunted attack here would be a
 * corrupted payment instruction.
 */
describe('WPS export · spreadsheet formula injection', () => {
  const storeEmployer = (employerId: string, agentId = 'ADCB-01') =>
    prisma.organizationSetting.upsert({
      where: { tenantId },
      update: { hrPolicy: { wpsEmployerId: employerId, wpsEmployerBankAgentId: agentId } },
      create: { tenantId, hrPolicy: { wpsEmployerId: employerId, wpsEmployerBankAgentId: agentId } },
    });

  // Deliberately short. A full `=HYPERLINK("http://evil","Payroll")` is 38
  // characters and would be refused by `maxLength: 32` before the pattern was
  // consulted — which is a refusal, but not a test of the guard being added.
  const ATTACKS = ['=1+1', '+1+1', '-2+3', '@SUM(A1)', 'MOL,1234'];

  afterAll(() => storeEmployer('MOL-1234'));

  it('refuses the value where an administrator can fix it, with a message they can act on', async () => {
    // Layer 1, and the only one that reaches a person. "must match
    // /^[A-Za-z0-9][A-Za-z0-9 \/_-]*$/" is not something somebody responsible
    // for payroll can act on, and a validation message nobody can act on gets
    // worked around rather than fixed.
    for (const attack of ATTACKS) {
      // The actionable text is on the field error, not on the AppError's own
      // message — which is "1 field failed validation" and reaches the form as a
      // per-field message rather than a banner.
      await expect(updateHrPolicy(ctxFor('officer', HR_ADMIN), { wpsEmployerId: attack })).rejects.toMatchObject({
        status: 422,
        errors: [
          expect.objectContaining({
            field: 'wpsEmployerId',
            message: expect.stringMatching(/letters, digits, spaces, hyphens/),
          }),
        ],
      });
    }
  });

  it('discards a value that reached the database another way', async () => {
    // Layer 2. A restored backup, an older release, or a direct SQL write —
    // `resolvePolicy` re-validates on read, so the formula never reaches the
    // file even though nothing refused it on the way in. The export then fails
    // with the "not configured" message, which is the truth: the stored value
    // was thrown away.
    const run = await prisma.hrPayrollRun.findFirstOrThrow({ where: { tenantId, status: 'PAID' } });
    for (const attack of ATTACKS) {
      await storeEmployer(attack);
      await expect(generateSif(ctxFor('checker', CHECKER), run.id)).rejects.toThrow(
        /Set the WPS employer \(MOL\) identifier/,
      );
    }
  });

  it('refuses at the export itself for a field with no policy layer in front of it', async () => {
    // Layer 3, and the only layer the per-employee identifiers have: there is no
    // settings validator between the database and the file for these.
    //
    // Excluded rather than escaped. The apostrophe that lib/csv.ts prefixes is
    // right for a report a human reads and wrong for a bank file — `'AE0703…` is
    // not an IBAN, so blunting the attack would corrupt a payment instruction.
    await storeEmployer('MOL-1234');
    const before = await prisma.employeeProfile.findFirstOrThrow({
      where: { tenantId, id: employees.worker! },
      select: { wpsPersonId: true },
    });
    await prisma.employeeProfile.update({
      where: { tenantId, id: employees.worker! },
      data: { wpsPersonId: '=HYPERLINK("http://evil","Open payslip")' },
    });

    const run = await prisma.hrPayrollRun.findFirstOrThrow({ where: { tenantId, status: 'APPROVED' } });
    // The only payable employee was excluded, so there is no file — the correct
    // outcome, and a loud one rather than a silently short file.
    await expect(generateSif(ctxFor('checker', CHECKER), run.id)).rejects.toThrow(/bank details a WPS file requires/);

    await prisma.employeeProfile.update({
      where: { tenantId, id: employees.worker! },
      data: { wpsPersonId: before.wpsPersonId },
    });
  });

  it('still accepts the identifiers a real bank issues', async () => {
    // The guard is worth nothing if it refuses legitimate data. Emirates ID
    // labour-card numbers carry hyphens, IBANs are alphanumeric, and routing
    // codes carry hyphens and slashes.
    await storeEmployer('MOL-1234', 'ADCB-01');
    const run = await prisma.hrPayrollRun.findFirstOrThrow({ where: { tenantId, status: 'APPROVED' } });
    const sif = await generateSif(ctxFor('checker', CHECKER), run.id);
    expect(sif.included).toBeGreaterThan(0);
    expect(sif.content).toContain('784-1990-1234567-1');
    expect(sif.content).toContain('AE070331234567890123456');
  });
});
