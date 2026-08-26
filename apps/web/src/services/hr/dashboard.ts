/**
 * Per-role HRMS dashboards (real-estate HRMS §5).
 *
 * The prompt is explicit: a role must get a genuinely different dashboard, not
 * the same one with menu items hidden. The persona is resolved from the actor's
 * *server-side* permissions — never a roleKey string or anything the client
 * sends — so a custom role built from the right permissions lands on the right
 * dashboard, and hiding a card can never be mistaken for enforcing access.
 *
 * Each loader only reads what that persona is entitled to see, at the scope
 * they hold it: an org-scoped HR administrator counts the whole workspace, a
 * team-scoped manager counts their reporting line via the same visibility layer
 * every list uses.
 */
import { prisma, withTx, type TxClient } from '@/lib/db';
import type { Ctx } from '@/lib/security/rbac';
import { can, scopeFor, SCOPE_RANK, type Action } from '@/lib/security/rbac';
import { resolveOwnerIds } from '@/lib/security/visibility';
import { isApprover, isAttendanceApprover, isHrAdmin, mayReadAllEmployees } from './access';
import { myEmployee } from './leave';
import { lifecycleDashboard } from './lifecycle';

export type Persona = 'hr_admin' | 'payroll' | 'recruiter' | 'it_admin' | 'manager' | 'auditor' | 'employee';

/**
 * The one dashboard this actor sees. Ordered by primary function: the first
 * authority they hold wins, so an HR administrator who can also read audit logs
 * gets the HR dashboard, not the auditor's read-only one.
 */
export function resolvePersona(ctx: Ctx): Persona {
  /**
   * Scope matters here, not merely the grant.
   *
   * `can()` is true at any scope above NONE, and the payroll and auditor
   * dashboards below count the *whole workspace* — open payroll runs, every
   * attendance exception, org-wide audit events. Selecting them with a bare
   * `can()` handed those figures to anyone holding the same permission over
   * their own record:
   *
   *   - `payroll:VIEW = OWN`  — an employee reading their own payslip — landed
   *     on "Payroll readiness" showing every run and exception in the company.
   *   - `reports:VIEW = OWN`  — a salesperson reading their own sales figures —
   *     landed on "Compliance & evidence" showing org-wide audit counts.
   *
   * Both are ordinary demo personas, so the HR module opened on a compliance
   * dashboard for most of the workspace. Every role that genuinely owns one of
   * these functions holds the permission at ORGANIZATION; requiring that keeps
   * the selector honest with the loaders, which is what the file header already
   * promises ("only reads what that persona is entitled to see, at the scope
   * they hold it").
   */
  const orgWide = (module: string, action: Action) =>
    SCOPE_RANK[scopeFor(ctx, module, action)] >= SCOPE_RANK.ORGANIZATION;

  if (isHrAdmin(ctx)) return 'hr_admin';
  if (orgWide('payroll', 'VIEW')) return 'payroll';
  if (orgWide('recruitment', 'VIEW') || orgWide('recruitment', 'EDIT')) return 'recruiter';
  if (can(ctx, 'users', 'MANAGE_USERS')) return 'it_admin';
  // A team/branch-scoped approver is a line, property or site manager.
  if (isAttendanceApprover(ctx) || isApprover(ctx)) return 'manager';
  // Read-only compliance: sees the audit trail, or reports across the whole
  // organization, but holds no write authority.
  if (orgWide('auditlogs', 'VIEW') || orgWide('reports', 'VIEW')) return 'auditor';
  return 'employee';
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** A stat with the queue it links into, so the number is a doorway, not decoration. */
export interface Stat {
  label: string;
  value: number | string;
  href?: string;
  tone?: 'ok' | 'warn' | 'bad' | 'muted';
  hint?: string;
}

export interface DashboardData {
  persona: Persona;
  title: string;
  lede: string;
  stats: Stat[];
  /** Optional narrow lists a persona wants surfaced (e.g. joiners, exceptions). */
  sections: {
    heading: string;
    rows: { primary: string; secondary?: string; badge?: string }[];
    empty: string;
    href?: string;
  }[];
}

/** The set of employees a persona may count at their scope. */
async function scopedEmployeeWhere(ctx: Ctx, db: Db): Promise<Record<string, unknown>> {
  if (mayReadAllEmployees(ctx)) return { tenantId: ctx.tenantId, deletedAt: null };
  const scope = scopeFor(ctx, 'employee', 'VIEW');
  if (SCOPE_RANK[scope] <= SCOPE_RANK.OWN) {
    const self = await myEmployee(ctx, db);
    return { tenantId: ctx.tenantId, deletedAt: null, id: self?.id ?? '__none__' };
  }
  const userIds = await resolveOwnerIds(ctx, scope, db);
  return { tenantId: ctx.tenantId, deletedAt: null, membership: { salesUserId: { in: userIds } } };
}

/** Whatever client the caller is on — the pool, or a transaction. */
type Db = typeof prisma | TxClient;

/**
 * One transaction for the whole dashboard, and the reason is measurable.
 *
 * Every Prisma read issued outside a transaction goes through `runPinned` in
 * lib/db, which wraps it in a batched `$transaction([set_config, query])` so
 * the row-level-security policy has a tenant to filter on. That is correct and
 * it is not free: each standalone read costs a `SELECT set_config(...)` and a
 * `COMMIT` of its own.
 *
 * Measured on the People landing before this change: **40 queries, of which 12
 * were `set_config` and 11 were `COMMIT`** — 173 ms of 434 ms spent on
 * transaction bookkeeping rather than on data. No individual query was slower
 * than 21 ms; the cost was entirely in how many round trips there were.
 *
 * Opening one transaction sets the tenant once and commits once, and the
 * persona functions below run their fan-out inside it. `withTx` also sets
 * `inTenantTx`, which tells `runPinned` to stand down — so the reads have to be
 * issued on the `tx` client it hands back. Issuing them on the module-level
 * `prisma` would take a pooled connection where `app.tenant_id` was never set,
 * and RLS would correctly return nothing at all. That is why `db` is threaded
 * through every function in this file rather than left implicit.
 */
export async function loadDashboard(ctx: Ctx): Promise<DashboardData> {
  const persona = resolvePersona(ctx);
  return withTx(ctx.tenantId, (tx) => {
    switch (persona) {
      case 'hr_admin':
        return hrAdmin(ctx, tx);
      case 'payroll':
        return payroll(ctx, tx);
      case 'recruiter':
        return recruiter(ctx, tx);
      case 'it_admin':
        return itAdmin(ctx, tx);
      case 'manager':
        return manager(ctx, tx);
      case 'auditor':
        return auditor(ctx, tx);
      default:
        return employee(ctx, tx);
    }
  });
}

// ── HR Administrator ────────────────────────────────────────────────────────
async function hrAdmin(ctx: Ctx, db: Db): Promise<DashboardData> {
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const [headcount, present, pendingLeave, lifecycle, onNotice] = await Promise.all([
    db.employeeProfile.count({ where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: 'ACTIVE' } }),
    db.hrAttendanceRecord.count({
      where: {
        tenantId: ctx.tenantId,
        workDate: { gte: today, lt: tomorrow },
        status: { in: ['PRESENT', 'LATE', 'REMOTE'] },
      },
    }),
    db.hrLeaveRequest.count({ where: { tenantId: ctx.tenantId, status: 'PENDING' } }),
    lifecycleDashboard(ctx),
    db.employeeProfile.count({ where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: 'NOTICE' } }),
  ]);
  return {
    persona: 'hr_admin',
    title: 'HR operations',
    lede: 'Headcount, attendance, approvals and the lifecycle steps that stop someone working.',
    stats: [
      { label: 'Active headcount', value: headcount, href: 'employees' },
      { label: 'Present today', value: present, href: 'attendance', tone: 'ok' },
      { label: 'Pending leave', value: pendingLeave, href: 'requests', tone: pendingLeave ? 'warn' : 'muted' },
      { label: 'Joining', value: lifecycle.joining.length, href: 'lifecycle' },
      { label: 'On notice', value: onNotice, href: 'lifecycle', tone: onNotice ? 'warn' : 'muted' },
      {
        label: 'Overdue tasks',
        value: lifecycle.overdueTasks,
        href: 'lifecycle',
        tone: lifecycle.overdueTasks ? 'bad' : 'ok',
      },
      { label: 'Docs expiring 60d', value: lifecycle.documentsExpiring60d, href: 'documents', tone: 'warn' },
      {
        label: 'Docs expired',
        value: lifecycle.documentsExpired,
        href: 'documents',
        tone: lifecycle.documentsExpired ? 'bad' : 'ok',
      },
    ],
    sections: [
      {
        heading: 'Joining soon',
        empty: 'No one is joining.',
        href: 'lifecycle',
        rows: lifecycle.joining.slice(0, 6).map((j) => ({
          primary: j.name,
          secondary: `${j.employeeNumber}${j.joinedOn ? ` · joins ${j.joinedOn.toLocaleDateString('en-AE', { timeZone: 'UTC' })}` : ''}`,
          badge: j.openBlockers > 0 ? `${j.openBlockers} blocked` : undefined,
        })),
      },
    ],
  };
}

// ── Payroll / Finance ───────────────────────────────────────────────────────
async function payroll(ctx: Ctx, db: Db): Promise<DashboardData> {
  const today = startOfToday();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [openRuns, exceptions, pendingOt, present] = await Promise.all([
    db.hrPayrollRun.count({ where: { tenantId: ctx.tenantId, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } } }),
    db.hrAttendanceRecord.count({
      where: { tenantId: ctx.tenantId, workDate: { gte: monthStart }, status: { in: ['ABSENT', 'LATE'] } },
    }),
    db.hrOvertimeRequest.count({ where: { tenantId: ctx.tenantId, status: 'PENDING' } }),
    db.hrAttendanceRecord.count({
      where: { tenantId: ctx.tenantId, workDate: { gte: monthStart }, checkOutAt: null, checkInAt: { not: null } },
    }),
  ]);
  return {
    persona: 'payroll',
    title: 'Payroll readiness',
    lede: 'What has to be clean before the run closes: attendance exceptions, overtime, and open sessions.',
    stats: [
      { label: 'Open payroll runs', value: openRuns, href: 'payroll', tone: openRuns ? 'warn' : 'ok' },
      { label: 'Attendance exceptions (MTD)', value: exceptions, href: 'attendance', tone: exceptions ? 'warn' : 'ok' },
      { label: 'Overtime awaiting approval', value: pendingOt, href: 'overtime', tone: pendingOt ? 'warn' : 'muted' },
      { label: 'Unclosed sessions (MTD)', value: present, href: 'attendance', tone: present ? 'bad' : 'ok' },
    ],
    sections: [],
  };
}

// ── Recruiter ───────────────────────────────────────────────────────────────
async function recruiter(ctx: Ctx, db: Db): Promise<DashboardData> {
  const [openReqs, activeCandidates, interviews, offers] = await Promise.all([
    db.hrRequisition.count({ where: { tenantId: ctx.tenantId, status: 'OPEN' } }),
    db.hrCandidate.count({
      where: { tenantId: ctx.tenantId, stage: { notIn: ['HIRED', 'REJECTED', 'WITHDRAWN'] } },
    }),
    db.hrInterview.count({ where: { tenantId: ctx.tenantId, scheduledAt: { gte: new Date() } } }),
    db.hrOffer.count({ where: { tenantId: ctx.tenantId, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'SENT'] } } }),
  ]);
  return {
    persona: 'recruiter',
    title: 'Recruitment pipeline',
    lede: 'Requisitions, candidates in flight, interviews ahead and offers out.',
    stats: [
      { label: 'Open requisitions', value: openReqs, href: 'recruitment' },
      { label: 'Active candidates', value: activeCandidates, href: 'recruitment', tone: 'ok' },
      { label: 'Upcoming interviews', value: interviews, href: 'recruitment' },
      { label: 'Offers in flight', value: offers, href: 'recruitment', tone: offers ? 'warn' : 'muted' },
    ],
    sections: [],
  };
}

// ── IT Administrator ────────────────────────────────────────────────────────
async function itAdmin(ctx: Ctx, db: Db): Promise<DashboardData> {
  const [activeAccounts, suspended, noMfa, joining] = await Promise.all([
    db.user.count({ where: { tenantId: ctx.tenantId, deletedAt: null, status: 'ACTIVE' } }),
    db.user.count({
      where: { tenantId: ctx.tenantId, deletedAt: null, status: { in: ['SUSPENDED', 'DEACTIVATED'] } },
    }),
    db.workspaceMembership.count({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE', platformUser: { mfaEnabled: false } },
    }),
    lifecycleDashboard(ctx).then((l) => l.joining.length),
  ]);
  return {
    persona: 'it_admin',
    title: 'Access & provisioning',
    lede: 'Accounts to provision, access to revoke, and the security posture behind them.',
    stats: [
      { label: 'Active accounts', value: activeAccounts, href: 'users' },
      { label: 'Suspended / inactive', value: suspended, href: 'users', tone: suspended ? 'warn' : 'muted' },
      { label: 'Without 2FA', value: noMfa, href: 'users', tone: noMfa ? 'bad' : 'ok' },
      { label: 'Joiners to provision', value: joining, href: 'lifecycle', tone: joining ? 'warn' : 'muted' },
    ],
    sections: [],
  };
}

// ── Manager (site / property / department) ──────────────────────────────────
async function manager(ctx: Ctx, db: Db): Promise<DashboardData> {
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const where = await scopedEmployeeWhere(ctx, db);
  const self = await myEmployee(ctx, db);

  /**
   * The team is expressed as a relation filter, not as a list of ids.
   *
   * This used to load **every** employee id in scope with an unbounded
   * `findMany` — no `take`, no pagination — and then pass the array into three
   * `IN (…)` counts. On a small team that is merely wasteful; on a large one it
   * is a query with tens of thousands of bound parameters and an id array held
   * in memory for the duration, which is a plausible way to take the render
   * worker down rather than merely slow it.
   *
   * `employee: { is: where }` gives Postgres the same restriction as a join and
   * asks it to do the counting, which is what it is for. `team` is a `count`
   * for the same reason: the row ids were only ever used for `.length`.
   */
  const [team, presentToday, lateToday, pendingLeave] = await Promise.all([
    db.employeeProfile.count({ where }),
    db.hrAttendanceRecord.count({
      where: {
        tenantId: ctx.tenantId,
        employee: { is: where },
        workDate: { gte: today, lt: tomorrow },
        status: { in: ['PRESENT', 'REMOTE'] },
      },
    }),
    db.hrAttendanceRecord.count({
      where: {
        tenantId: ctx.tenantId,
        employee: { is: where },
        workDate: { gte: today, lt: tomorrow },
        status: 'LATE',
      },
    }),
    db.hrLeaveRequest.count({
      where: { tenantId: ctx.tenantId, status: 'PENDING', approverId: self?.id ?? '__none__' },
    }),
  ]);
  const missing = Math.max(0, team - presentToday - lateToday);
  return {
    persona: 'manager',
    title: 'Team on site',
    lede: 'Live coverage for your team: who is in, who is late, who is missing, and what is waiting on you.',
    stats: [
      { label: 'Team size', value: team, href: 'employees' },
      { label: 'On site today', value: presentToday, href: 'attendance', tone: 'ok' },
      { label: 'Late today', value: lateToday, href: 'attendance', tone: lateToday ? 'warn' : 'muted' },
      { label: 'Missing', value: missing, href: 'attendance', tone: missing ? 'bad' : 'ok' },
      { label: 'Leave waiting on you', value: pendingLeave, href: 'requests', tone: pendingLeave ? 'warn' : 'muted' },
    ],
    sections: [],
  };
}

// ── Auditor (read-only) ─────────────────────────────────────────────────────
async function auditor(ctx: Ctx, db: Db): Promise<DashboardData> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [auditEvents, consents, flaggedPunches, exceptions] = await Promise.all([
    db.auditLog.count({ where: { tenantId: ctx.tenantId, occurredAt: { gte: weekAgo } } }),
    db.biometricConsent.count({ where: { tenantId: ctx.tenantId, withdrawnAt: null, grantedAt: { not: null } } }),
    db.hrAttendancePunch.count({ where: { tenantId: ctx.tenantId, result: 'FLAGGED_REVIEW' } }),
    db.hrAttendancePunch.count({
      where: { tenantId: ctx.tenantId, result: { in: ['REJECTED_GEOFENCE', 'REJECTED_FACE'] } },
    }),
  ]);
  return {
    persona: 'auditor',
    title: 'Compliance & evidence',
    lede: 'Read-only: the audit trail, consent records, and the attendance attempts that need review.',
    stats: [
      { label: 'Audit events (7d)', value: auditEvents, href: 'reports' },
      { label: 'Active biometric consents', value: consents, tone: 'ok' },
      {
        label: 'Punches flagged for review',
        value: flaggedPunches,
        href: 'attendance',
        tone: flaggedPunches ? 'warn' : 'ok',
      },
      { label: 'Rejected attempts', value: exceptions, href: 'attendance', tone: exceptions ? 'warn' : 'muted' },
    ],
    sections: [],
  };
}

// ── Employee (self-service) ─────────────────────────────────────────────────
async function employee(ctx: Ctx, db: Db): Promise<DashboardData> {
  const self = await myEmployee(ctx, db);
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const [todayRecord, openLeave, balances] = self
    ? await Promise.all([
        db.hrAttendanceRecord.findFirst({
          where: { tenantId: ctx.tenantId, employeeId: self.id, workDate: { gte: today, lt: tomorrow } },
          select: { checkInAt: true, checkOutAt: true, workMinutes: true },
        }),
        db.hrLeaveRequest.count({ where: { tenantId: ctx.tenantId, employeeId: self.id, status: 'PENDING' } }),
        db.hrLeaveBalance.findMany({
          where: { tenantId: ctx.tenantId, employeeId: self.id },
          include: { leaveType: true },
          take: 4,
        }),
      ])
    : [null, 0, []];

  const worked = todayRecord?.workMinutes
    ? `${Math.floor(todayRecord.workMinutes / 60)}h ${String(todayRecord.workMinutes % 60).padStart(2, '0')}m`
    : todayRecord?.checkInAt
      ? 'Checked in'
      : '—';
  return {
    persona: 'employee',
    title: 'My day',
    lede: 'Your attendance, leave and requests.',
    stats: [
      { label: 'Today', value: worked, href: 'check-in', tone: todayRecord?.checkInAt ? 'ok' : 'muted' },
      { label: 'Open leave requests', value: openLeave, href: 'leave', tone: openLeave ? 'warn' : 'muted' },
      ...balances.map((b) => ({
        label: b.leaveType.name,
        // Remaining = entitled + carried − taken; the same arithmetic the leave
        // page shows, so the two never disagree.
        value: `${Math.max(0, Math.round((b.entitledDays + b.carriedForwardDays - b.takenDays) * 10) / 10)} left`,
      })),
    ],
    sections: [],
  };
}
