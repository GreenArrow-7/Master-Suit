/**
 * Reporting: one registry, one permission check, three consumers.
 *
 * `reports.view` was a permission with no endpoints behind it. The temptation
 * when finally building it is a generic query engine — a filter DSL, a column
 * picker, user-defined joins. That is a second query language to secure, and
 * every report in §54 is a fixed question with a known shape, so it buys
 * nothing and costs a permission bypass waiting to happen.
 *
 * Instead each report is a definition: a title, the permission it needs, the
 * filters it honours, and a function that runs it. The list endpoint, the run
 * endpoint and the CSV export all resolve the same definition and assert the
 * same `permission` tuple, which is what makes §56's "exports must enforce the
 * same permissions as the UI" true by construction rather than by remembering.
 *
 * The permission on each report is the one for the *data*, not for reporting:
 * the payroll register needs `payroll:VIEW`, not `hr_reports:VIEW`, so a manager
 * who can read headcount cannot export salary cost. `hr_reports:VIEW` is only
 * the floor for reaching the module at all.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { Forbidden, NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import type { Action, Ctx } from '@/lib/security/rbac';
import { can } from '@/lib/security/rbac';
import { addDays, dayKey, toDay } from './rules';

export type ReportGroup =
  | 'employees'
  | 'attendance'
  | 'leave'
  | 'lifecycle'
  | 'payroll'
  | 'recruitment'
  | 'performance';

export type FilterKey = 'from' | 'to' | 'departmentId' | 'locationId' | 'employeeId' | 'status' | 'cycleId';

export interface ReportFilters {
  from?: Date;
  to?: Date;
  departmentId?: string;
  locationId?: string;
  employeeId?: string;
  status?: string;
  cycleId?: string;
}

export interface Column {
  key: string;
  label: string;
  numeric?: boolean;
}

export interface ReportResult {
  columns: Column[];
  rows: Record<string, unknown>[];
}

export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  group: ReportGroup;
  /** The authority over the *data*, not over reporting. See the file note. */
  permission: [string, Action];
  filters: FilterKey[];
  run: (ctx: Ctx, filters: ReportFilters) => Promise<ReportResult>;
}

/** Reports return a bounded number of rows; a report is not an export pipeline. */
const MAX_ROWS = 5000;

/** Defaults to the last 30 days when a report wants a window and none was given. */
function window(filters: ReportFilters) {
  const to = toDay(filters.to ?? new Date());
  const from = toDay(filters.from ?? addDays(to, -30));
  return { from, to };
}

const num = (value: Prisma.Decimal | number | null | undefined) => Number(value ?? 0);

export const REPORTS: ReportDefinition[] = [
  // ── Employees ────────────────────────────────────────────────────────────
  {
    key: 'headcount-by-department',
    title: 'Headcount by department',
    description: 'Active employees in each department, with the average length of service.',
    group: 'employees',
    permission: ['employee', 'VIEW'],
    filters: [],
    async run(ctx) {
      const rows = await prisma.employeeProfile.findMany({
        where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
        select: { joinedOn: true, department: { select: { name: true } } },
      });
      const grouped = new Map<string, { headcount: number; totalYears: number }>();
      for (const row of rows) {
        const name = row.department?.name ?? 'Unassigned';
        const entry = grouped.get(name) ?? { headcount: 0, totalYears: 0 };
        entry.headcount += 1;
        if (row.joinedOn) entry.totalYears += (Date.now() - row.joinedOn.getTime()) / (365.25 * 86_400_000);
        grouped.set(name, entry);
      }
      return {
        columns: [
          { key: 'department', label: 'Department' },
          { key: 'headcount', label: 'Headcount', numeric: true },
          { key: 'averageYears', label: 'Avg years of service', numeric: true },
        ],
        rows: [...grouped.entries()]
          .map(([department, entry]) => ({
            department,
            headcount: entry.headcount,
            averageYears: Number((entry.totalYears / entry.headcount).toFixed(1)),
          }))
          .sort((a, b) => b.headcount - a.headcount),
      };
    },
  },
  {
    key: 'joiners-and-leavers',
    title: 'Joiners and leavers',
    description: 'Who joined and who left in the period, with turnover against the current headcount.',
    group: 'employees',
    permission: ['employee', 'VIEW'],
    filters: ['from', 'to'],
    async run(ctx, filters) {
      const { from, to } = window(filters);
      const [joiners, leavers, headcount] = await Promise.all([
        prisma.employeeProfile.findMany({
          where: { tenantId: ctx.tenantId, joinedOn: { gte: from, lte: to } },
          select: { employeeNumber: true, joinedOn: true, department: { select: { name: true } } },
          take: MAX_ROWS,
        }),
        prisma.employeeProfile.findMany({
          where: { tenantId: ctx.tenantId, exitedOn: { gte: from, lte: to } },
          select: { employeeNumber: true, exitedOn: true, department: { select: { name: true } } },
          take: MAX_ROWS,
        }),
        prisma.employeeProfile.count({
          where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
        }),
      ]);
      return {
        columns: [
          { key: 'movement', label: 'Movement' },
          { key: 'employeeNumber', label: 'Employee' },
          { key: 'department', label: 'Department' },
          { key: 'date', label: 'Date' },
          { key: 'turnoverPercent', label: 'Period turnover %', numeric: true },
        ],
        rows: [
          ...joiners.map((row) => ({
            movement: 'Joined',
            employeeNumber: row.employeeNumber,
            department: row.department?.name ?? '—',
            date: row.joinedOn ? dayKey(row.joinedOn) : '',
            turnoverPercent: '',
          })),
          ...leavers.map((row) => ({
            movement: 'Left',
            employeeNumber: row.employeeNumber,
            department: row.department?.name ?? '—',
            date: row.exitedOn ? dayKey(row.exitedOn) : '',
            turnoverPercent: headcount ? Number(((leavers.length / headcount) * 100).toFixed(1)) : 0,
          })),
        ],
      };
    },
  },
  {
    key: 'probation-ending',
    title: 'Probation ending',
    description: 'Employees still in probation, oldest first — the ones a decision is already overdue on.',
    group: 'employees',
    permission: ['employee', 'VIEW'],
    filters: [],
    async run(ctx) {
      const rows = await prisma.employeeProfile.findMany({
        where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: 'PROBATION' },
        select: { employeeNumber: true, joinedOn: true, designation: true, department: { select: { name: true } } },
        orderBy: { joinedOn: 'asc' },
        take: MAX_ROWS,
      });
      return {
        columns: [
          { key: 'employeeNumber', label: 'Employee' },
          { key: 'department', label: 'Department' },
          { key: 'designation', label: 'Designation' },
          { key: 'joinedOn', label: 'Joined' },
          { key: 'daysServed', label: 'Days served', numeric: true },
        ],
        rows: rows.map((row) => ({
          employeeNumber: row.employeeNumber,
          department: row.department?.name ?? '—',
          designation: row.designation ?? '—',
          joinedOn: row.joinedOn ? dayKey(row.joinedOn) : '—',
          daysServed: row.joinedOn ? Math.floor((Date.now() - row.joinedOn.getTime()) / 86_400_000) : 0,
        })),
      };
    },
  },

  // ── Attendance ───────────────────────────────────────────────────────────
  {
    key: 'attendance-summary',
    title: 'Attendance summary',
    description: 'Days present, hours worked and average day length per employee.',
    group: 'attendance',
    permission: ['attendance', 'VIEW'],
    filters: ['from', 'to', 'employeeId'],
    async run(ctx, filters) {
      const { from, to } = window(filters);
      const rows = await prisma.hrAttendanceRecord.findMany({
        where: {
          tenantId: ctx.tenantId,
          workDate: { gte: from, lte: to },
          employeeId: filters.employeeId,
        },
        select: {
          employeeId: true,
          workMinutes: true,
          status: true,
          employee: { select: { employeeNumber: true } },
        },
        take: MAX_ROWS,
      });
      const grouped = new Map<string, { employeeNumber: string; days: number; minutes: number }>();
      for (const row of rows) {
        const entry = grouped.get(row.employeeId) ?? {
          employeeNumber: row.employee.employeeNumber,
          days: 0,
          minutes: 0,
        };
        entry.days += 1;
        entry.minutes += row.workMinutes ?? 0;
        grouped.set(row.employeeId, entry);
      }
      return {
        columns: [
          { key: 'employeeNumber', label: 'Employee' },
          { key: 'days', label: 'Days recorded', numeric: true },
          { key: 'hours', label: 'Hours worked', numeric: true },
          { key: 'averageHours', label: 'Avg hours/day', numeric: true },
        ],
        rows: [...grouped.values()].map((entry) => ({
          employeeNumber: entry.employeeNumber,
          days: entry.days,
          hours: Number((entry.minutes / 60).toFixed(1)),
          averageHours: Number((entry.minutes / 60 / entry.days).toFixed(1)),
        })),
      };
    },
  },
  {
    key: 'flagged-punches',
    title: 'Flagged and rejected punches',
    description: 'Every punch the engine did not accept, with the reason — the review queue as a report.',
    group: 'attendance',
    permission: ['attendance', 'APPROVE'],
    filters: ['from', 'to'],
    async run(ctx, filters) {
      const { from, to } = window(filters);
      const rows = await prisma.hrAttendancePunch.findMany({
        where: {
          tenantId: ctx.tenantId,
          serverTime: { gte: from, lte: addDays(to, 1) },
          result: { not: 'ACCEPTED' },
        },
        select: {
          serverTime: true,
          result: true,
          rejectCode: true,
          punchType: true,
          employee: { select: { employeeNumber: true } },
          location: { select: { name: true } },
        },
        orderBy: { serverTime: 'desc' },
        take: MAX_ROWS,
      });
      return {
        columns: [
          { key: 'when', label: 'When' },
          { key: 'employeeNumber', label: 'Employee' },
          { key: 'punchType', label: 'Punch' },
          { key: 'result', label: 'Result' },
          { key: 'reason', label: 'Reason' },
          { key: 'location', label: 'Location' },
        ],
        rows: rows.map((row) => ({
          when: row.serverTime.toISOString(),
          employeeNumber: row.employee.employeeNumber,
          punchType: row.punchType,
          result: row.result,
          reason: row.rejectCode ?? '—',
          location: row.location?.name ?? '—',
        })),
      };
    },
  },
  {
    key: 'overtime-cost',
    title: 'Overtime by employee',
    description: 'Approved overtime hours and the weighted hours payroll will pay for.',
    group: 'attendance',
    permission: ['overtime', 'VIEW'],
    filters: ['from', 'to'],
    async run(ctx, filters) {
      const { from, to } = window(filters);
      const rows = await prisma.hrOvertimeRequest.findMany({
        where: { tenantId: ctx.tenantId, workDate: { gte: from, lte: to }, status: 'APPROVED' },
        select: {
          minutes: true,
          multiplier: true,
          kind: true,
          compensatory: true,
          employee: { select: { employeeNumber: true } },
        },
        take: MAX_ROWS,
      });
      const grouped = new Map<string, { minutes: number; weighted: number; timeOff: number }>();
      for (const row of rows) {
        const entry = grouped.get(row.employee.employeeNumber) ?? { minutes: 0, weighted: 0, timeOff: 0 };
        if (row.compensatory) entry.timeOff += row.minutes;
        else {
          entry.minutes += row.minutes;
          entry.weighted += row.minutes * (row.multiplier ?? 1);
        }
        grouped.set(row.employee.employeeNumber, entry);
      }
      return {
        columns: [
          { key: 'employeeNumber', label: 'Employee' },
          { key: 'hours', label: 'Paid overtime hours', numeric: true },
          { key: 'weightedHours', label: 'Weighted hours', numeric: true },
          { key: 'timeOffHours', label: 'Taken as time off', numeric: true },
        ],
        rows: [...grouped.entries()].map(([employeeNumber, entry]) => ({
          employeeNumber,
          hours: Number((entry.minutes / 60).toFixed(2)),
          weightedHours: Number((entry.weighted / 60).toFixed(2)),
          timeOffHours: Number((entry.timeOff / 60).toFixed(2)),
        })),
      };
    },
  },

  // ── Leave ────────────────────────────────────────────────────────────────
  {
    key: 'leave-balances',
    title: 'Leave balances',
    description: 'Accrued, taken and remaining leave per employee and type.',
    group: 'leave',
    permission: ['leave', 'APPROVE'],
    filters: ['employeeId'],
    async run(ctx, filters) {
      const rows = await prisma.hrLeaveBalance.findMany({
        where: { tenantId: ctx.tenantId, employeeId: filters.employeeId },
        include: { employee: { select: { employeeNumber: true } }, leaveType: { select: { name: true } } },
        take: MAX_ROWS,
      });
      return {
        columns: [
          { key: 'employeeNumber', label: 'Employee' },
          { key: 'leaveType', label: 'Type' },
          { key: 'accrued', label: 'Accrued', numeric: true },
          { key: 'taken', label: 'Taken', numeric: true },
          { key: 'remaining', label: 'Remaining', numeric: true },
        ],
        rows: rows.map((row) => ({
          employeeNumber: row.employee.employeeNumber,
          leaveType: row.leaveType.name,
          accrued: row.accruedDays,
          taken: row.takenDays,
          remaining: Number((row.accruedDays + row.carriedForwardDays - row.takenDays).toFixed(2)),
        })),
      };
    },
  },
  {
    key: 'leave-utilisation',
    title: 'Leave taken in the period',
    description: 'Approved leave by type and department — where the absence actually falls.',
    group: 'leave',
    permission: ['leave', 'APPROVE'],
    filters: ['from', 'to'],
    async run(ctx, filters) {
      const { from, to } = window(filters);
      const rows = await prisma.hrLeaveRequest.findMany({
        where: { tenantId: ctx.tenantId, status: 'APPROVED', startDate: { lte: to }, endDate: { gte: from } },
        include: {
          leaveType: { select: { name: true, paid: true } },
          employee: { select: { department: { select: { name: true } } } },
        },
        take: MAX_ROWS,
      });
      const grouped = new Map<string, { days: number; requests: number; paid: boolean }>();
      for (const row of rows) {
        const key = `${row.employee.department?.name ?? 'Unassigned'}|${row.leaveType.name}`;
        const entry = grouped.get(key) ?? { days: 0, requests: 0, paid: row.leaveType.paid };
        entry.days += row.days;
        entry.requests += 1;
        grouped.set(key, entry);
      }
      return {
        columns: [
          { key: 'department', label: 'Department' },
          { key: 'leaveType', label: 'Type' },
          { key: 'paid', label: 'Paid' },
          { key: 'requests', label: 'Requests', numeric: true },
          { key: 'days', label: 'Days', numeric: true },
        ],
        rows: [...grouped.entries()].map(([key, entry]) => {
          const [department, leaveType] = key.split('|');
          return { department, leaveType, paid: entry.paid ? 'Yes' : 'No', requests: entry.requests, days: entry.days };
        }),
      };
    },
  },

  // ── Lifecycle ────────────────────────────────────────────────────────────
  {
    key: 'onboarding-status',
    title: 'Onboarding and offboarding progress',
    description: 'Checklist completion per employee, and what is overdue.',
    group: 'lifecycle',
    permission: ['employee', 'VIEW'],
    filters: ['status'],
    async run(ctx, filters) {
      const rows = await prisma.hrChecklistTask.findMany({
        where: { tenantId: ctx.tenantId, phase: filters.status as 'ONBOARDING' | 'OFFBOARDING' | undefined },
        include: { employee: { select: { employeeNumber: true } } },
        take: MAX_ROWS,
      });
      const grouped = new Map<string, { phase: string; total: number; done: number; overdue: number }>();
      for (const row of rows) {
        const key = `${row.employee.employeeNumber}|${row.phase}`;
        const entry = grouped.get(key) ?? { phase: row.phase, total: 0, done: 0, overdue: 0 };
        entry.total += 1;
        if (row.completedAt) entry.done += 1;
        else if (row.dueDate && row.dueDate < new Date()) entry.overdue += 1;
        grouped.set(key, entry);
      }
      return {
        columns: [
          { key: 'employeeNumber', label: 'Employee' },
          { key: 'phase', label: 'Phase' },
          { key: 'done', label: 'Complete', numeric: true },
          { key: 'total', label: 'Tasks', numeric: true },
          { key: 'overdue', label: 'Overdue', numeric: true },
          { key: 'percent', label: '% complete', numeric: true },
        ],
        rows: [...grouped.entries()].map(([key, entry]) => ({
          employeeNumber: key.split('|')[0],
          phase: entry.phase,
          done: entry.done,
          total: entry.total,
          overdue: entry.overdue,
          percent: Math.round((entry.done / entry.total) * 100),
        })),
      };
    },
  },
  {
    key: 'expiring-documents',
    title: 'Expiring documents',
    description: 'Visas, Emirates IDs, passports and labour cards approaching expiry, soonest first.',
    group: 'lifecycle',
    permission: ['hr_documents', 'VIEW_SENSITIVE_FIELDS'],
    filters: ['to'],
    async run(ctx, filters) {
      const horizon = filters.to ?? addDays(new Date(), 90);
      const rows = await prisma.hrEmployeeDocument.findMany({
        where: { tenantId: ctx.tenantId, expiresAt: { not: null, lte: horizon } },
        include: { employee: { select: { employeeNumber: true } } },
        orderBy: { expiresAt: 'asc' },
        take: MAX_ROWS,
      });
      return {
        columns: [
          { key: 'employeeNumber', label: 'Employee' },
          { key: 'kind', label: 'Document' },
          { key: 'expiresOn', label: 'Expires' },
          { key: 'daysRemaining', label: 'Days remaining', numeric: true },
        ],
        rows: rows.map((row) => ({
          employeeNumber: row.employee.employeeNumber,
          kind: row.kind,
          expiresOn: row.expiresAt ? dayKey(row.expiresAt) : '—',
          daysRemaining: row.expiresAt
            ? Math.floor((toDay(row.expiresAt).getTime() - toDay(new Date()).getTime()) / 86_400_000)
            : 0,
        })),
      };
    },
  },

  // ── Payroll ──────────────────────────────────────────────────────────────
  {
    key: 'payroll-register',
    title: 'Payroll register',
    description: 'Every payslip in a run: basic, gross, deductions and net.',
    group: 'payroll',
    permission: ['payroll', 'VIEW'],
    filters: ['from', 'to'],
    async run(ctx, filters) {
      const { from, to } = window(filters);
      const rows = await prisma.hrPayslip.findMany({
        where: { tenantId: ctx.tenantId, run: { periodStart: { gte: addDays(from, -31) }, periodEnd: { lte: to } } },
        include: {
          employee: { select: { employeeNumber: true, department: { select: { name: true } } } },
          run: { select: { periodStart: true, periodEnd: true, status: true } },
        },
        take: MAX_ROWS,
      });
      return {
        columns: [
          { key: 'period', label: 'Period' },
          { key: 'employeeNumber', label: 'Employee' },
          { key: 'department', label: 'Department' },
          { key: 'basic', label: 'Basic', numeric: true },
          { key: 'gross', label: 'Gross', numeric: true },
          { key: 'deductions', label: 'Deductions', numeric: true },
          { key: 'net', label: 'Net', numeric: true },
          { key: 'runStatus', label: 'Run status' },
        ],
        rows: rows.map((row) => ({
          period: `${dayKey(row.run.periodStart)} – ${dayKey(row.run.periodEnd)}`,
          employeeNumber: row.employee.employeeNumber,
          department: row.employee.department?.name ?? '—',
          basic: num(row.basic),
          gross: num(row.grossEarnings),
          deductions: num(row.totalDeductions),
          net: num(row.netPay),
          runStatus: row.run.status,
        })),
      };
    },
  },
  {
    key: 'salary-cost-by-department',
    title: 'Salary cost by department',
    description: 'What each department costs per payroll run, and the average per head.',
    group: 'payroll',
    permission: ['payroll', 'VIEW'],
    filters: ['from', 'to'],
    async run(ctx, filters) {
      const { from, to } = window(filters);
      const rows = await prisma.hrPayslip.findMany({
        where: { tenantId: ctx.tenantId, run: { periodStart: { gte: addDays(from, -31) }, periodEnd: { lte: to } } },
        include: { employee: { select: { department: { select: { name: true } } } } },
        take: MAX_ROWS,
      });
      const grouped = new Map<string, { net: number; gross: number; count: number }>();
      for (const row of rows) {
        const name = row.employee.department?.name ?? 'Unassigned';
        const entry = grouped.get(name) ?? { net: 0, gross: 0, count: 0 };
        entry.net += num(row.netPay);
        entry.gross += num(row.grossEarnings);
        entry.count += 1;
        grouped.set(name, entry);
      }
      return {
        columns: [
          { key: 'department', label: 'Department' },
          { key: 'payslips', label: 'Payslips', numeric: true },
          { key: 'gross', label: 'Gross', numeric: true },
          { key: 'net', label: 'Net', numeric: true },
          { key: 'averageNet', label: 'Average net', numeric: true },
        ],
        rows: [...grouped.entries()]
          .map(([department, entry]) => ({
            department,
            payslips: entry.count,
            gross: Number(entry.gross.toFixed(2)),
            net: Number(entry.net.toFixed(2)),
            averageNet: Number((entry.net / entry.count).toFixed(2)),
          }))
          .sort((a, b) => b.net - a.net),
      };
    },
  },

  // ── Recruitment ──────────────────────────────────────────────────────────
  {
    key: 'open-positions',
    title: 'Open positions',
    description: 'Approved requisitions still open, with how many people are in each pipeline.',
    group: 'recruitment',
    permission: ['recruitment', 'VIEW'],
    filters: [],
    async run(ctx) {
      const rows = await prisma.hrRequisition.findMany({
        where: { tenantId: ctx.tenantId, status: { in: ['OPEN', 'ON_HOLD'] } },
        include: { department: { select: { name: true } }, _count: { select: { candidates: true } } },
        take: MAX_ROWS,
      });
      return {
        columns: [
          { key: 'title', label: 'Role' },
          { key: 'department', label: 'Department' },
          { key: 'openings', label: 'Openings', numeric: true },
          { key: 'candidates', label: 'Candidates', numeric: true },
          { key: 'status', label: 'Status' },
          { key: 'openedOn', label: 'Approved' },
          { key: 'daysOpen', label: 'Days open', numeric: true },
        ],
        rows: rows.map((row) => ({
          title: row.title,
          department: row.department?.name ?? '—',
          openings: row.openings,
          candidates: row._count.candidates,
          status: row.status,
          openedOn: row.approvedAt ? dayKey(row.approvedAt) : '—',
          daysOpen: row.approvedAt ? Math.floor((Date.now() - row.approvedAt.getTime()) / 86_400_000) : 0,
        })),
      };
    },
  },
  {
    key: 'candidates-by-stage',
    title: 'Candidates by stage',
    description: 'The pipeline across every requisition, and where people are stuck.',
    group: 'recruitment',
    permission: ['recruitment', 'VIEW'],
    filters: [],
    async run(ctx) {
      const rows = await prisma.hrCandidate.groupBy({
        by: ['stage'],
        where: { tenantId: ctx.tenantId },
        _count: { _all: true },
      });
      const total = rows.reduce((sum, row) => sum + row._count._all, 0);
      return {
        columns: [
          { key: 'stage', label: 'Stage' },
          { key: 'candidates', label: 'Candidates', numeric: true },
          { key: 'share', label: 'Share %', numeric: true },
        ],
        rows: rows.map((row) => ({
          stage: row.stage,
          candidates: row._count._all,
          share: total ? Number(((row._count._all / total) * 100).toFixed(1)) : 0,
        })),
      };
    },
  },

  // ── Performance ──────────────────────────────────────────────────────────
  {
    key: 'rating-distribution',
    title: 'Rating distribution',
    description: 'Final ratings across a cycle — the curve calibration is meant to produce.',
    group: 'performance',
    permission: ['performance', 'VIEW'],
    filters: ['cycleId'],
    async run(ctx, filters) {
      const rows = await prisma.hrReview.groupBy({
        by: ['finalRating'],
        where: { tenantId: ctx.tenantId, cycleId: filters.cycleId, finalRating: { not: null } },
        _count: { _all: true },
      });
      const total = rows.reduce((sum, row) => sum + row._count._all, 0);
      return {
        columns: [
          { key: 'rating', label: 'Final rating' },
          { key: 'employees', label: 'Employees', numeric: true },
          { key: 'share', label: 'Share %', numeric: true },
        ],
        rows: rows
          .map((row) => ({
            rating: row.finalRating,
            employees: row._count._all,
            share: total ? Number(((row._count._all / total) * 100).toFixed(1)) : 0,
          }))
          .sort((a, b) => Number(a.rating) - Number(b.rating)),
      };
    },
  },
  {
    key: 'overdue-reviews',
    title: 'Overdue reviews',
    description: 'Reviews not yet complete, and whose desk each is sitting on.',
    group: 'performance',
    permission: ['performance', 'VIEW'],
    filters: ['cycleId'],
    async run(ctx, filters) {
      const rows = await prisma.hrReview.findMany({
        where: { tenantId: ctx.tenantId, cycleId: filters.cycleId, status: { not: 'COMPLETE' } },
        include: {
          employee: { select: { employeeNumber: true } },
          manager: { select: { employeeNumber: true } },
          cycle: { select: { name: true, selfReviewDueAt: true, managerReviewDueAt: true } },
        },
        take: MAX_ROWS,
      });
      return {
        columns: [
          { key: 'cycle', label: 'Cycle' },
          { key: 'employeeNumber', label: 'Employee' },
          { key: 'status', label: 'Waiting on' },
          { key: 'manager', label: 'Manager' },
          { key: 'dueOn', label: 'Due' },
        ],
        rows: rows.map((row) => ({
          cycle: row.cycle.name,
          employeeNumber: row.employee.employeeNumber,
          status: WAITING_ON[row.status] ?? row.status,
          manager: row.manager?.employeeNumber ?? '—',
          dueOn:
            row.status === 'PENDING_SELF'
              ? row.cycle.selfReviewDueAt
                ? dayKey(row.cycle.selfReviewDueAt)
                : '—'
              : row.cycle.managerReviewDueAt
                ? dayKey(row.cycle.managerReviewDueAt)
                : '—',
        })),
      };
    },
  },
  {
    key: 'pip-status',
    title: 'Improvement plans',
    description: 'Open and closed plans, with checkpoint progress and acknowledgement.',
    group: 'performance',
    permission: ['performance', 'VIEW'],
    filters: [],
    async run(ctx) {
      const rows = await prisma.hrPip.findMany({
        where: { tenantId: ctx.tenantId },
        include: {
          employee: { select: { employeeNumber: true } },
          checkpoints: { select: { completedAt: true, met: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
      });
      return {
        columns: [
          { key: 'employeeNumber', label: 'Employee' },
          { key: 'status', label: 'Status' },
          { key: 'window', label: 'Window' },
          { key: 'checkpointsMet', label: 'Checkpoints met', numeric: true },
          { key: 'checkpoints', label: 'Checkpoints', numeric: true },
          { key: 'acknowledged', label: 'Acknowledged' },
        ],
        rows: rows.map((row) => ({
          employeeNumber: row.employee.employeeNumber,
          status: row.status.replace(/_/g, ' '),
          window: `${dayKey(row.startsOn)} – ${dayKey(row.endsOn)}`,
          checkpointsMet: row.checkpoints.filter((checkpoint) => checkpoint.met).length,
          checkpoints: row.checkpoints.length,
          acknowledged: row.acknowledgedAt ? dayKey(row.acknowledgedAt) : 'No',
        })),
      };
    },
  },
];

const WAITING_ON: Record<string, string> = {
  PENDING_SELF: 'Employee (self-assessment)',
  PENDING_MANAGER: 'Manager',
  CALIBRATION: 'HR (calibration)',
  AWAITING_ACKNOWLEDGEMENT: 'Employee (acknowledgement)',
};

const byKey = new Map(REPORTS.map((report) => [report.key, report]));

/** The floor for reaching reporting at all. Each report then asserts its own data permission. */
const mayReport = (ctx: Ctx) => can(ctx, 'hr_reports', 'VIEW') || can(ctx, 'employee', 'VIEW');

/** The reports this caller may actually run. The UI renders exactly this list. */
export function availableReports(ctx: Ctx) {
  if (!mayReport(ctx)) return [];
  return REPORTS.filter((report) => can(ctx, report.permission[0], report.permission[1])).map((report) => ({
    key: report.key,
    title: report.title,
    description: report.description,
    group: report.group,
    filters: report.filters,
  }));
}

/**
 * Resolve and authorise a report. The single gate the run endpoint, the CSV
 * export and the page all pass through — which is what makes an export unable to
 * leak a report the screen would have hidden.
 */
function resolve(ctx: Ctx, key: string): ReportDefinition {
  if (!mayReport(ctx)) throw Forbidden('Your role does not allow reporting.');
  const report = byKey.get(key);
  if (!report) throw NotFound('Report');
  if (!can(ctx, report.permission[0], report.permission[1]))
    throw Forbidden(`This report needs ${report.permission[0]}:${report.permission[1]}.`);
  return report;
}

export async function runReport(ctx: Ctx, key: string, filters: ReportFilters = {}) {
  const report = resolve(ctx, key);
  const result = await report.run(ctx, filters);
  return { key: report.key, title: report.title, ...result };
}

/**
 * The same report as a CSV.
 *
 * Exports are audited where runs are not: a report on screen is a look, an
 * export is a copy leaving the building, and §105 asks for access to sensitive
 * information to be logged.
 */
export async function exportReportCsv(ctx: Ctx, key: string, filters: ReportFilters = {}) {
  const report = resolve(ctx, key);
  const result = await report.run(ctx, filters);

  const lines = [
    result.columns.map((column) => csvCell(column.label)).join(','),
    ...result.rows.map((row) => result.columns.map((column) => csvCell(row[column.key])).join(',')),
  ];

  await audit(ctx, {
    event: 'EXPORT_REQUESTED',
    objectType: 'hr_report',
    recordId: report.key,
    metadata: {
      action: 'reports.exported',
      report: report.key,
      rows: result.rows.length,
      permission: `${report.permission[0]}:${report.permission[1]}`,
      filters: { ...filters, from: filters.from?.toISOString(), to: filters.to?.toISOString() },
    },
  });

  return {
    filename: `${report.key}-${dayKey(new Date())}.csv`,
    // The BOM makes Excel read UTF-8 rather than the system codepage, which is
    // what mangles Arabic names in an otherwise correct file.
    // Written as an escape rather than a literal BOM: an invisible character in
    // source is the kind of thing a later edit silently deletes.
    content: `\ufeff${lines.join('\r\n')}\r\n`,
    rows: result.rows.length,
  };
}

/**
 * RFC 4180 quoting, plus the formula-injection guard: a cell starting `=`, `+`,
 * `-` or `@` is executed by Excel on open, and an employee-supplied name is one
 * of the values in these reports.
 *
 * Deliberately duplicated from the leads export rather than shared: that route
 * streams its own CSV and moving the helper would couple a sales export path to
 * an HR one for four lines.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
