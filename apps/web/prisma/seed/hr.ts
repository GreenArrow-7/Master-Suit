/**
 * Master Suite — demo HRMS chain for the primary workspace.
 *
 * Everything the People module needs to look like a working HR system:
 * departments, designations, shifts, a holiday calendar, leave types, leave
 * balances, leave requests in every decided state, and attendance history.
 *
 * Split from index.ts for the same reason crm.ts is: this is pure record
 * generation. It creates no tenant, no login and no membership, and it never
 * writes an identity record. It works on top of whatever employee profiles the
 * workspace already has — see the note on population below.
 *
 * SPEC-0007. Deterministic under the caller's PRNG, so two runs from one
 * SEED_KEY produce the same rows and a screenshot stays valid.
 *
 * ── Population ──────────────────────────────────────────────────────────────
 *
 * This generator does not create employees. index.ts already creates one
 * EmployeeProfile per seeded user — 40 of them — and inventing a second,
 * parallel population would give the workspace two sets of people who do not
 * appear in each other's screens.
 *
 * SPEC-0007/FR-002 was written expecting 24 to 30. The workspace holds 41.
 * Covering only some of them would leave the rest with an empty attendance
 * record while still appearing in the directory, which SPEC-0007/FR-008
 * forbids. CHG-001 replaced the cap with an invariant — *every* active profile
 * is covered — and that is what this file implements. 41 is the current fixture
 * expectation, not a ceiling: nothing here is bounded by it.
 */
import type { PrismaClient } from '@prisma/client';

export interface HrCtx {
  tenantId: string;
  rnd: () => number;
  pick: <T>(xs: readonly T[]) => T;
  int: (min: number, max: number) => number;
  chance: (p: number) => boolean;
}

export interface HrCounts {
  departments: number;
  designations: number;
  shifts: number;
  holidays: number;
  leaveTypes: number;
  employeesProfiled: number;
  managers: number;
  leaveBalances: number;
  leaveRequests: { approved: number; pending: number; rejected: number };
  attendance: number;
  attendanceDays: number;
}

/** Working week is Sunday to Thursday, as the rest of the seed assumes. */
const WORKING_DAYS = [0, 1, 2, 3, 4];

/** Days of attendance history. Inside SPEC-0007/FR-007's 30-to-60 range. */
const ATTENDANCE_DAYS = 45;

/**
 * Five departments — SPEC-0007/FR-001.
 *
 * Four of these already exist: index.ts creates SALES, MKTG, SERV and OPS for
 * the Sales seed's teams. Only FIN is new. Inventing a parallel People and
 * Technology pair, as the first draft of this file did, produced seven
 * departments of which three had no employees in them — a directory listing
 * empty departments is the kind of unintended empty state SPEC-0007/FR-008
 * exists to prevent, and AD-009 already says to reuse rather than duplicate.
 *
 * Names must match the existing rows exactly, because the upsert below writes
 * `name` and would otherwise rename a department the Sales seed depends on.
 */
const DEPARTMENTS: [code: string, name: string][] = [
  ['SALES', 'Sales'],
  ['MKTG', 'Marketing'],
  ['SERV', 'Client Services'],
  ['OPS', 'Operations'],
  ['FIN', 'Finance'],
];

/**
 * Which department a seeded role belongs to. Anything unlisted lands in OPS.
 *
 * Every role the seed actually creates is mapped, and the mapping was checked
 * against the seeded population rather than guessed: no department is left
 * without employees.
 */
const ROLE_DEPARTMENT: Record<string, string> = {
  // Sales floor
  sales_director: 'SALES',
  regional_manager: 'SALES',
  branch_manager: 'SALES',
  team_manager: 'SALES',
  sales_rep: 'SALES',
  field_rep: 'SALES',
  // Marketing
  marketing_manager: 'MKTG',
  marketing_exec: 'MKTG',
  // Client services, including call quality
  service_manager: 'SERV',
  service_agent: 'SERV',
  call_qa: 'SERV',
  // Operations and administration
  org_admin: 'OPS',
  super_admin: 'OPS',
  it_admin: 'OPS',
  read_only: 'OPS',
  employee: 'OPS',
  dept_manager: 'OPS',
  site_manager: 'OPS',
  hr_admin: 'OPS',
  hr_executive: 'OPS',
  recruiter: 'OPS',
  // Finance
  analyst: 'FIN',
  finance_admin: 'FIN',
  payroll_officer: 'FIN',
  auditor: 'FIN',
  executive_read_only: 'FIN',
};

const DESIGNATIONS: [code: string, name: string][] = [
  ['DIR', 'Director'],
  ['MGR', 'Manager'],
  ['LEAD', 'Team Lead'],
  ['SNR', 'Senior Associate'],
  ['ASSOC', 'Associate'],
  ['EXEC', 'Executive'],
  ['ANLST', 'Analyst'],
  ['COORD', 'Coordinator'],
];

/** Seniority by seeded role, so a director is not called a coordinator. */
const ROLE_DESIGNATION: Record<string, string> = {
  org_admin: 'DIR',
  super_admin: 'DIR',
  sales_director: 'DIR',
  regional_manager: 'MGR',
  branch_manager: 'MGR',
  service_manager: 'MGR',
  marketing_manager: 'MGR',
  hr_admin: 'MGR',
  finance_admin: 'MGR',
  it_admin: 'MGR',
  team_manager: 'LEAD',
  dept_manager: 'LEAD',
  site_manager: 'LEAD',
  call_qa: 'LEAD',
  sales_rep: 'ASSOC',
  field_rep: 'ASSOC',
  service_agent: 'ASSOC',
  marketing_exec: 'EXEC',
  hr_executive: 'EXEC',
  recruiter: 'EXEC',
  analyst: 'ANLST',
  auditor: 'ANLST',
  payroll_officer: 'ANLST',
  executive_read_only: 'SNR',
  read_only: 'COORD',
  employee: 'COORD',
};

const SHIFTS: [code: string, name: string, start: string, end: string][] = [
  ['GEN', 'General shift', '09:00', '18:00'],
  ['LATE', 'Late shift', '13:00', '22:00'],
];

/**
 * A fictional calendar. Invented dates on invented names: this is demo data,
 * not an authority on anyone's public holidays, and a demonstration that
 * asserted real ones would be wrong somewhere every year.
 */
const HOLIDAYS: [name: string, month: number, day: number][] = [
  ['New Year Day', 0, 1],
  ['Spring Recess', 2, 20],
  ['Founders Day', 4, 12],
  ['Midyear Break', 6, 3],
  ['Autumn Festival', 9, 8],
  ['Winter Holiday', 11, 24],
];

const LEAVE_TYPES: [code: string, name: string, allowance: number, paid: boolean][] = [
  ['ANN', 'Annual leave', 30, true],
  ['SICK', 'Sick leave', 15, true],
  ['COMP', 'Compassionate leave', 5, true],
  ['UNPAID', 'Unpaid leave', 0, false],
];

const LEAVE_REASONS = [
  'Family visit',
  'Medical appointment',
  'Personal matter',
  'Travel',
  'Rest day',
  'Household matter',
  'Study commitment',
];

/**
 * Everything here is UTC, and that is not a style preference.
 *
 * `workDate` is a *date*, not an instant. Built from local midnight it drifts
 * across the date boundary the moment the host is not on UTC: on a UTC+3
 * machine every Sunday 00:00 local is Saturday 21:00 UTC, so the database
 * — and every report that groups by day — sees attendance on the weekend. The
 * first run of this generator produced exactly that: 360 rows, 40 employees
 * times the 9 Sundays in the window, all landing on Saturday.
 *
 * It also makes the seed host-dependent, which SPEC-0007/NFR-002 forbids and
 * SPEC-0004 exists to stop happening again.
 */
const isWorkingDay = (d: Date) => WORKING_DAYS.includes(d.getUTCDay());

/** UTC midnight, so (tenant, employee, workDate) is stable on any host. */
function dayAt(daysBack: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack));
}

/** The calendar day of an instant, in UTC. The only date key this file uses. */
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** A wall-clock time on a UTC date, without reintroducing local drift. */
function atUtcTime(day: Date, hour: number, minute: number): Date {
  const d = new Date(day);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

export async function seedHr(db: PrismaClient, ctx: HrCtx): Promise<HrCounts> {
  const { tenantId, rnd, pick, int, chance } = ctx;
  const year = new Date().getFullYear();

  // ── 1. Configuration ──────────────────────────────────────────────────────
  const departments = new Map<string, string>();
  for (const [code, name] of DEPARTMENTS) {
    const row = await db.department.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: { name },
      create: { tenantId, code, name },
    });
    departments.set(code, row.id);
  }

  const designations = new Map<string, string>();
  for (const [code, name] of DESIGNATIONS) {
    const row = await db.designation.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: { name },
      create: { tenantId, code, name },
    });
    designations.set(code, row.id);
  }

  for (const [code, name, startTime, endTime] of SHIFTS) {
    await db.hrShift.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: { name, startTime, endTime, workingDays: WORKING_DAYS },
      create: { tenantId, code, name, startTime, endTime, workingDays: WORKING_DAYS, isActive: true },
    });
  }

  for (const [name, month, day] of HOLIDAYS) {
    const holidayDate = new Date(Date.UTC(year, month, day));
    await db.hrHoliday.upsert({
      where: { tenantId_holidayDate_name: { tenantId, holidayDate, name } },
      update: { confirmed: true },
      create: { tenantId, name, holidayDate, confirmed: true },
    });
  }

  const leaveTypes = new Map<string, string>();
  for (const [code, name, annualAllowance, paid] of LEAVE_TYPES) {
    const row = await db.hrLeaveType.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: { name, annualAllowance, paid },
      create: { tenantId, code, name, annualAllowance, paid, isActive: true },
    });
    leaveTypes.set(code, row.id);
  }

  // Holidays are not worked, so attendance must skip them rather than record
  // an absence for everybody on the same day.
  const holidayKeys = new Set(
    HOLIDAYS.map(([, month, day]) => new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10)),
  );

  // ── 2. People ─────────────────────────────────────────────────────────────
  // Ordered by employeeNumber so assignment is stable across runs; the database
  // does not promise insertion order and a demo that reshuffles its org chart
  // on every seed is not deterministic in any useful sense.
  const employees = await db.employeeProfile.findMany({
    where: { tenantId, deletedAt: null, employmentStatus: 'ACTIVE' },
    select: { id: true, membershipId: true, employeeNumber: true, membership: { select: { roleSnapshot: true } } },
    orderBy: { employeeNumber: 'asc' },
  });

  if (employees.length === 0) {
    console.log('  no employee profiles in this workspace — skipping the HR chain');
    return {
      departments: departments.size,
      designations: designations.size,
      shifts: SHIFTS.length,
      holidays: HOLIDAYS.length,
      leaveTypes: leaveTypes.size,
      employeesProfiled: 0,
      managers: 0,
      leaveBalances: 0,
      leaveRequests: { approved: 0, pending: 0, rejected: 0 },
      attendance: 0,
      attendanceDays: 0,
    };
  }

  const departmentOf = (roleKey: string | null) =>
    ROLE_DEPARTMENT[roleKey ?? ''] ?? 'OPS';
  const designationOf = (roleKey: string | null) =>
    ROLE_DESIGNATION[roleKey ?? ''] ?? 'ASSOC';

  // Two levels, built from seniority rather than at random: the most senior
  // profile overall heads the company, the most senior in each department heads
  // that department, everyone else reports to their department head.
  const rank = (roleKey: string | null) => {
    const code = designationOf(roleKey);
    return ['DIR', 'MGR', 'LEAD', 'SNR', 'ASSOC', 'EXEC', 'ANLST', 'COORD'].indexOf(code);
  };

  const byDepartment = new Map<string, typeof employees>();
  for (const e of employees) {
    const dept = departmentOf(e.membership?.roleSnapshot ?? null);
    const list = byDepartment.get(dept) ?? [];
    list.push(e);
    byDepartment.set(dept, list);
  }

  const head = [...employees].sort(
    (a, b) =>
      rank(a.membership?.roleSnapshot ?? null) - rank(b.membership?.roleSnapshot ?? null) ||
      a.employeeNumber.localeCompare(b.employeeNumber),
  )[0]!;

  const departmentHead = new Map<string, (typeof employees)[number]>();
  for (const [dept, list] of byDepartment) {
    const lead = [...list].sort(
      (a, b) =>
        rank(a.membership?.roleSnapshot ?? null) - rank(b.membership?.roleSnapshot ?? null) ||
        a.employeeNumber.localeCompare(b.employeeNumber),
    )[0]!;
    departmentHead.set(dept, lead);
  }

  let managers = 0;
  for (const e of employees) {
    const roleKey = e.membership?.roleSnapshot ?? null;
    const deptCode = departmentOf(roleKey);
    const lead = departmentHead.get(deptCode)!;
    const isHead = e.id === head.id;
    const isLead = e.id === lead.id;
    if (isLead) managers += 1;

    await db.employeeProfile.update({
      where: { id: e.id },
      data: {
        departmentId: departments.get(deptCode)!,
        departmentCode: deptCode,
        designationId: designations.get(designationOf(roleKey))!,
        // isHead has no manager; a department lead reports to the head;
        // everyone else reports to their own department's lead.
        managerMembershipId: isHead ? null : isLead ? head.membershipId : lead.membershipId,
      },
    });
  }

  // ── 3. Leave balances ─────────────────────────────────────────────────────
  const balanceRows = employees.flatMap((e) =>
    LEAVE_TYPES.map(([code, , allowance]) => ({
      tenantId,
      employeeId: e.id,
      leaveTypeId: leaveTypes.get(code)!,
      year,
      entitledDays: allowance,
      accruedDays: allowance,
      takenDays: 0,
      carriedForwardDays: 0,
    })),
  );
  await db.hrLeaveBalance.createMany({ data: balanceRows, skipDuplicates: true });

  // ── 4. Leave requests ─────────────────────────────────────────────────────
  // Skipped when any already exist: a top-up run must not double the queue.
  const existingLeave = await db.hrLeaveRequest.count({ where: { tenantId } });
  const leaveCounts = { approved: 0, pending: 0, rejected: 0 };

  if (existingLeave === 0) {
    // 18 requests: 9 decided-approved, 5 still waiting, 4 refused. A queue with
    // nothing pending demonstrates nothing, and one with nothing decided looks
    // like a system nobody uses.
    const plan: ('APPROVED' | 'PENDING' | 'REJECTED')[] = [
      ...Array(9).fill('APPROVED'),
      ...Array(5).fill('PENDING'),
      ...Array(4).fill('REJECTED'),
    ];

    const rows = plan.map((status, i) => {
      const employee = employees[(i * 7 + 3) % employees.length]!;
      const roleKey = employee.membership?.roleSnapshot ?? null;
      const lead = departmentHead.get(departmentOf(roleKey))!;
      const typeCode = pick(['ANN', 'ANN', 'SICK', 'COMP', 'UNPAID'] as const);
      const halfDay = chance(0.15);
      const days = halfDay ? 0.5 : int(1, 5);
      // Pending sits in the future; decided leave is in the recent past.
      const start = dayAt(status === 'PENDING' ? -int(3, 25) : int(5, 80));
      const end = new Date(start);
      if (!halfDay) end.setDate(end.getDate() + days - 1);
      const decided = status !== 'PENDING';
      return {
        tenantId,
        employeeId: employee.id,
        leaveTypeId: leaveTypes.get(typeCode)!,
        startDate: start,
        endDate: end,
        days,
        halfDay,
        reason: pick(LEAVE_REASONS),
        status,
        approverId: decided ? lead.id : null,
        decidedAt: decided ? dayAt(int(1, 4)) : null,
        decisionNote:
          status === 'REJECTED' ? 'Cover unavailable for the requested dates.' : decided ? 'Approved.' : null,
      };
    });

    await db.hrLeaveRequest.createMany({ data: rows });
    for (const r of rows) leaveCounts[r.status.toLowerCase() as keyof typeof leaveCounts] += 1;

    // Approved leave has to show up in the balance it consumed, or the balance
    // screen contradicts the leave screen.
    for (const r of rows.filter((x) => x.status === 'APPROVED')) {
      await db.hrLeaveBalance.updateMany({
        where: { tenantId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year },
        data: { takenDays: { increment: r.days } },
      });
    }
  } else {
    const grouped = await db.hrLeaveRequest.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { _all: true },
    });
    for (const g of grouped) {
      const key = String(g.status).toLowerCase();
      if (key in leaveCounts) leaveCounts[key as keyof typeof leaveCounts] = g._count._all;
    }
  }

  // ── 5. Attendance ─────────────────────────────────────────────────────────
  // Also guarded: attendance is the highest-volume table here and a top-up run
  // that regenerated it would be the slowest part of the seed for no gain.
  const existingAttendance = await db.hrAttendanceRecord.count({ where: { tenantId } });
  let attendance = 0;
  let attendanceDays = 0;

  if (existingAttendance === 0) {
    const workDates: Date[] = [];
    for (let back = 1; back <= ATTENDANCE_DAYS * 2 && workDates.length < ATTENDANCE_DAYS; back += 1) {
      const d = dayAt(back);
      if (isWorkingDay(d) && !holidayKeys.has(dayKey(d))) workDates.push(d);
    }
    attendanceDays = workDates.length;

    // Approved leave already recorded for a person on a date wins over a
    // generated attendance state, so the two modules agree.
    const onLeave = new Set<string>();
    const approved = await db.hrLeaveRequest.findMany({
      where: { tenantId, status: 'APPROVED' },
      select: { employeeId: true, startDate: true, endDate: true },
    });
    for (const a of approved) {
      for (const d of workDates) {
        if (dayKey(d) >= dayKey(a.startDate) && dayKey(d) <= dayKey(a.endDate)) {
          onLeave.add(`${a.employeeId}:${dayKey(d)}`);
        }
      }
    }

    const rows: {
      tenantId: string;
      employeeId: string;
      workDate: Date;
      status: 'PRESENT' | 'LATE' | 'ABSENT' | 'REMOTE' | 'ON_LEAVE';
      checkInAt: Date | null;
      checkOutAt: Date | null;
      workMinutes: number | null;
    }[] = [];

    for (const e of employees) {
      for (const workDate of workDates) {
        const leave = onLeave.has(`${e.id}:${dayKey(workDate)}`);
        // Weighted so the report is believable: mostly present, a little late,
        // occasional remote, rare absence. All-perfect attendance reads as fake.
        const roll = rnd();
        const status = leave
          ? 'ON_LEAVE'
          : roll < 0.8
            ? 'PRESENT'
            : roll < 0.9
              ? 'LATE'
              : roll < 0.97
                ? 'REMOTE'
                : 'ABSENT';

        let checkInAt: Date | null = null;
        let checkOutAt: Date | null = null;
        let workMinutes: number | null = null;

        if (status !== 'ABSENT' && status !== 'ON_LEAVE') {
          // UTC for the same reason workDate is: setHours would put the stamp
          // on the previous or next calendar day depending on the host's zone,
          // so a check-in could land outside the day it belongs to.
          checkInAt = atUtcTime(workDate, 9, status === 'LATE' ? int(16, 55) : int(0, 12));
          checkOutAt = atUtcTime(workDate, 18, int(0, 45));
          workMinutes = Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000);
        }

        rows.push({ tenantId, employeeId: e.id, workDate, status, checkInAt, checkOutAt, workMinutes });
      }
    }

    // Chunked: one createMany of tens of thousands of rows exceeds the
    // parameter limit the driver will accept.
    for (let i = 0; i < rows.length; i += 2000) {
      const chunk = rows.slice(i, i + 2000);
      await db.hrAttendanceRecord.createMany({ data: chunk, skipDuplicates: true });
      attendance += chunk.length;
    }
  } else {
    attendance = existingAttendance;
    attendanceDays = ATTENDANCE_DAYS;
  }

  const counts: HrCounts = {
    departments: departments.size,
    designations: designations.size,
    shifts: SHIFTS.length,
    holidays: HOLIDAYS.length,
    leaveTypes: leaveTypes.size,
    employeesProfiled: employees.length,
    managers,
    leaveBalances: balanceRows.length,
    leaveRequests: leaveCounts,
    attendance,
    attendanceDays,
  };

  console.log(
    `\n  ${counts.departments} departments · ${counts.designations} designations · ${counts.shifts} shifts · ${counts.holidays} holidays · ${counts.leaveTypes} leave types`,
  );
  console.log(
    `  ${counts.employeesProfiled} employees profiled (${counts.managers} managers) · ${counts.leaveBalances} leave balances`,
  );
  console.log(
    `  leave: ${leaveCounts.approved} approved · ${leaveCounts.pending} pending · ${leaveCounts.rejected} rejected`,
  );
  console.log(`  ${counts.attendance} attendance records over ${counts.attendanceDays} working days`);

  return counts;
}

/*
 * There is deliberately no HR teardown list here.
 *
 * SPEC-0007 was written believing the demo reset left HR records behind,
 * because the reset's 47 explicit deleteMany calls name only CRM tables. They
 * do — but the branch ends with `tenant.delete()`, and 187 of the 188 models
 * carrying a tenantId declare `onDelete: Cascade` on their tenant relation, so
 * the database removes them. The one exception is PlatformAuditEvent, whose
 * relation is SetNull on purpose: an audit trail outliving its tenant is the
 * correct behaviour, not an omission.
 *
 * Adding an HR deletion list would therefore be code that deletes rows the
 * next statement deletes anyway, and a second list to keep in step with the
 * schema. Recorded as CHG-002. What was genuinely missing is the guard that
 * proves this stays true — tests/hr/demo-reset-coverage.spec.ts, SPEC-0007/FR-015.
 */
