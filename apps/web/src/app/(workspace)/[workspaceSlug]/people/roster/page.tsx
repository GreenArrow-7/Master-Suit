import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import { myEmployee } from '@/services/hr/leave';
import { isRosterApprover, isRosterPlanner, listShiftChanges, rosterFor } from '@/services/hr/roster';
import { addDays, dayKey, toDay, queryDate } from '@/services/hr/rules';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { week } = await searchParams;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });
  const actions = `/api/v1/workspaces/${workspaceSlug}/hr/actions`;

  const self = await myEmployee(ctx);
  const planner = isRosterPlanner(ctx);
  const approver = isRosterApprover(ctx);

  // Weeks start on the workspace's Monday. A roster is read a week at a time;
  // anything longer stops being a grid you can scan.
  const anchor = week ? toDay(queryDate(week, startOfWeek(new Date()))) : startOfWeek(new Date());
  const days = Array.from({ length: 7 }, (_, index) => addDays(anchor, index));

  const today = toDay(new Date());
  const [entries, requests, allShifts, employees, myUpcoming, swappable] = await Promise.all([
    rosterFor(ctx, { from: anchor, to: addDays(anchor, 6) }),
    listShiftChanges(ctx, { status: 'PENDING' }),
    prisma.hrShift.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, orderBy: { name: 'asc' } }),
    planner
      ? prisma.employeeProfile.findMany({
          where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
          include: { membership: { include: { platformUser: true } } },
          orderBy: { employeeNumber: 'asc' },
        })
      : [],
    // Only future days can be changed, so only those are offered.
    self
      ? prisma.hrRosterEntry.findMany({
          where: { tenantId: ctx.tenantId, employeeId: self.id, workDate: { gte: today } },
          include: { shift: true },
          orderBy: { workDate: 'asc' },
          take: 60,
        })
      : [],
    self
      ? prisma.hrRosterEntry.findMany({
          where: { tenantId: ctx.tenantId, employeeId: { not: self.id }, workDate: { gte: today } },
          include: { shift: true, employee: { include: { membership: { include: { platformUser: true } } } } },
          orderBy: { workDate: 'asc' },
          take: 120,
        })
      : [],
  ]);
  const shifts = allShifts;

  // One row per person, one column per day — the shape a manager reads.
  const people = new Map<string, { name: string; byDay: Map<string, typeof entries> }>();
  for (const entry of entries) {
    const name = entry.employee.membership.platformUser.fullName;
    const row = people.get(entry.employeeId) ?? { name, byDay: new Map() };
    const key = dayKey(entry.workDate);
    row.byDay.set(key, [...(row.byDay.get(key) ?? []), entry]);
    people.set(entry.employeeId, row);
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
      <section>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>Roster</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)', maxWidth: '78ch' }}>
          Every assignment is checked for overlaps, rest between shifts, consecutive days and approved leave — including
          the ones a bulk fill or a week copy creates. Conflicts are refused rather than flagged, because a roster that
          saves a conflict in amber is a roster nobody trusts.
        </p>
      </section>

      <section style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <a className="lf-btn lf-btn--ghost" href={`?week=${dayKey(addDays(anchor, -7))}`}>
          ← Previous week
        </a>
        <strong>
          {date(anchor)} – {date(addDays(anchor, 6))}
        </strong>
        <a className="lf-btn lf-btn--ghost" href={`?week=${dayKey(addDays(anchor, 7))}`}>
          Next week →
        </a>
      </section>

      <section>
        <WorkspaceTable
          headers={['Employee', ...days.map((value) => weekday(value))]}
          empty="Nothing is rostered this week."
          rows={[...people.entries()].map(([employeeId, row]) => [
            row.name,
            ...days.map((value) => {
              const cell = row.byDay.get(dayKey(value)) ?? [];
              if (!cell.length) return '—';
              return (
                <span key={dayKey(value)} style={{ display: 'grid', gap: 4 }}>
                  {cell.map((entry) => (
                    <span key={entry.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span className="lf-badge" title={`${entry.shift.startTime}–${entry.shift.endTime}`}>
                        {entry.shift.code}
                      </span>
                      {entry.source !== 'ROSTER' && (
                        <span style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)' }}>
                          {entry.source.toLowerCase()}
                        </span>
                      )}
                      {planner && (
                        <WorkspaceActionButton
                          endpoint={`${actions}/roster-remove`}
                          body={{ entryId: entry.id }}
                          label="×"
                          ariaLabel={`Remove ${entry.shift.code} on ${date(entry.workDate)}`}
                          variant="ghost"
                          confirm={`Remove ${entry.shift.code} on ${date(entry.workDate)}?`}
                        />
                      )}
                      {employeeId === self?.id && !planner && (
                        <span style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)' }}>you</span>
                      )}
                    </span>
                  ))}
                </span>
              );
            }),
          ])}
        />
      </section>

      {requests.length > 0 && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>
            {approver ? 'Shift changes awaiting a decision' : 'My pending shift changes'}
          </h2>
          <WorkspaceTable
            headers={['Requester', 'Day', 'Asking for', 'Reason', approver ? 'Decision' : '']}
            rows={requests.map((request) => [
              request.requester.membership.platformUser.fullName,
              `${date(request.entry.workDate)} · ${request.entry.shift.code}`,
              request.kind === 'SWAP'
                ? `Swap with ${request.counterpart?.membership.platformUser.fullName ?? 'a colleague'} (${
                    request.counterpartEntry?.shift.code ?? '—'
                  })`
                : `Move to ${request.requestedShift?.code ?? '—'}`,
              request.reason,
              approver && request.requesterId !== self?.id ? (
                <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} key="decide">
                  <WorkspaceActionButton
                    endpoint={`${actions}/shift-change-decide`}
                    body={{ requestId: request.id, approve: true }}
                    label="Approve"
                  />
                  <WorkspaceActionButton
                    endpoint={`${actions}/shift-change-decide`}
                    body={{ requestId: request.id, approve: false }}
                    label="Reject"
                    variant="danger"
                    promptFor={{ name: 'note', label: 'Reason for rejection' }}
                  />
                </span>
              ) : request.requesterId === self?.id ? (
                <WorkspaceActionButton
                  key="cancel"
                  endpoint={`${actions}/shift-change-cancel`}
                  body={{ requestId: request.id }}
                  label="Withdraw"
                  variant="ghost"
                />
              ) : (
                '—'
              ),
            ])}
          />
        </section>
      )}

      {myUpcoming.length > 0 && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Ask to change one of my shifts</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
            Pick one of your upcoming shifts, then either a different shift or a colleague&apos;s day to swap into — one
            or the other, not both. A manager decides it, and an approved swap moves both sides at once.
          </p>
          <WorkspaceRecordForm
            endpoint={`${actions}/shift-change-request`}
            submitLabel="Send request"
            fields={[
              {
                name: 'entryId',
                label: 'My shift',
                type: 'select',
                required: true,
                options: myUpcoming.map((entry) => ({
                  value: entry.id,
                  label: `${date(entry.workDate)} · ${entry.shift.code}`,
                })),
              },
              {
                name: 'requestedShiftId',
                label: 'Move to this shift (leave blank if swapping)',
                type: 'select',
                options: allShifts.map((shift) => ({
                  value: shift.id,
                  label: `${shift.code} · ${shift.startTime}–${shift.endTime}`,
                })),
              },
              {
                name: 'counterpartEntryId',
                label: 'Or swap into a colleague’s day',
                type: 'select',
                options: swappable.map((entry) => ({
                  value: entry.id,
                  label: `${entry.employee.membership.platformUser.fullName} · ${date(entry.workDate)} · ${entry.shift.code}`,
                })),
              },
              { name: 'reason', label: 'Reason', required: true },
            ]}
          />
        </section>
      )}

      {planner && (
        <>
          <section>
            <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Fill a range</h2>
            <WorkspaceRecordForm
              endpoint={`${actions}/roster-bulk-assign`}
              submitLabel="Assign shifts"
              fields={[
                {
                  name: 'employeeIds',
                  label: 'Employees',
                  type: 'multiselect',
                  required: true,
                  options: employees.map((employee) => ({
                    value: employee.id,
                    label: employee.membership.platformUser.fullName,
                  })),
                },
                {
                  name: 'shiftId',
                  label: 'Shift',
                  type: 'select',
                  required: true,
                  options: shifts.map((shift) => ({
                    value: shift.id,
                    label: `${shift.code} · ${shift.startTime}–${shift.endTime}`,
                  })),
                },
                { name: 'from', label: 'From', type: 'date', required: true },
                { name: 'to', label: 'To', type: 'date', required: true },
              ]}
            />
          </section>

          <section className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 10 }}>
            <div>
              <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>Copy this week forward</h2>
              <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
                Copies {date(anchor)} – {date(addDays(anchor, 6))} onto the following week. Days that would breach a
                rest rule or land on approved leave are reported instead of placed.
              </p>
            </div>
            <WorkspaceActionButton
              endpoint={`${actions}/roster-copy-week`}
              body={{ fromWeekStart: dayKey(anchor), toWeekStart: dayKey(addDays(anchor, 7)) }}
              label="Copy to next week"
            />
          </section>
        </>
      )}
    </div>
  );
}

function startOfWeek(value: Date): Date {
  const date = toDay(value);
  // Monday-first: getUTCDay() is 0 for Sunday, so Sunday steps back six days.
  const offset = (date.getUTCDay() + 6) % 7;
  return addDays(date, -offset);
}

const date = (value: Date) => value.toLocaleDateString('en-AE', { timeZone: 'UTC', day: '2-digit', month: 'short' });
const weekday = (value: Date) =>
  `${value.toLocaleDateString('en-AE', { timeZone: 'UTC', weekday: 'short' })} ${value.getUTCDate()}`;
