/**
 * The real-estate compliance register (real-estate HRMS §11).
 *
 * A UAE property brokerage lives and dies by credential expiry: a lapsed
 * residence visa or labour card means someone cannot legally work, and a
 * lapsed RERA broker card means a consultant cannot legally sell. Those
 * credentials live in two places — most as employee documents, but the RERA
 * card as a first-class field on the profile — so a sweep that reads only the
 * documents table silently misses the one credential unique to this industry.
 *
 * This unions both into one severity-sorted register, tags contractors (whose
 * document expiry a facilities team tracks separately from staff), and is the
 * source for the audit-ready compliance export.
 */
import { prisma } from '@/lib/db';
import type { Ctx } from '@/lib/security/rbac';
import { Forbidden } from '@/lib/errors';
import { daysBetween, expirySeverity } from './rules';
import { isHrAdmin, mayReadEmployees } from './access';
import { EMPLOYEE_WITH_PERSON } from './publicSelect';

export type Severity = ReturnType<typeof expirySeverity>;

export interface ComplianceRow {
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  employmentType: string | null;
  isContractor: boolean;
  credential: string;
  reference: string | null;
  expiresAt: Date;
  daysRemaining: number;
  severity: Severity;
}

const isContractorType = (type: string | null) => (type ?? '').toLowerCase().includes('contract');

/**
 * Every credential expiring within `withinDays` (default 90), across the
 * workforce the caller may read, worst first. HR sees everyone; a scoped
 * manager sees their reporting line; anyone else is refused — expiry data is
 * personal and identity-document adjacent.
 */
export async function complianceRegister(
  ctx: Ctx,
  options: { withinDays?: number; contractorsOnly?: boolean } = {},
): Promise<ComplianceRow[]> {
  if (!isHrAdmin(ctx) && !mayReadEmployees(ctx)) {
    throw Forbidden('You do not have access to the compliance register.');
  }
  const days = options.withinDays ?? 90;
  const horizon = new Date(Date.now() + days * 86_400_000);
  const now = new Date();

  const employeeFilter = {
    deletedAt: null,
    employmentStatus: { notIn: ['EXITED'] },
    ...(options.contractorsOnly ? { employmentType: { contains: 'contract', mode: 'insensitive' as const } } : {}),
  };

  const [documents, brokers] = await Promise.all([
    prisma.hrEmployeeDocument.findMany({
      where: { tenantId: ctx.tenantId, expiresAt: { not: null, lte: horizon }, employee: employeeFilter },
      include: { employee: EMPLOYEE_WITH_PERSON },
      orderBy: { expiresAt: 'asc' },
    }),
    // The RERA card lives on the profile, not the documents table.
    prisma.employeeProfile.findMany({
      where: { tenantId: ctx.tenantId, reraExpiry: { not: null, lte: horizon }, ...employeeFilter },
      include: { membership: { include: { platformUser: { select: { fullName: true } } } } },
    }),
  ]);

  const rows: ComplianceRow[] = [
    ...documents.map((document) => {
      const daysRemaining = daysBetween(now, document.expiresAt!);
      return {
        employeeId: document.employeeId,
        employeeName: document.employee.membership.platformUser.fullName,
        employeeNumber: document.employee.employeeNumber,
        employmentType: document.employee.employmentType,
        isContractor: isContractorType(document.employee.employmentType),
        credential: document.kind,
        reference: document.number,
        expiresAt: document.expiresAt!,
        daysRemaining,
        severity: expirySeverity(daysRemaining),
      };
    }),
    ...brokers.map((broker) => {
      const daysRemaining = daysBetween(now, broker.reraExpiry!);
      return {
        employeeId: broker.id,
        employeeName: broker.membership.platformUser.fullName,
        employeeNumber: broker.employeeNumber,
        employmentType: broker.employmentType,
        isContractor: isContractorType(broker.employmentType),
        credential: 'RERA broker card',
        reference: broker.reraBrn,
        expiresAt: broker.reraExpiry!,
        daysRemaining,
        severity: expirySeverity(daysRemaining),
      };
    }),
  ];

  // Worst first: expired before urgent before soon; ties broken by soonest date.
  return rows.sort((a, b) => a.daysRemaining - b.daysRemaining);
}
