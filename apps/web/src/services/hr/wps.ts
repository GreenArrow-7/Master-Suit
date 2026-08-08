/**
 * UAE Wage Protection System export.
 *
 * A SIF is two record types in one flat file: one EDR per employee being paid,
 * then one SCR summarising the batch. The bank matches the SCR totals against
 * the EDR rows and rejects the file if they disagree, so the totals here are
 * derived from the same rows that are written, never recomputed from the run.
 *
 * **The field layout below is one documented variant, not a universal
 * standard.** Banks differ on date format, column order and whether a header
 * row is expected, which is exactly why §47 asks for this to be versioned rather
 * than sprinkled through the application. `SIF_LAYOUTS` holds the variants; the
 * builders are pure, so adding a bank's dialect is a new entry and a new test,
 * not an edit to the export path. Validate the output against the receiving
 * bank's specification before the first live run — a rejected file is a payroll
 * that did not happen.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { getHrPolicy } from './settings';

const mayExport = (ctx: Ctx) => SCOPE_RANK[scopeFor(ctx, 'payroll', 'EXPORT')] >= SCOPE_RANK.ORGANIZATION;

export type SifLayoutKey = 'uae-sif-v1';

interface SifLayout {
  label: string;
  /** How the bank wants a date rendered. */
  date: (value: Date) => string;
  /** Field order for an Employee Detail Record. */
  edr: (row: EdrRow, layout: SifLayout) => string[];
  /** Field order for the Salary Control Record. */
  scr: (row: ScrRow, layout: SifLayout) => string[];
}

export interface EdrRow {
  personId: string;
  agentId: string;
  iban: string;
  periodStart: Date;
  periodEnd: Date;
  daysInPeriod: number;
  fixedIncome: Prisma.Decimal;
  variableIncome: Prisma.Decimal;
  leaveDays: number;
}

export interface ScrRow {
  employerId: string;
  employerAgentId: string;
  createdAt: Date;
  salaryMonth: string;
  recordCount: number;
  totalSalary: Prisma.Decimal;
  currency: string;
}

const iso = (value: Date) => value.toISOString().slice(0, 10);
const amount = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);

export const SIF_LAYOUTS: Record<SifLayoutKey, SifLayout> = {
  'uae-sif-v1': {
    label: 'UAE SIF v1 (ISO dates)',
    date: iso,
    edr: (row, layout) => [
      'EDR',
      row.personId,
      row.agentId,
      row.iban,
      layout.date(row.periodStart),
      layout.date(row.periodEnd),
      String(row.daysInPeriod),
      amount(row.fixedIncome),
      amount(row.variableIncome),
      String(row.leaveDays),
    ],
    scr: (row, layout) => [
      'SCR',
      row.employerId,
      row.employerAgentId,
      layout.date(row.createdAt),
      row.salaryMonth,
      String(row.recordCount),
      amount(row.totalSalary),
      row.currency,
    ],
  },
};

/**
 * Earning codes that form the contractual package. Everything else an employee
 * earns — overtime, bonus, commission — is variable income to the WPS.
 */
const CONTRACTUAL_CODES = new Set(['BASIC', 'HOUSING', 'TRANSPORT', 'OTHER']);

/** A field containing the delimiter would silently shift every column after it. */
const cell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export interface SifResult {
  filename: string;
  content: string;
  included: number;
  /** Employees the file could not carry, and why. Never silently dropped. */
  excluded: { employeeId: string; name: string; reason: string }[];
  totalSalary: string;
}

/**
 * Build the SIF for a run.
 *
 * Only a run that has been approved can be exported: a draft is a working
 * figure, and a bank file is an instruction to move money.
 */
export async function generateSif(ctx: Ctx, runId: string, layoutKey: SifLayoutKey = 'uae-sif-v1'): Promise<SifResult> {
  if (!mayExport(ctx)) throw Forbidden('Your role does not allow exporting payroll.');

  const layout = SIF_LAYOUTS[layoutKey];
  if (!layout) throw Conflict(`Unknown SIF layout "${layoutKey}".`);

  const run = await prisma.hrPayrollRun.findFirst({
    where: { tenantId: ctx.tenantId, id: runId },
    include: {
      payslips: {
        include: {
          lines: true,
          employee: {
            select: {
              id: true,
              employeeNumber: true,
              iban: true,
              bankAgentId: true,
              wpsPersonId: true,
              membership: { select: { platformUser: { select: { fullName: true } } } },
            },
          },
        },
      },
    },
  });
  if (!run) throw NotFound('Payroll run');
  if (!['APPROVED', 'LOCKED', 'PAID'].includes(run.status))
    throw Conflict('Only an approved run can be exported to the WPS.');

  const policy = await getHrPolicy(ctx);
  // Fail before writing a file rather than producing one the bank will reject.
  if (!policy.wpsEmployerId.trim())
    throw Conflict('Set the WPS employer (MOL) identifier in HR policy before exporting.');
  if (!policy.wpsEmployerBankAgentId.trim())
    throw Conflict('Set the WPS employer bank agent identifier in HR policy before exporting.');

  const daysInPeriod =
    Math.round((run.periodEnd.getTime() - run.periodStart.getTime()) / 86_400_000) + 1;

  const rows: string[] = [];
  const excluded: SifResult['excluded'] = [];
  let total = new Prisma.Decimal(0);
  let included = 0;

  for (const payslip of run.payslips) {
    const employee = payslip.employee;
    const name = employee.membership.platformUser.fullName;
    const iban = payslip.ibanSnapshot ?? employee.iban;
    const missing = [
      !employee.wpsPersonId?.trim() && 'WPS person (labour card) identifier',
      !iban?.trim() && 'IBAN',
      !employee.bankAgentId?.trim() && 'bank agent identifier',
    ].filter(Boolean) as string[];

    if (missing.length) {
      excluded.push({ employeeId: employee.id, name, reason: `Missing ${missing.join(', ')}` });
      continue;
    }
    if (payslip.netPay.lessThanOrEqualTo(0)) {
      excluded.push({ employeeId: employee.id, name, reason: 'Net pay is zero for this period' });
      continue;
    }

    // The WPS separates guaranteed pay from anything variable, and the two must
    // add up to what is actually transferred. Derived from the payslip's own
    // lines rather than from basic-versus-gross: housing and transport are
    // contractual, so treating everything above basic as variable would
    // misreport a normal month with no overtime in it.
    const variableGross = payslip.lines
      .filter((line) => line.kind === 'EARNING' && !CONTRACTUAL_CODES.has(line.code))
      .reduce((total, line) => total.plus(line.amount), new Prisma.Decimal(0));
    // Deductions come off the fixed part first, so variable can never exceed the
    // money that actually moved.
    const variable = variableGross.greaterThan(payslip.netPay) ? payslip.netPay : variableGross;
    const fixed = payslip.netPay.minus(variable);

    rows.push(
      layout
        .edr(
          {
            personId: employee.wpsPersonId!.trim(),
            agentId: employee.bankAgentId!.trim(),
            iban: iban!.trim(),
            periodStart: run.periodStart,
            periodEnd: run.periodEnd,
            daysInPeriod,
            fixedIncome: fixed,
            variableIncome: variable,
            leaveDays: Math.round(payslip.unpaidDays),
          },
          layout,
        )
        .map(cell)
        .join(','),
    );
    total = total.plus(payslip.netPay);
    included += 1;
  }

  if (!included) throw Conflict('No payslip in this run has the bank details a WPS file requires.');

  const salaryMonth = `${run.periodEnd.getUTCFullYear()}${String(run.periodEnd.getUTCMonth() + 1).padStart(2, '0')}`;
  rows.push(
    layout
      .scr(
        {
          employerId: policy.wpsEmployerId.trim(),
          employerAgentId: policy.wpsEmployerBankAgentId.trim(),
          createdAt: new Date(),
          salaryMonth,
          recordCount: included,
          totalSalary: total,
          currency: run.currency,
        },
        layout,
      )
      .map(cell)
      .join(','),
  );

  await audit(ctx, {
    event: 'EXPORT_REQUESTED',
    objectType: 'hr_payroll_run',
    recordId: run.id,
    metadata: {
      action: 'payroll.wps.exported',
      layout: layoutKey,
      included,
      excluded: excluded.length,
      totalSalary: amount(total),
    },
  });

  return {
    filename: `WPS-${policy.wpsEmployerId.trim()}-${salaryMonth}.sif`,
    content: `${rows.join('\r\n')}\r\n`,
    included,
    excluded,
    totalSalary: amount(total),
  };
}
