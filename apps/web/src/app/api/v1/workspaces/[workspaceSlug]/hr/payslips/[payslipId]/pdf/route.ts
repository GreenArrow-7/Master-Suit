import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { requireWorkspace } from '@/lib/workspace';
import { renderPdf, type PdfLine } from '@/lib/pdf';
import { payslipDetail } from '@/services/hr/payroll';

/**
 * A payslip as a PDF.
 *
 * Authorisation is `payslipDetail`'s, not this route's: it already enforces
 * "your own, or `payroll:VIEW` for anyone else's", already hides a payslip from
 * a run that has not been approved, and already writes the DOCUMENT_ACCESSED
 * audit row. Re-implementing any of that here would be a second copy to keep in
 * step, and §47's "payslips must not be publicly accessible by guessable URLs"
 * is satisfied by the id being a cuid behind that check rather than by secrecy.
 */
export const GET = route(
  {
    module: 'payroll',
    action: 'VIEW',
    productModule: 'HRMS',
    sessionOnly: true,
    // `payslipDetail` decides, as above: your own, or payroll:VIEW for anyone else's.
    permissionInHandler: true,
    params: z.object({ workspaceSlug: z.string(), payslipId: z.string() }),
  },
  async ({ ctx, params: { workspaceSlug, payslipId } }) => {
    await requireWorkspace(ctx, workspaceSlug);

    const payslip = await payslipDetail(ctx, payslipId);
    const money = (value: { toString(): string }) =>
      `${payslip.currency} ${Number(value.toString()).toLocaleString('en-AE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    const day = (value: Date) => value.toISOString().slice(0, 10);

    const lines: PdfLine[] = [
      { kind: 'heading', text: 'Payslip' },
      { kind: 'text', text: `${day(payslip.run.periodStart)} to ${day(payslip.run.periodEnd)}` },
      { kind: 'gap' },
      { kind: 'text', text: payslip.employee.membership.platformUser.fullName },
      { kind: 'text', text: `Employee number ${payslip.employee.employeeNumber}` },
      { kind: 'rule' },
      { kind: 'subheading', text: 'Earnings' },
      ...payslip.lines
        .filter((line) => line.kind === 'EARNING')
        .map((line): PdfLine => ({ kind: 'row', label: line.label, value: money(line.amount) })),
      { kind: 'row', label: 'Gross', value: money(payslip.grossEarnings) },
      { kind: 'rule' },
      { kind: 'subheading', text: 'Deductions' },
      ...(payslip.lines.some((line) => line.kind === 'DEDUCTION')
        ? payslip.lines
            .filter((line) => line.kind === 'DEDUCTION')
            .map((line): PdfLine => ({ kind: 'row', label: line.label, value: money(line.amount) }))
        : [{ kind: 'text', text: 'None' } as PdfLine]),
      { kind: 'row', label: 'Total deductions', value: money(payslip.totalDeductions) },
      { kind: 'rule' },
      { kind: 'subheading', text: 'Net pay' },
      { kind: 'row', label: 'Paid to you', value: money(payslip.netPay) },
      { kind: 'gap' },
      ...(payslip.overtimeMinutes
        ? [
            {
              kind: 'text',
              text: `Includes ${(payslip.overtimeMinutes / 60).toFixed(2)} hours of approved overtime.`,
            } as PdfLine,
          ]
        : []),
      ...(payslip.unpaidDays
        ? [{ kind: 'text', text: `${payslip.unpaidDays} day(s) of unpaid leave were deducted.` } as PdfLine]
        : []),
      { kind: 'gap' },
      { kind: 'text', text: 'This document is generated from payroll records and is valid without a signature.' },
    ];

    const pdf = renderPdf(lines, { title: `Payslip ${day(payslip.run.periodEnd)}` });
    const filename = `payslip-${payslip.employee.employeeNumber}-${day(payslip.run.periodEnd)}.pdf`;

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-length': String(pdf.length),
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'private, no-store',
      },
    });
  },
);
