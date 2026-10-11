import { prisma } from '@/lib/db';
import { PRODUCT_MODULE_KEYS } from '@/lib/modules/catalogue';
import { queryDate } from '@/services/hr/rules';
import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';
import { isAttendanceApprover, mayReadAllEmployees } from '@/services/hr/access';
import { myEmployee } from '@/services/hr/leave';
import { attendanceScope } from '@/services/hr/reads';
import { listExceptionRequests } from '@/services/hr/requests';
import { productivity, type ProductivityRow } from '@/services/leadership/rollups';
import ExportCsv from '@/components/workspace/ExportCsv';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import { csvCell } from '@/lib/csv';
import TableSearch from '@/components/workspace/TableSearch';
import PageHeader from '@/components/ui/PageHeader';
import Badge from '@/components/ui/Badge';
import DateInput from '@/components/forms/DateInput';

export const metadata = { title: 'Attendance' };

const DUBAI = 'Asia/Dubai';
const dayLabel = (value: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: DUBAI, day: '2-digit', month: 'short', year: 'numeric' }).format(value);
const timeLabel = (value: Date | null) =>
  value
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: DUBAI,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(value)
    : '—';
const hhmm = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`;
const iso = (value: Date) => value.toISOString().slice(0, 10);

/**
 * The attendance report, per the reference: one row per day built from accepted
 * check-ins and check-outs, shown in Asia/Dubai, with a day staying open until
 * a check-out is recorded.
 *
 * The window defaults to the last 30 days. Rows are scoped the same way the API
 * scopes them (`attendanceScope`) — attendance is a record of where a named
 * person was and when, so a manager sees their reporting line and everyone else
 * only their own.
 *
 * Every workspace has it, not only one with People: check-in works everywhere,
 * so its record must too. `attendance/page.tsx` renders it outside the People
 * layout for a workspace without HRMS.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: PRODUCT_MODULE_KEYS, permission: SELF_SERVICE });
  const actions = `/api/v1/workspaces/${workspaceSlug}/hr/actions`;

  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 29 * 86_400_000);
  const from = queryDate(query.from, defaultFrom);
  const to = queryDate(query.to, today);
  const toEnd = new Date(to);
  toEnd.setHours(23, 59, 59, 999);

  const seesOthers = mayReadAllEmployees(ctx) || isAttendanceApprover(ctx);
  const [scope, self] = await Promise.all([attendanceScope(ctx), myEmployee(ctx)]);

  const rows = await prisma.hrAttendanceRecord.findMany({
    where: {
      tenantId: ctx.tenantId,
      workDate: { gte: from, lte: toEnd },
      ...scope,
    },
    include: {
      employee: {
        include: { membership: { select: { salesUserId: true, platformUser: { select: { fullName: true } } } } },
      },
      location: { select: { name: true } },
    },
    orderBy: [{ workDate: 'desc' }],
    take: 400,
  });

  // Face verification is a property of the punch, not the day roll-up, so the
  // count comes from the punches that produced these days.
  const faceVerified = await prisma.hrAttendancePunch.count({
    where: {
      tenantId: ctx.tenantId,
      result: 'ACCEPTED',
      faceScore: { not: null },
      serverTime: { gte: from, lte: toEnd },
      ...scope,
    },
  });

  // Early check-outs waiting on this viewer: an employee whose assigned leads are
  // still untouched asks from the check-in screen, and their line manager or an
  // administrator decides here. That decision is final (services/hr/requests.ts).
  const earlyCheckouts = isAttendanceApprover(ctx)
    ? (await listExceptionRequests(ctx)).filter(
        (request) =>
          request.reasonCode === 'work_pending' &&
          request.status === 'PENDING_MANAGER' &&
          request.employeeId !== self?.id,
      )
    : [];

  // §3: beside the hours, what the person did with the day — leads handed over,
  // leads worked, calls completed — from the same rollup Reports → Productivity uses.
  const sellerIds = [
    ...new Set(rows.map((row) => row.employee.membership.salesUserId).filter((id): id is string => !!id)),
  ];
  const work = new Map<string, ProductivityRow>();
  if (seesOthers && sellerIds.length) {
    for (const r of await productivity(ctx.tenantId, sellerIds, { from, to: toEnd })) work.set(r.userId, r);
  }
  const workOf = (row: (typeof rows)[number]) => work.get(row.employee.membership.salesUserId ?? '');

  const totalMinutes = rows.reduce((sum, row) => sum + (row.workMinutes ?? 0), 0);
  const completed = rows.filter((row) => row.checkOutAt !== null).length;
  const open = rows.filter((row) => row.checkInAt !== null && row.checkOutAt === null).length;

  const kpis: [string, string | number][] = [
    ['Days recorded', rows.length],
    ['Total hours', hhmm(totalMinutes)],
    ['Completed', completed],
    ['Still open', open],
    ['Face verified', faceVerified],
  ];

  const csv = [
    ['Date', 'Employee', 'First in', 'Last out', 'Hours', 'Location', 'Status'].map(csvCell).join(','),
    ...rows.map((row) =>
      [
        dayLabel(row.workDate),
        row.employee.membership.platformUser.fullName,
        timeLabel(row.checkInAt),
        timeLabel(row.checkOutAt),
        hhmm(row.workMinutes ?? 0),
        row.location?.name ?? '',
        row.checkOutAt ? 'complete' : row.checkInAt ? 'open' : row.status,
      ]
        .map(csvCell)
        .join(','),
    ),
  ].join('\r\n');

  return (
    <div className="lf-page-stack">
      <PageHeader
        title="Attendance"
        description="One row per day from accepted check-ins and check-outs, in Asia/Dubai. A day stays open until a check-out is recorded."
        actions={<ExportCsv filename={`attendance-${iso(from)}-to-${iso(to)}.csv`} csv={csv} />}
      />

      {/* The date range is a toolbar, like every other list's controls — not a
          labelled card-form with its own Apply button above the numbers. */}
      <form className="lf-toolbar" method="get">
        <DateInput name="from" defaultValue={iso(from)} aria-label="From" />
        <span style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>to</span>
        <DateInput name="to" defaultValue={iso(to)} aria-label="To" />
        <button className="lf-btn lf-btn--secondary lf-btn--sm" type="submit">
          Apply
        </button>
      </form>

      <div className="lf-kpi-grid">
        {kpis.map(([label, value]) => (
          <article className="lf-kpi" key={label}>
            <span className="lf-kpi__label">{label}</span>
            <span className="lf-kpi__value">{value}</span>
          </article>
        ))}
      </div>

      {earlyCheckouts.length > 0 && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Early check-outs to decide</h2>
          <WorkspaceTable
            headers={['Employee', 'Asked at', 'Why', 'Decision']}
            empty=""
            rows={earlyCheckouts.map((request) => [
              request.employee.membership.platformUser.fullName,
              timeLabel(request.requestedFor),
              request.reasonText ?? '—',
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} key="d">
                <WorkspaceActionButton
                  endpoint={`${actions}/exception-decide`}
                  body={{ requestId: request.id, approve: true }}
                  label="Approve"
                  promptFor={{ name: 'comment', label: 'Comment' }}
                />
                <WorkspaceActionButton
                  endpoint={`${actions}/exception-decide`}
                  body={{ requestId: request.id, approve: false }}
                  label="Reject"
                  variant="danger"
                  promptFor={{ name: 'comment', label: 'Reason for rejection' }}
                />
              </span>,
            ])}
          />
        </section>
      )}

      {rows.length === 0 ? (
        <div className="lf-card lf-leave__empty">No attendance in this period.</div>
      ) : (
        <TableSearch placeholder="Employee, location, date or status…" label="Search this period">
          <div className="lf-table-wrap">
            <table className="lf-table">
              <thead>
                <tr>
                  <th>Date</th>
                  {seesOthers && <th>Employee</th>}
                  <th>First in</th>
                  <th>Last out</th>
                  <th>Hours</th>
                  <th>Location</th>
                  {seesOthers && <th style={{ textAlign: 'right' }}>Leads assigned</th>}
                  {seesOthers && <th style={{ textAlign: 'right' }}>Worked</th>}
                  {seesOthers && <th style={{ textAlign: 'right' }}>Calls</th>}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Date">{dayLabel(row.workDate)}</td>
                    {seesOthers && <td data-label="Employee">{row.employee.membership.platformUser.fullName}</td>}
                    <td data-label="First in">{timeLabel(row.checkInAt)}</td>
                    <td data-label="Last out">{timeLabel(row.checkOutAt)}</td>
                    <td data-label="Hours">{hhmm(row.workMinutes ?? 0)}</td>
                    <td data-label="Location">{row.location?.name ?? '—'}</td>
                    {seesOthers && (
                      <td data-label="Leads assigned" style={{ textAlign: 'right' }} className="lf-num">
                        {workOf(row)?.assigned ?? 0}
                      </td>
                    )}
                    {seesOthers && (
                      <td data-label="Worked" style={{ textAlign: 'right' }} className="lf-num">
                        {workOf(row)?.contacted ?? 0}
                      </td>
                    )}
                    {seesOthers && (
                      <td data-label="Calls" style={{ textAlign: 'right' }} className="lf-num">
                        {workOf(row)?.callsCompleted ?? 0}
                      </td>
                    )}
                    <td data-label="Status">
                      <Badge
                        tone={
                          row.checkOutAt
                            ? 'viridian'
                            : row.checkInAt
                              ? 'brass'
                              : row.status === 'ABSENT'
                                ? 'vermillion'
                                : 'slate'
                        }
                      >
                        {row.checkOutAt ? 'complete' : row.checkInAt ? 'open' : row.status.toLowerCase()}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableSearch>
      )}
    </div>
  );
}
