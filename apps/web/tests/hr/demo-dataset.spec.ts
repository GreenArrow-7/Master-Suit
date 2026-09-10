/**
 * SPEC-0007 — the HR demo dataset, asserted against a seeded database.
 *
 * These are the cases the specification names: UT-001 to UT-006, UT-009 and
 * the dataset half of IT-001. They replace the manual SQL probes used during
 * implementation, which proved the same things once and could not prove them
 * again tomorrow.
 *
 * Requires a seeded demo database:
 *
 *   ALLOW_DEMO_SEED=yes npm run db:seed -- --reset
 *
 * The suite skips rather than fails when the workspace is absent, because a
 * missing fixture is not a defect in the generator and a red suite that means
 * "you did not seed" trains people to ignore red suites.
 *
 * It connects with a plain client rather than through `@/lib/db`: the tenant
 * guard is designed for request-scoped code with an actor, and these
 * assertions are about what the seed wrote, not about what a user may read.
 * Tenant scoping is asserted explicitly in every query instead.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });

const SLUG = 'youhan-one-demo';
/** Working week is Sunday to Thursday; 5 and 6 are Friday and Saturday. */
const WEEKEND = [5, 6];

let tenantId = '';
let seeded = false;

beforeAll(async () => {
  const tenant = await db.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) return;
  tenantId = tenant.id;
  seeded = (await db.hrAttendanceRecord.count({ where: { tenantId } })) > 0;
});

afterAll(async () => {
  await db.$disconnect();
});

const t = () => ({ tenantId });

describe.skipIf(!process.env.DATABASE_URL)('SPEC-0007 HR demo dataset', () => {
  it('the fixture is present', () => {
    expect(tenantId, `workspace ${SLUG} is not seeded; run the demo seed first`).not.toBe('');
    expect(seeded, 'the workspace has no attendance; run the demo seed first').toBe(true);
  });

  // ── UT-001 · FR-001, FR-002 ───────────────────────────────────────────────
  it('UT-001 every active employee carries a department and a designation', async () => {
    if (!seeded) return;
    const active = await db.employeeProfile.findMany({
      where: { ...t(), employmentStatus: 'ACTIVE', deletedAt: null },
      select: { employeeNumber: true, departmentId: true, designationId: true },
    });

    // CHG-001 replaced the old 24-to-30 cap with an invariant over the whole
    // population plus a floor. Asserting a floor and completeness, not a
    // ceiling: the fixture currently holds 40 and must not be pinned to it.
    expect(active.length).toBeGreaterThanOrEqual(24);

    const missingDepartment = active.filter((e) => !e.departmentId).map((e) => e.employeeNumber);
    const missingDesignation = active.filter((e) => !e.designationId).map((e) => e.employeeNumber);
    expect(missingDepartment, 'active employees with no department').toEqual([]);
    expect(missingDesignation, 'active employees with no designation').toEqual([]);

    const departments = await db.department.count({ where: t() });
    expect(departments).toBe(5);
  });

  it('UT-001b no department is empty', async () => {
    if (!seeded) return;
    const departments = await db.department.findMany({ where: t(), select: { id: true, code: true } });
    const empty: string[] = [];
    for (const d of departments) {
      const n = await db.employeeProfile.count({
        where: { ...t(), departmentId: d.id, employmentStatus: 'ACTIVE', deletedAt: null },
      });
      if (n === 0) empty.push(d.code);
    }
    // A directory listing departments nobody works in is the unintended empty
    // state FR-008 forbids, and the first draft of the generator produced three.
    expect(empty, 'departments with no active employees').toEqual([]);
  });

  // ── UT-002 · FR-003 ───────────────────────────────────────────────────────
  it('UT-002 the reporting hierarchy has one head, no cycles, and real managers', async () => {
    if (!seeded) return;
    const active = await db.employeeProfile.findMany({
      where: { ...t(), employmentStatus: 'ACTIVE', deletedAt: null },
      select: { id: true, employeeNumber: true, membershipId: true, managerMembershipId: true },
    });

    const heads = active.filter((e) => !e.managerMembershipId);
    expect(
      heads.map((h) => h.employeeNumber),
      'exactly one employee has no manager',
    ).toHaveLength(1);

    const byMembership = new Map(active.map((e) => [e.membershipId, e]));
    for (const e of active) {
      if (!e.managerMembershipId) continue;
      expect(
        byMembership.has(e.managerMembershipId),
        `${e.employeeNumber} reports to a membership that is not an active employee`,
      ).toBe(true);
      expect(e.managerMembershipId, `${e.employeeNumber} manages itself`).not.toBe(e.membershipId);
    }

    // Walk to the root from every node: a cycle would never terminate.
    for (const start of active) {
      const seen = new Set<string>();
      let cur: typeof start | undefined = start;
      while (cur?.managerMembershipId) {
        expect(seen.has(cur.membershipId), `cycle in the hierarchy at ${cur.employeeNumber}`).toBe(false);
        seen.add(cur.membershipId);
        cur = byMembership.get(cur.managerMembershipId);
      }
    }

    // At least two levels: somebody reports to somebody who reports to the head.
    const depth2 = active.filter((e) => {
      const mgr = e.managerMembershipId ? byMembership.get(e.managerMembershipId) : undefined;
      return Boolean(mgr?.managerMembershipId);
    });
    expect(depth2.length, 'the hierarchy is only one level deep').toBeGreaterThan(0);
  });

  // ── UT-003 · FR-006, FR-007 ───────────────────────────────────────────────
  it('UT-003 leave and attendance both show real variety', async () => {
    if (!seeded) return;
    const leave = await db.hrLeaveRequest.groupBy({ by: ['status'], where: t(), _count: { _all: true } });
    const byStatus = Object.fromEntries(leave.map((g) => [g.status, g._count._all]));
    for (const s of ['APPROVED', 'PENDING', 'REJECTED']) {
      expect(byStatus[s] ?? 0, `no ${s} leave requests — the approval queue would look dead`).toBeGreaterThan(0);
    }

    const attendance = await db.hrAttendanceRecord.groupBy({
      by: ['status'],
      where: t(),
      _count: { _all: true },
    });
    const seenStatuses = attendance.map((g) => String(g.status));
    // Not all-present: perfect attendance across 40 people for 45 days reads as
    // generated, and the reports have nothing to show.
    expect(seenStatuses).toContain('PRESENT');
    expect(seenStatuses).toContain('LATE');
    expect(seenStatuses).toContain('ABSENT');
    expect(seenStatuses.length, 'attendance uses too few statuses to look real').toBeGreaterThanOrEqual(4);

    const total = attendance.reduce((n, g) => n + g._count._all, 0);
    const present = attendance.find((g) => String(g.status) === 'PRESENT')?._count._all ?? 0;
    expect(present / total, 'present rate should look like a real office').toBeGreaterThan(0.6);
    expect(present / total).toBeLessThan(0.95);
  });

  // ── UT-004, UT-005, UT-006 · DATA-001 to DATA-004 ─────────────────────────
  it('UT-005 no payroll, bank or biometric record exists', async () => {
    if (!seeded) return;
    const forbidden: Record<string, number> = {
      HrCompensation: await db.hrCompensation.count({ where: t() }),
      HrPayrollRun: await db.hrPayrollRun.count({ where: t() }),
      HrPayslip: await db.hrPayslip.count({ where: t() }),
      HrFaceTemplate: await db.hrFaceTemplate.count({ where: t() }),
      BiometricConsent: await db.biometricConsent.count({ where: t() }),
      HrAttendancePunch: await db.hrAttendancePunch.count({ where: t() }),
    };
    expect(forbidden).toEqual({
      HrCompensation: 0,
      HrPayrollRun: 0,
      HrPayslip: 0,
      HrFaceTemplate: 0,
      BiometricConsent: 0,
      HrAttendancePunch: 0,
    });

    const banked = await db.employeeProfile.count({
      where: {
        ...t(),
        OR: [
          { iban: { not: null } },
          { bankName: { not: null } },
          { bankAgentId: { not: null } },
          { wpsPersonId: { not: null } },
          { basicSalary: { not: null } },
          { totalSalary: { not: null } },
        ],
      },
    });
    expect(banked, 'an employee profile carries salary or bank data').toBe(0);
  });

  // ── UT-009 · FR-004, FR-007 ───────────────────────────────────────────────
  it('UT-009 attendance falls only on working days, never a weekend or a holiday', async () => {
    if (!seeded) return;
    const rows = await db.hrAttendanceRecord.findMany({
      where: t(),
      select: { workDate: true },
      distinct: ['workDate'],
    });
    expect(rows.length).toBeGreaterThanOrEqual(30);
    expect(rows.length).toBeLessThanOrEqual(60);

    const weekend = rows.filter((r) => WEEKEND.includes(r.workDate.getUTCDay()));
    expect(
      weekend.map((r) => r.workDate.toISOString().slice(0, 10)),
      'attendance on a weekend',
    ).toEqual([]);

    const holidays = await db.hrHoliday.findMany({ where: t(), select: { holidayDate: true } });
    const holidayKeys = new Set(holidays.map((h) => h.holidayDate.toISOString().slice(0, 10)));
    const onHoliday = rows.map((r) => r.workDate.toISOString().slice(0, 10)).filter((k) => holidayKeys.has(k));
    expect(onHoliday, 'attendance on a holiday').toEqual([]);
  });

  /**
   * The timezone regression.
   *
   * This is the case that fails against the original implementation, which
   * built workDate from local midnight. On any host east of UTC that put every
   * Sunday's record on the preceding Saturday — 360 rows on the machine where
   * it was found. UT-009 above catches the weekend symptom; this catches the
   * cause, so the fix cannot be undone by someone who "cleans up" the UTC
   * helpers without understanding them.
   */
  it('UT-009b every stored date is exactly UTC midnight, independent of the host', async () => {
    if (!seeded) return;
    const rows = await db.hrAttendanceRecord.findMany({ where: t(), select: { workDate: true }, take: 500 });
    const offenders = rows
      .filter((r) => r.workDate.getUTCHours() !== 0 || r.workDate.getUTCMinutes() !== 0)
      .map((r) => r.workDate.toISOString());
    expect(offenders, 'workDate is not UTC midnight — local time has leaked back in').toEqual([]);

    const holidays = await db.hrHoliday.findMany({ where: t(), select: { holidayDate: true } });
    expect(holidays.filter((h) => h.holidayDate.getUTCHours() !== 0)).toEqual([]);
  });

  it('UT-009c a check-in never lands outside the day it belongs to', async () => {
    if (!seeded) return;
    const rows = await db.hrAttendanceRecord.findMany({
      where: { ...t(), checkInAt: { not: null } },
      select: { workDate: true, checkInAt: true, checkOutAt: true },
      take: 800,
    });
    expect(rows.length).toBeGreaterThan(0);
    const key = (d: Date) => d.toISOString().slice(0, 10);
    const drifted = rows.filter((r) => key(r.checkInAt!) !== key(r.workDate));
    expect(drifted.length, 'a check-in is stamped on a different day than its workDate').toBe(0);
    const backwards = rows.filter((r) => r.checkOutAt && r.checkOutAt <= r.checkInAt!);
    expect(backwards.length, 'a check-out is not after its check-in').toBe(0);
  });

  // ── IT-001 dataset half · FR-004, FR-005 ──────────────────────────────────
  it('IT-001 configuration and balances are complete for every active employee', async () => {
    if (!seeded) return;
    const active = await db.employeeProfile.count({ where: { ...t(), employmentStatus: 'ACTIVE', deletedAt: null } });
    const leaveTypes = await db.hrLeaveType.count({ where: t() });
    const balances = await db.hrLeaveBalance.count({ where: t() });

    expect(await db.hrShift.count({ where: t() })).toBeGreaterThanOrEqual(2);
    expect(await db.hrHoliday.count({ where: t() })).toBeGreaterThanOrEqual(6);
    expect(leaveTypes).toBe(4);
    expect(await db.designation.count({ where: t() })).toBe(8);

    // Every active employee holds a balance for every leave type. Asserted as a
    // relationship rather than a total, so it still means something when the
    // population changes.
    const withoutFullBalances: string[] = [];
    const employees = await db.employeeProfile.findMany({
      where: { ...t(), employmentStatus: 'ACTIVE', deletedAt: null },
      select: { id: true, employeeNumber: true },
    });
    for (const e of employees) {
      const n = await db.hrLeaveBalance.count({ where: { ...t(), employeeId: e.id } });
      if (n !== leaveTypes) withoutFullBalances.push(`${e.employeeNumber} has ${n}`);
    }
    expect(withoutFullBalances, 'employees missing a leave balance').toEqual([]);
    expect(balances).toBeGreaterThanOrEqual(active * leaveTypes);
  });

  it('IT-001b nothing is orphaned, and every decided leave has an approver', async () => {
    if (!seeded) return;
    const employeeIds = new Set(
      (await db.employeeProfile.findMany({ where: t(), select: { id: true } })).map((e) => e.id),
    );

    const attendance = await db.hrAttendanceRecord.findMany({ where: t(), select: { employeeId: true } });
    expect(attendance.filter((a) => !employeeIds.has(a.employeeId)).length, 'orphan attendance').toBe(0);

    const leave = await db.hrLeaveRequest.findMany({
      where: t(),
      select: { employeeId: true, approverId: true, status: true, days: true },
    });
    expect(leave.filter((l) => !employeeIds.has(l.employeeId)).length, 'orphan leave').toBe(0);
    expect(
      leave.filter((l) => l.status !== 'PENDING' && !l.approverId).length,
      'a decided leave request has no approver',
    ).toBe(0);
    expect(
      leave.every((l) => l.days > 0),
      'a leave request covers no days',
    ).toBe(true);
  });

  /** FR-007's coherence rule: the two modules must not contradict each other. */
  it('IT-001c approved leave and attendance agree', async () => {
    if (!seeded) return;
    const approved = await db.hrLeaveRequest.findMany({
      where: { ...t(), status: 'APPROVED' },
      select: { employeeId: true, startDate: true, endDate: true },
    });
    const key = (d: Date) => d.toISOString().slice(0, 10);
    let checked = 0;
    for (const a of approved) {
      const overlapping = await db.hrAttendanceRecord.findMany({
        where: { ...t(), employeeId: a.employeeId, workDate: { gte: a.startDate, lte: a.endDate } },
        select: { status: true, workDate: true },
      });
      for (const row of overlapping) {
        checked += 1;
        expect(String(row.status), `${key(row.workDate)} is inside an approved leave but is not marked ON_LEAVE`).toBe(
          'ON_LEAVE',
        );
      }
    }
    // If nothing overlapped, the assertion above proved nothing — say so rather
    // than reporting a green test that checked zero rows.
    expect(checked, 'no attendance row fell inside an approved leave, so coherence is unproven').toBeGreaterThan(0);
  });

  // ── FR-010 · the three demonstration personas ─────────────────────────────
  it('FR-010 the Sales, HR and Management personas all exist as workspace members', async () => {
    if (!seeded) return;
    const wanted = ['sales_rep', 'hr_admin', 'org_admin'];
    const missing: string[] = [];
    for (const key of wanted) {
      const n = await db.user.count({ where: { ...t(), role: { key }, status: 'ACTIVE' } });
      if (n === 0) missing.push(key);
    }
    // hr_admin was in the role catalogue but held by nobody until SPEC-0007
    // added one, so the HRMS demonstration had no login at all.
    expect(missing, 'demonstration personas with no active user').toEqual([]);
  });

  /**
   * The suspended rep must be suspended in both places.
   *
   * The seed suspends a user after the loop that writes employee profiles, so
   * the profile stayed ACTIVE until a second seed run repaired it by accident.
   * The visible symptom was that a fresh seed reported 40 active employees and
   * a re-seed reported 39 — the same database giving two answers, which made
   * "attendance for every active employee" non-deterministic.
   */
  it('FR-013 a suspended login is not also an active employee', async () => {
    if (!seeded) return;
    const suspended = await db.user.findMany({
      where: { ...t(), status: 'SUSPENDED' },
      select: { id: true, email: true },
    });
    for (const u of suspended) {
      const membership = await db.workspaceMembership.findFirst({
        where: { ...t(), salesUserId: u.id },
        select: { id: true },
      });
      if (!membership) continue;
      const profile = await db.employeeProfile.findUnique({
        where: { membershipId: membership.id },
        select: { employmentStatus: true, employeeNumber: true },
      });
      if (!profile) continue;
      expect(
        profile.employmentStatus,
        `${profile.employeeNumber} is a suspended login with an ACTIVE employee profile`,
      ).not.toBe('ACTIVE');
    }
  });

  /**
   * SPEC-0007/UT-013 · DATA-005 as amended by CHG-004.
   *
   * CHG-004 granted an exception for exactly one address and said, in the
   * approval itself, that it must not be broadened to any other demonstration
   * identity. A sentence in a change record does not survive the next person in
   * a hurry, so the boundary is asserted instead of trusted.
   *
   * Deliberately counts from the database rather than reading the seed source:
   * what matters is what the seed *wrote*, and a source scan would miss an
   * address built by string concatenation.
   */
  it('UT-013 exactly one seeded address is off a reserved domain, and it is the client login', async () => {
    if (!seeded) return;
    const CLIENT = 'demo@youhan.in';
    // RFC 2606 reserves example.com/net/org and the .test/.example/.invalid TLDs.
    const reserved = /@(?:[\w-]+\.)*example\.(?:com|net|org)$|\.(?:test|example|invalid|localhost)$/i;

    // Every tenant, not just the demo workspace. Scoping this to one tenant is
    // exactly the narrowness that let CL-007 declare the domain problem solved
    // while the second workspace's admin and 25 contacts were still on live-
    // looking domains.
    const users = await db.user.findMany({ select: { email: true } });
    expect(users.length, 'no users found — the workspace is not seeded').toBeGreaterThan(0);

    const offReserved = users.map((u) => u.email).filter((e) => !reserved.test(e));
    expect(
      offReserved.sort(),
      'exactly one address may sit off a reserved domain, and CHG-004 names which one',
    ).toEqual([CLIENT]);

    // The contact and lead books are generated records, and CHG-004 forbids the
    // exempt domain appearing in any of them.
    const [contacts, leads, accounts] = await Promise.all([
      db.contact.findMany({ select: { email: true } }),
      db.lead.findMany({ select: { email: true } }),
      db.account.findMany({ select: { mainEmail: true, website: true } }),
    ]);
    const generated = [...contacts, ...leads, ...accounts.map((a) => ({ email: a.mainEmail }))]
      .map((r) => r.email)
      .filter((e): e is string => Boolean(e));
    const leaked = [...new Set(generated.filter((e) => !reserved.test(e)))];
    expect(leaked, 'a generated record carries a non-reserved address').toEqual([]);

    // Websites too: a demonstration that links out to a real company's site is
    // the same mistake wearing a different protocol.
    const sites = accounts.map((a) => a.website).filter((w): w is string => Boolean(w));
    const liveSites = [...new Set(sites.filter((w) => !/(^|\.)example\.(com|net|org)(\/|$)/i.test(w)))];
    expect(liveSites, 'an account links to a non-reserved website').toEqual([]);
  });

  /**
   * SPEC-0007/UT-014 — the demonstration is YOUHAN ONE's, not a customer's.
   *
   * The workspace was called "Manath Homes", which read to a prospect as though
   * they were being shown another client's data rather than the product. The
   * name is now business-decided, so it is asserted rather than trusted: a
   * rename that reaches the database but not the seed, or the reverse, shows up
   * here instead of in front of a client.
   *
   * Deliberately scoped to what a client can SEE — workspace identity and the
   * records the walkthrough opens. It does not scan governance history, where
   * the old name is the truthful record of what was once there.
   */
  it('UT-014 the client-facing workspace is YOUHAN ONE Demo, with no trace of the old brand', async () => {
    if (!seeded) return;
    const OLD = /manath/i;

    const tenant = await db.tenant.findUnique({
      where: { slug: SLUG },
      select: { slug: true, displayName: true, legalName: true, primaryDomain: true },
    });
    expect(tenant, `no workspace at slug ${SLUG}`).toBeTruthy();
    expect(tenant!.displayName).toBe('YOUHAN ONE Demo');
    expect(tenant!.legalName).toBe('YOUHAN ONE Demo');

    // The slug is client-visible too: it is in every URL the client sees.
    for (const [field, value] of Object.entries(tenant!)) {
      expect(OLD.test(String(value)), `workspace ${field} still carries the old brand: ${value}`).toBe(false);
    }

    // The records the walkthrough actually opens.
    const [accounts, leads, contacts, events, transcripts] = await Promise.all([
      db.account.findMany({ where: { tenantId }, select: { name: true, website: true, mainEmail: true } }),
      db.lead.findMany({ where: { tenantId }, select: { fullName: true, email: true } }),
      db.contact.findMany({ where: { tenantId }, select: { fullName: true, email: true } }),
      db.event.findMany({ where: { tenantId }, select: { title: true, location: true, description: true } }),
      db.transcript.findMany({ where: { tenantId }, select: { content: true }, take: 200 }),
    ]);
    const surfaces: [string, unknown][] = [
      ...accounts.flatMap((a) => Object.entries(a)),
      ...leads.flatMap((l) => Object.entries(l)),
      ...contacts.flatMap((c) => Object.entries(c)),
      ...events.flatMap((e) => Object.entries(e)),
      ...transcripts.flatMap((t) => Object.entries(t)),
    ];
    const offenders = surfaces
      .filter(([, v]) => typeof v === 'string' && OLD.test(v))
      .map(([k, v]) => `${k}: ${String(v).slice(0, 70)}`);
    expect([...new Set(offenders)], 'client-visible demo data still names the old brand').toEqual([]);
  });
});
