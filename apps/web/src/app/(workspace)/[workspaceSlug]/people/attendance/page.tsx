import { prisma } from '@/lib/db';
import { queryDate } from '@/services/hr/rules';
import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';
import { isAttendanceApprover, mayReadAllEmployees } from '@/services/hr/access';
import { myEmployee } from '@/services/hr/leave';
import ExportCsv from '@/components/workspace/ExportCsv';
import TableSearch from '@/components/workspace/TableSearch';
import PageHeader from '@/components/ui/PageHeader';
import Badge from '@/components/ui/Badge';

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
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/**
 * The attendance report, per the reference: one row per day built from accepted
 * check-ins and check-outs, shown in Asia/Dubai, with a day staying open until
 * a check-out is recorded.
 *
 * The window defaults to the last 30 days. Rows are scoped the same way the API
 * scopes them — attendance is a record of where a named person was and when, so
 * without the wider authority you see only your own.
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
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: SELF_SERVICE });

  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 29 * 86_400_000);
  const from = queryDate(query.from, defaultFrom);
  const to = queryDate(query.to, today);
  const toEnd = new Date(to);
  toEnd.setHours(23, 59, 59, 999);

  const seesAll = mayReadAllEmployees(ctx) || isAttendanceApprover(ctx);
  const self = seesAll ? null : await myEmployee(ctx);

  const rows = await prisma.hrAttendanceRecord.findMany({
    where: {
      tenantId: ctx.tenantId,
      workDate: { gte: from, lte: toEnd },
      ...(seesAll ? {} : { employeeId: self?.id ?? '__none__' }),
    },
    include: {
      employee: { include: { membership: { include: { platformUser: { select: { fullName: true } } } } } },
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
      ...(seesAll ? {} : { employeeId: self?.id ?? '__none__' }),
    },
  });

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
        <input className="lf-input" type="date" name="from" defaultValue={iso(from)} aria-label="From" />
        <span style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>to</span>
        <input className="lf-input" type="date" name="to" defaultValue={iso(to)} aria-label="To" />
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

      {rows.length === 0 ? (
        <div className="lf-card lf-leave__empty">No attendance in this period.</div>
      ) : (
        <TableSearch placeholder="Employee, location, date or status…" label="Search this period">
          <div className="lf-table-wrap">
            <table className="lf-table">
              <thead>
                <tr>
                  <th>Date</th>
                  {seesAll && <th>Employee</th>}
                  <th>First in</th>
                  <th>Last out</th>
                  <th>Hours</th>
                  <th>Location</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Date">{dayLabel(row.workDate)}</td>
                    {seesAll && <td data-label="Employee">{row.employee.membership.platformUser.fullName}</td>}
                    <td data-label="First in">{timeLabel(row.checkInAt)}</td>
                    <td data-label="Last out">{timeLabel(row.checkOutAt)}</td>
                    <td data-label="Hours">{hhmm(row.workMinutes ?? 0)}</td>
                    <td data-label="Location">{row.location?.name ?? '—'}</td>
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
