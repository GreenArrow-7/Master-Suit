import { prisma } from '@/lib/db';
import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';
import { balancesFor, isApprover, isHrAdmin, myEmployee } from '@/services/hr/leave';
import LeaveScreen, { type Balance, type RequestRow } from './LeaveScreen';

export const metadata = { title: 'Leave' };

/**
 * The order the balance cards appear in. Domain order, not alphabetical:
 * annual first, then the sick ladder full → half → unpaid, then the statutory
 * types. Anything not listed keeps its own order after these.
 */
const BALANCE_ORDER = [
  'Annual leave',
  'Sick leave (full pay)',
  'Sick leave (half pay)',
  'Sick leave (unpaid)',
  'Maternity leave',
  'Parental leave',
  'Bereavement leave',
  'Hajj leave',
  'Study leave',
];
const balanceRank = (name: string) => {
  const index = BALANCE_ORDER.indexOf(name);
  return index === -1 ? BALANCE_ORDER.length : index;
};

const day = (value: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric' }).format(
    value,
  );

/**
 * Leave, per the reference: the balance cards, the Apply form, then Your
 * requests and Waiting on you.
 *
 * The two queues are the point — your own requests and the ones assigned to
 * you to decide are different lists with different authority, and the second
 * is scoped to what this actor may actually approve.
 */
export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: SELF_SERVICE });
  const actions = `/api/v1/workspaces/${workspaceSlug}/hr/actions`;

  const self = await myEmployee(ctx);
  if (!self) {
    return (
      <div className="lf-page-stack">
        <section>
          <div className="lf-eyebrow">People</div>
          <h1 style={{ margin: '8px 0 0' }}>Leave</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)' }}>
            Your account has no employee record in this workspace, so there is no leave to show. Ask HR to create one.
          </p>
        </section>
      </div>
    );
  }

  const hr = isHrAdmin(ctx);
  const approver = isApprover(ctx);

  const [balances, mineRows, waitingRows, person] = await Promise.all([
    balancesFor(ctx, self.id),
    prisma.hrLeaveRequest.findMany({
      where: { tenantId: ctx.tenantId, employeeId: self.id },
      include: { leaveType: true, employee: { include: { membership: { include: { platformUser: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    approver
      ? prisma.hrLeaveRequest.findMany({
          where: { tenantId: ctx.tenantId, status: 'PENDING', ...(hr ? {} : { approverId: self.id }) },
          include: { leaveType: true, employee: { include: { membership: { include: { platformUser: true } } } } },
          orderBy: { startDate: 'asc' },
          take: 50,
        })
      : Promise.resolve([]),
    prisma.user.findFirst({ where: { tenantId: ctx.tenantId, id: ctx.actor.id }, select: { fullName: true } }),
  ]);

  type Row = (typeof mineRows)[number];
  const toRow = (row: Row): RequestRow => ({
    id: row.id,
    employee: row.employee.membership.platformUser.fullName,
    type: row.leaveType.name,
    from: day(row.startDate),
    to: day(row.endDate),
    days: row.days,
    status: row.status,
    reason: row.reason,
  });

  return (
    <div className="lf-page-stack lf-leave">
      <section>
        <h1 style={{ margin: 0 }}>Leave</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)' }}>
          {person?.fullName ?? 'You'} · {ctx.actor.roleKey.replaceAll('_', ' ')}
        </p>
      </section>

      <LeaveScreen
        actionsBase={actions}
        balances={[...balances]
          .sort((a, b) => balanceRank(a.name) - balanceRank(b.name))
          .map((balance): Balance => ({
            leaveTypeId: balance.leaveTypeId,
            name: balance.name,
            paid: balance.paid,
            entitledDays: balance.entitledDays,
            takenDays: balance.takenDays,
            availableDays: balance.availableDays,
          }))}
        mine={mineRows.map(toRow)}
        waiting={waitingRows.map(toRow)}
        canDecide={approver}
      />
    </div>
  );
}
