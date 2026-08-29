import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';
import { can, scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import { myEmployee } from '@/services/hr/leave';

/**
 * The workspace landing page. Reachable by every member — which is why each
 * panel is gated on its own.
 *
 * It previously rendered headcount, today's absences, the pending leave queue
 * *and* the plan, seat usage and renewal date to anyone who could log in. A
 * sales representative has no business reading either. A panel the viewer may
 * not see is simply absent: a 403 on the landing page would be worse, and
 * telling someone a section exists but is denied leaks the same thing the
 * numbers would.
 */
export default async function WorkspaceDashboard({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx, workspace } = await resolveWorkspacePage(workspaceSlug, { permission: SELF_SERVICE });
  const modules = new Set(
    workspace.moduleEntitlements
      .filter((item) => ['TRIAL', 'ACTIVE', 'GRACE'].includes(item.state))
      .map((item) => item.module),
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Entitlement decides whether the module exists here; permission decides
  // whether *this* person sees it. Both must hold, and the queries below only
  // run when they do — an unauthorised viewer costs no database work either.
  const showPeople = modules.has('HRMS') && can(ctx, 'employee', 'VIEW');
  const showSales = modules.has('SALES') && can(ctx, 'leads', 'VIEW');
  const showSubscription = can(ctx, 'settings', 'VIEW');

  /**
   * One round of concurrency, not two.
   *
   * Each group was already batched, but `await people` then `await sales` meant
   * a workspace running both modules paid two sequential rounds — the slowest
   * People query plus the slowest Sales query, rather than the slower of the
   * two. Awaiting the pair together makes it one.
   *
   * Deliberately not cached: these are record counts, and this codebase caches
   * configuration only (see lib/redis.ts and docs/00-ARCHITECTURE.md §6). A
   * dashboard showing yesterday's pending-approval count is a dashboard nobody
   * can act on.
   */
  const peopleQuery = showPeople
    ? Promise.all([
        prisma.employeeProfile.count({
          where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: 'ACTIVE' },
        }),
        prisma.hrAttendanceRecord.count({
          where: {
            tenantId: ctx.tenantId,
            workDate: { gte: today, lt: tomorrow },
            status: { in: ['PRESENT', 'LATE', 'REMOTE'] },
          },
        }),
        prisma.hrAttendanceRecord.count({
          where: { tenantId: ctx.tenantId, workDate: { gte: today, lt: tomorrow }, status: 'ABSENT' },
        }),
        prisma.hrLeaveRequest.count({
          where: { tenantId: ctx.tenantId, status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today } },
        }),
        prisma.hrLeaveRequest.count({ where: { tenantId: ctx.tenantId, status: 'PENDING' } }),
        prisma.hrHoliday.count({ where: { tenantId: ctx.tenantId, holidayDate: { gte: today } } }),
      ])
    : null;
  /**
   * §41–48: the same page IS the role dashboard, because the numbers are
   * scoped by the viewer's actual grant, not merely gated by it.
   *
   * These counts were tenant-wide for everyone who held `leads VIEW` at any
   * scope: a representative's "Active leads" was the company's total — a
   * number they can neither open nor act on, on the screen that is supposed to
   * answer "what should I do next". Routing every filter through
   * `visibilityWhere` makes one composition truthful for the whole ladder:
   *
   *   OWN            a rep/SDR reads *their* pipeline and queue;
   *   TEAM/BRANCH    a manager reads their team's, plus unassigned leads
   *                  (includeUnassigned — triage is the manager's queue);
   *   ORGANIZATION   an admin or executive reads the operation.
   *
   * The label on the band says which of those it is, so the same figure is
   * never mistaken for a different altitude.
   */
  const salesScope = showSales ? scopeFor(ctx, 'leads', 'VIEW') : 'NONE';
  /**
   * Each figure is gated on *its own* module, not on `leads`.
   *
   * `showSales` asks whether the viewer may see leads, and this block then went
   * on to call `visibilityWhere` for opportunities and tasks regardless —
   * assuming that anyone holding `leads:VIEW` also holds the other two.
   * `visibilityWhere` throws `Forbidden` on a NONE scope, and nothing here
   * catches it, so the assumption failing did not hide a panel: it threw out of
   * a server component and turned the whole landing page into "Something went
   * wrong on our side".
   *
   * That is reachable by any role configured with leads but not tasks — a
   * perfectly ordinary sales role — and it is exactly what a read-only platform
   * service identity scoped to a few modules hits on its first page load.
   */
  const showOpportunities = showSales && can(ctx, 'opportunities', 'VIEW');
  const showTasks = showSales && can(ctx, 'tasks', 'VIEW');
  const salesQuery = showSales
    ? Promise.all([
        visibilityWhere(ctx, 'leads', 'VIEW'),
        showOpportunities ? visibilityWhere(ctx, 'opportunities', 'VIEW') : Promise.resolve(null),
        // Follow-ups key on ownerId like leads do; they carry the lead module's
        // grant because they are lead work.
        visibilityWhere(ctx, 'leads', 'VIEW'),
        showTasks ? visibilityWhere(ctx, 'tasks', 'VIEW') : Promise.resolve(null),
      ]).then(([leadWhere, oppWhere, followUpWhere, taskWhere]) =>
        Promise.all([
          prisma.lead.count({ where: { ...leadWhere, deletedAt: null } }),
          // Unassigned is a triage queue: tenant-wide by definition, shown only
          // to viewers whose scope reaches beyond their own records.
          salesScope === 'OWN'
            ? Promise.resolve(0)
            : prisma.lead.count({ where: { tenantId: ctx.tenantId, deletedAt: null, ownerId: null } }),
          oppWhere ? prisma.opportunity.count({ where: { ...oppWhere, deletedAt: null, status: 'OPEN' } }) : 0,
          prisma.followUpTask.count({
            where: { ...followUpWhere, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lt: new Date() } },
          }),
          oppWhere
            ? prisma.opportunity.aggregate({
                where: { ...oppWhere, deletedAt: null, status: 'OPEN' },
                _sum: { amount: true },
              })
            : { _sum: { amount: null } },
          taskWhere
            ? prisma.task.count({
                where: { ...taskWhere, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lte: tomorrow } },
              })
            : 0,
        ]),
      )
    : null;

  /**
   * Whose follow-ups are on this page.
   *
   * The tiles above count follow-ups but name nobody, which is the right
   * summary for a representative looking at their own queue and useless to
   * anyone looking at the team's: "14 overdue" does not say whose, or on which
   * lead, or how late. A viewer whose scope reaches past their own records is
   * asking a different question, so they get the rows rather than the number.
   *
   * Gated on scope rather than on a role name, so it appears for a manager, an
   * administrator and a read-only platform service identity alike — anyone
   * `visibilityWhere` would hand more than their own work.
   */
  const showTeamFollowUps = showSales && SCOPE_RANK[salesScope] > SCOPE_RANK.OWN;
  const teamFollowUpQuery = showTeamFollowUps
    ? visibilityWhere(ctx, 'leads', 'VIEW').then(async (where) => {
        const rows = await prisma.followUpTask.findMany({
          where: { ...where, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          orderBy: [{ dueAt: 'asc' }],
          take: 12,
          select: { id: true, title: true, dueAt: true, priority: true, ownerId: true, leadId: true },
        });
        if (rows.length === 0) return [];

        // Two lookups for the whole list rather than a join per row. Both are
        // tenant-scoped explicitly, which is what lets the guard set
        // `app.tenant_id` for them — see runPinned in lib/db.ts.
        const [owners, leads] = await Promise.all([
          prisma.user.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...new Set(rows.map((row) => row.ownerId))] } },
            select: { id: true, fullName: true },
          }),
          prisma.lead.findMany({
            where: {
              tenantId: ctx.tenantId,
              id: { in: [...new Set(rows.map((row) => row.leadId).filter((id): id is string => Boolean(id)))] },
            },
            select: { id: true, fullName: true },
          }),
        ]);
        const ownerName = new Map(owners.map((owner) => [owner.id, owner.fullName]));
        const leadName = new Map(leads.map((lead) => [lead.id, lead.fullName]));
        return rows.map((row) => ({
          id: row.id,
          title: row.title,
          dueAt: row.dueAt,
          priority: row.priority as string,
          // "Removed user" rather than a bare id: an owner whose account was
          // deleted still owns rows, and the id tells a reader nothing.
          owner: ownerName.get(row.ownerId) ?? 'Removed user',
          lead: row.leadId ? (leadName.get(row.leadId) ?? '—') : '—',
          leadId: row.leadId,
        }));
      })
    : null;

  /**
   * The self-service panel — §55's employee dashboard.
   *
   * Ungated, because everything in it is the viewer's own record. It resolves
   * the employee first and then reads only rows keyed to them, so a member with
   * no employee profile (a platform bootstrap account) simply gets nothing
   * rather than an error.
   */
  const mineQuery = modules.has('HRMS')
    ? myEmployee(ctx).then((self) =>
        self
          ? Promise.all([
              Promise.resolve(self),
              prisma.hrAttendanceRecord.findFirst({
                where: { tenantId: ctx.tenantId, employeeId: self.id, workDate: { gte: today, lt: tomorrow } },
                select: { checkInAt: true, checkOutAt: true, status: true },
              }),
              prisma.hrLeaveRequest.count({
                where: { tenantId: ctx.tenantId, employeeId: self.id, status: 'PENDING' },
              }),
              prisma.hrOvertimeRequest.count({
                where: { tenantId: ctx.tenantId, employeeId: self.id, status: 'PENDING' },
              }),
              prisma.hrReview.count({
                where: { tenantId: ctx.tenantId, employeeId: self.id, status: 'PENDING_SELF' },
              }),
              prisma.hrPayslip.count({
                where: {
                  tenantId: ctx.tenantId,
                  employeeId: self.id,
                  run: { status: { in: ['APPROVED', 'LOCKED', 'PAID'] } },
                },
              }),
            ])
          : null,
      )
    : null;

  /**
   * What is sitting on this person's desk — §55's manager dashboard.
   *
   * Each count is gated on the permission that would let them act on it, so a
   * manager who approves leave but not overtime sees one number, not two. A
   * queue you cannot clear is noise.
   */
  const approvalsQuery = modules.has('HRMS')
    ? Promise.all([
        can(ctx, 'leave', 'APPROVE')
          ? prisma.hrLeaveRequest.count({ where: { tenantId: ctx.tenantId, status: 'PENDING' } })
          : Promise.resolve(null),
        can(ctx, 'overtime', 'APPROVE')
          ? prisma.hrOvertimeRequest.count({ where: { tenantId: ctx.tenantId, status: 'PENDING' } })
          : Promise.resolve(null),
        can(ctx, 'attendance', 'APPROVE')
          ? prisma.hrAttendancePunch.count({ where: { tenantId: ctx.tenantId, result: 'FLAGGED_REVIEW' } })
          : Promise.resolve(null),
        can(ctx, 'shifts', 'APPROVE')
          ? prisma.hrShiftChangeRequest.count({ where: { tenantId: ctx.tenantId, status: 'PENDING' } })
          : Promise.resolve(null),
        can(ctx, 'recruitment', 'APPROVE')
          ? prisma.hrRequisition.count({ where: { tenantId: ctx.tenantId, status: 'PENDING_APPROVAL' } })
          : Promise.resolve(null),
        can(ctx, 'payroll', 'APPROVE')
          ? prisma.hrPayrollRun.count({ where: { tenantId: ctx.tenantId, status: 'PENDING_APPROVAL' } })
          : Promise.resolve(null),
        can(ctx, 'performance', 'APPROVE')
          ? prisma.hrReview.count({ where: { tenantId: ctx.tenantId, status: 'CALIBRATION' } })
          : Promise.resolve(null),
      ])
    : null;

  /**
   * §55's security panel. Gated on reading the audit log, because that is the
   * authority these numbers summarise — someone who cannot open the log has no
   * business being shown the count of failed sign-ins either.
   *
   * MFA coverage counts *verified* factors: an enrolment somebody started and
   * abandoned protects nothing, and counting it would report a workspace as
   * covered when it is not.
   */
  const securityQuery = can(ctx, 'auditlogs', 'VIEW')
    ? Promise.all([
        prisma.auditLog.count({
          where: { tenantId: ctx.tenantId, event: 'LOGIN_FAILED', occurredAt: { gte: today } },
        }),
        prisma.user.count({ where: { tenantId: ctx.tenantId, status: { in: ['SUSPENDED', 'DEACTIVATED'] } } }),
        prisma.user.count({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' } }),
        prisma.workspaceMembership.count({
          where: {
            tenantId: ctx.tenantId,
            status: 'ACTIVE',
            platformUser: { authenticationFactors: { some: { verifiedAt: { not: null } } } },
          },
        }),
        prisma.auditLog.count({ where: { tenantId: ctx.tenantId, occurredAt: { gte: today } } }),
      ])
    : null;

  /**
   * Call quality — the QA persona's dashboard, by permission rather than by
   * role name. A Call QA Manager holds calls VIEW but not leads VIEW, so the
   * Sales panel is absent and this one leads their page automatically; for a
   * seller or administrator it is one more module panel.
   */
  const callsQuery =
    modules.has('SALES') && can(ctx, 'calls', 'VIEW')
      ? Promise.all([
          prisma.call.count({
            where: { tenantId: ctx.tenantId, deletedAt: null, startedAt: { gte: today, lt: tomorrow } },
          }),
          prisma.callAudit.count({ where: { tenantId: ctx.tenantId, status: 'COMPLETED', humanReviewed: false } }),
          prisma.callAudit.count({ where: { tenantId: ctx.tenantId, humanReviewed: true } }),
          prisma.callAudit.aggregate({
            where: { tenantId: ctx.tenantId, status: 'COMPLETED' },
            _avg: { overallScore: true, maxScore: true },
          }),
        ])
      : null;

  const [people, sales, mine, approvals, security, calls, teamFollowUps] = await Promise.all([
    peopleQuery,
    salesQuery,
    mineQuery,
    approvalsQuery,
    securityQuery,
    callsQuery,
    teamFollowUpQuery,
  ]);

  // ponytail: ratio of averages, not average of per-call ratios — exact only
  // while every audit shares one rubric; per-row aggregation if rubrics diverge.
  const avgScore =
    calls && calls[3]._avg.maxScore
      ? `${Math.round(((calls[3]._avg.overallScore ?? 0) / calls[3]._avg.maxScore) * 100)}%`
      : '—';

  const approvalItems = approvals
    ? ([
        ['Leave to approve', approvals[0], `/${workspace.slug}/people/leave`],
        ['Overtime to approve', approvals[1], `/${workspace.slug}/people/overtime`],
        ['Punches flagged', approvals[2], `/${workspace.slug}/people/attendance`],
        ['Shift changes', approvals[3], `/${workspace.slug}/people/shifts`],
        ['Requisitions', approvals[4], `/${workspace.slug}/people/recruitment`],
        ['Payroll runs', approvals[5], `/${workspace.slug}/people/payroll`],
        ['Ratings to calibrate', approvals[6], `/${workspace.slug}/people/performance`],
      ].filter(([, value]) => value !== null) as [string, number, string][])
    : [];

  // Money reads as "AED 21.3M", not a digit wall; counts stay exact.
  const money = (value: number) =>
    `${workspace.currency} ${new Intl.NumberFormat('en-AE', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;

  const hour = Number(
    new Intl.DateTimeFormat('en-AE', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Dubai' }).format(new Date()),
  );
  const daypart = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  // Off the actor buildActor already loaded — this page fetched the same row a
  // third time. Empty for platform staff, whose actor is labelled rather than
  // named: greeting a support session "Good morning, Platform" is nobody's name.
  const firstName = ctx.actor.id.startsWith('platform:') ? '' : ctx.actor.fullName.split(/\s+/)[0];

  /**
   * The attention row: every queue that is somebody's overdue work, one chip
   * each, rendered only when non-zero. Vermillion means already late; brass
   * means waiting on you. A quiet day renders no row at all.
   */
  const attention: { label: string; hint: string; count: number; tone: 'vermillion' | 'brass'; href: string }[] = [];
  if (sales) {
    if (sales[3] > 0)
      attention.push({
        label: 'Overdue follow-ups',
        hint: 'Promised and past due',
        count: sales[3],
        tone: 'vermillion',
        href: `/${workspace.slug}/sales/follow-ups`,
      });
    if (sales[5] > 0)
      attention.push({
        label: 'Tasks due',
        hint: 'Due today or earlier',
        count: sales[5],
        tone: 'brass',
        href: `/${workspace.slug}/sales/tasks`,
      });
    if (sales[1] > 0)
      attention.push({
        label: 'Unassigned leads',
        hint: 'Nobody owns these yet',
        count: sales[1],
        tone: 'brass',
        href: `/${workspace.slug}/sales/leads`,
      });
  }
  for (const [label, value, href] of approvalItems) {
    if (value > 0) attention.push({ label, hint: 'Waiting on your approval', count: value, tone: 'brass', href });
  }
  // The review queue is a reviewer's work item, not ambient news: `calls EDIT`
  // is what the audit-review action itself requires, so a representative who
  // can only view their calls no longer carries the whole organisation's
  // backlog in their attention row.
  if (calls && calls[1] > 0 && can(ctx, 'calls', 'EDIT'))
    attention.push({
      label: 'Audits awaiting review',
      hint: 'AI-scored, needs a human',
      count: calls[1],
      tone: 'brass',
      href: `/${workspace.slug}/sales/call-audits`,
    });
  if (security) {
    if (security[0] > 0)
      attention.push({
        label: 'Failed sign-ins today',
        hint: 'Review the audit log',
        count: security[0],
        tone: 'vermillion',
        href: `/${workspace.slug}/admin/audit`,
      });
    if (security[1] > 0)
      attention.push({
        label: 'Locked or disabled accounts',
        hint: 'People who cannot sign in',
        count: security[1],
        tone: 'brass',
        href: `/${workspace.slug}/admin/users`,
      });
  }

  // The band's figures: the three or four numbers that describe the operation.
  const bandStats: { label: string; value: string; href: string }[] = [];
  if (sales) {
    // The figures are scoped by the viewer's grant; the words must say so. A
    // rep's band reads "My pipeline", a manager's "Team pipeline", an
    // executive's the operation — same composition, honest at every altitude.
    const lens = salesScope === 'OWN' ? 'My' : salesScope === 'ORGANIZATION' ? '' : 'Team';
    const title = (base: string) => (lens ? `${lens} ${base.toLowerCase()}` : base);
    bandStats.push(
      {
        label: title('Pipeline value'),
        value: money(Number(sales[4]._sum.amount ?? 0)),
        href: `/${workspace.slug}/sales/opportunities`,
      },
      { label: title('Open opportunities'), value: String(sales[2]), href: `/${workspace.slug}/sales/opportunities` },
      { label: title('Active leads'), value: String(sales[0]), href: `/${workspace.slug}/sales/leads` },
    );
  }
  if (!sales && calls) {
    // The QA landing: no pipeline to report, so the band speaks call quality.
    bandStats.push(
      { label: 'Calls today', value: String(calls[0]), href: `/${workspace.slug}/sales/calls` },
      { label: 'Awaiting review', value: String(calls[1]), href: `/${workspace.slug}/sales/call-audits` },
      { label: 'Average score', value: avgScore, href: `/${workspace.slug}/sales/call-audits` },
    );
  }
  if (people) {
    bandStats.push({
      label: 'Present today',
      value: `${people[1]} / ${people[0]}`,
      href: `/${workspace.slug}/people/attendance`,
    });
  }
  const isAdminView = showSubscription;
  // A seller's day leads with their own queue; an analyst or executive reads
  // the operation first. Permission (leads EDIT) is the honest proxy.
  const workerView = !isAdminView && can(ctx, 'leads', 'EDIT');

  const myDayPanel = mine ? (
    <Summary
      accent="var(--lf-brass)"
      link={{ href: `/${workspace.slug}/people/check-in`, label: 'Open check-in →' }}
      title="My day"
      values={[
        ['Today', mine[1]?.checkInAt ? (mine[1].checkOutAt ? 'Checked out' : 'Checked in') : 'Not checked in'],
        ['My pending leave', mine[2]],
        ['My pending overtime', mine[3]],
        ['Self-assessment due', mine[4]],
        ['Payslips available', mine[5]],
      ]}
    />
  ) : null;

  return (
    <div className="lf-page-stack">
      {/* The greeting band: where you are, how the operation stands, in one
          glance. The same band the platform console leads with, so the product
          opens the same way on both sides of the door. */}
      <section className="lf-command-band">
        <div
          className="lf-command-band__row"
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 24,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="lf-eyebrow">{workspace.displayName} · Overview</div>
            <h1 className="lf-command-band__headline">
              Good {daypart}
              {firstName ? (
                <>
                  , <strong>{firstName}</strong>
                </>
              ) : null}
              .
            </h1>
            <p className="lf-command-band__sub">
              {attention.length > 0
                ? `${attention.length} ${attention.length === 1 ? 'queue needs' : 'queues need'} your attention today.`
                : 'All clear — nothing is waiting on you right now.'}
            </p>
          </div>
          {bandStats.length > 0 && (
            <div className="lf-stat-strip">
              {bandStats.map((stat) => (
                <Link key={stat.label} href={stat.href}>
                  <span className="lf-figure">{stat.value}</span>
                  <span className="lf-eyebrow" style={{ color: 'rgb(243 233 236 / 0.55)' }}>
                    {stat.label}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {attention.length > 0 && (
        <div className="lf-attention">
          {attention.map((item) => (
            <Link key={item.label} className="lf-attention__item" data-tone={item.tone} href={item.href}>
              <span className="lf-attention__count">{item.count}</span>
              <span>
                <span className="lf-attention__label">{item.label}</span>
                <span className="lf-attention__hint">{item.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* A representative's day leads with their own work; an administrator's
          or analyst's with the business. Same panels, different order. */}
      {workerView && myDayPanel}

      {sales && (
        <Summary
          accent="var(--lf-wine-700)"
          link={{ href: `/${workspace.slug}/sales`, label: 'Open Sales →' }}
          title="Sales summary"
          values={[
            ['Total leads', sales[0]],
            ['Unassigned leads', sales[1]],
            ['Open opportunities', sales[2]],
            ['Overdue follow-ups', sales[3]],
            ['Pipeline value', money(Number(sales[4]._sum.amount ?? 0))],
            ['Tasks due', sales[5]],
          ]}
        />
      )}
      {/* Whose work is outstanding, by name — the question a count cannot
          answer. Only rendered for a viewer whose scope reaches past their own
          records; a representative sees their own queue in My day instead. */}
      {teamFollowUps && teamFollowUps.length > 0 && (
        <section className="lf-table-wrap" style={{ gridColumn: '1 / -1' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 'var(--lf-space-3)',
              padding: '14px 16px 0',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 'var(--lf-text-md)' }}>Follow-ups across the workspace</h2>
            <Link className="lf-link" href={`/${workspace.slug}/sales/follow-ups`}>
              All follow-ups →
            </Link>
          </div>
          <table className="lf-table">
            <thead>
              <tr>
                <th>Owner</th>
                <th>Follow-up</th>
                <th>Lead</th>
                <th>Due</th>
                <th>Priority</th>
              </tr>
            </thead>
            <tbody>
              {teamFollowUps.map((row) => {
                const overdue = row.dueAt.getTime() < Date.now();
                return (
                  <tr key={row.id}>
                    <td data-label="Owner">{row.owner}</td>
                    <td data-label="Follow-up">{row.title}</td>
                    <td data-label="Lead">
                      {row.leadId ? (
                        <Link className="lf-link" href={`/${workspace.slug}/sales/leads/${row.leadId}`}>
                          {row.lead}
                        </Link>
                      ) : (
                        row.lead
                      )}
                    </td>
                    <td data-label="Due" style={overdue ? { color: 'var(--lf-vermillion)', fontWeight: 600 } : undefined}>
                      {row.dueAt.toLocaleDateString('en-AE', { day: 'numeric', month: 'short' })}
                      {overdue ? ' · overdue' : ''}
                    </td>
                    <td data-label="Priority">{row.priority.toLowerCase()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {people && (
        <Summary
          accent="var(--lf-viridian)"
          link={{ href: `/${workspace.slug}/people`, label: 'Open People →' }}
          title="People summary"
          values={[
            ['Total employees', people[0]],
            ['Present today', people[1]],
            ['Absent today', people[2]],
            ['On leave', people[3]],
            ['Pending approvals', people[4]],
            ['Upcoming holidays', people[5]],
          ]}
        />
      )}
      {calls && (
        <Summary
          accent="var(--lf-wine-700)"
          link={{ href: `/${workspace.slug}/sales/call-audits`, label: 'Open call audits →' }}
          title="Call quality"
          values={[
            ['Calls today', calls[0]],
            ['Audits awaiting review', calls[1]],
            ['Reviewed audits', calls[2]],
            ['Average audit score', avgScore],
          ]}
        />
      )}
      {!workerView && myDayPanel}

      {(showSubscription || security) && (
        <div className="lf-panel-duo">
          {showSubscription && (
            <Summary
              title="Subscription"
              values={[
                ['Current plan', workspace.subscription?.plan.name ?? workspace.planCode],
                ['Enabled modules', [...modules].join(' + ')],
                ['Users', `${workspace._count.memberships} / ${workspace.maxUsers ?? '∞'}`],
                ['Employees', `${workspace._count.employeeProfiles} / ${workspace.maxEmployees ?? '∞'}`],
                ['Status', workspace.subscription?.state ?? 'NONE'],
                [
                  'Trial / renewal',
                  workspace.trialEndsAt?.toLocaleDateString('en-AE') ??
                    workspace.subscription?.currentPeriodEnd?.toLocaleDateString('en-AE') ??
                    'Not set',
                ],
              ]}
            />
          )}
          {security && (
            <Summary
              title="Security today"
              link={{ href: `/${workspace.slug}/admin/audit`, label: 'Open audit log →' }}
              values={[
                ['Failed sign-ins', security[0]],
                ['Locked or disabled', security[1]],
                ['Active accounts', security[2]],
                ['Two-factor coverage', security[2] ? `${Math.round((security[3] / security[2]) * 100)}%` : '—'],
                ['Audited events', security[4]],
              ]}
            />
          )}
        </div>
      )}

      {!people && !sales && !mine && !security && !showSubscription && (
        <p style={{ color: 'var(--lf-ink-3)' }}>
          Nothing to show here yet. Use the navigation to reach the areas you have access to.
        </p>
      )}
    </div>
  );
}

/**
 * One dashboard panel. The two product modules carry their identity color as a
 * keyline and dot — viridian is People across the product, wine is Sales — and
 * everything else stays neutral, so color on this page always means "module"
 * except brass, which marks work waiting on the viewer.
 */
function Summary({
  title,
  values,
  accent,
  link,
}: {
  title: string;
  values: [string, string | number][];
  accent?: string;
  link?: { href: string; label: string };
}) {
  return (
    <section
      className="lf-module-panel"
      style={accent ? ({ ['--panel-accent' as string]: accent } as React.CSSProperties) : undefined}
    >
      <div className="lf-module-panel__head">
        <h2 className="lf-module-panel__title">{title}</h2>
        {link && (
          <Link className="lf-module-panel__link" href={link.href}>
            {link.label}
          </Link>
        )}
      </div>
      <div className="lf-metric-grid">
        {values.map(([label, value]) => (
          <article className="lf-metric-card" key={label}>
            <div className="lf-eyebrow">{label}</div>
            <div className="lf-metric-card__value">{value}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
