import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import CalendarView from './CalendarView';

export const metadata = { title: 'Calendar' };

/** `?month=YYYY-MM`, clamped to a sane window around today. */
function parseMonth(raw: string | undefined): { year: number; month: number } {
  const now = new Date();
  const match = raw?.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    if (year >= now.getFullYear() - 5 && year <= now.getFullYear() + 5 && month >= 0 && month <= 11) {
      return { year, month };
    }
  }
  return { year: now.getFullYear(), month: now.getMonth() };
}

const monthParam = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, '0')}`;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['tasks', 'VIEW'] });

  const { year, month } = parseMonth((await searchParams).month);
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const inMonth = { gte: monthStart, lte: monthEnd };

  /**
   * The calendar draws three kinds of entry, each on its own grant.
   *
   * The page is gated on `tasks:VIEW`, and then asked `visibilityWhere` for
   * activities and calls regardless — which throws Forbidden on a NONE scope.
   * A role holding tasks without calls (four exist in this database) was
   * refused the whole calendar rather than shown a calendar without call
   * entries. A missing permission should subtract a layer, not the page.
   */
  const canSeeActivities = can(ctx, 'activities', 'VIEW');
  const canSeeCalls = can(ctx, 'calls', 'VIEW');
  const [taskScope, activityScope, callScope] = await Promise.all([
    visibilityWhere(ctx, 'tasks', 'VIEW', { ownerField: 'ownerId' }),
    canSeeActivities ? visibilityWhere(ctx, 'activities', 'VIEW', { ownerField: 'ownerId' }) : null,
    canSeeCalls ? visibilityWhere(ctx, 'calls', 'VIEW', { ownerField: 'callerId' }) : null,
  ]);

  const [tasks, activities, followUps, calls, events] = await Promise.all([
    prisma.task.findMany({
      where: { ...taskScope, deletedAt: null, dueAt: inMonth },
      take: 300,
      select: { id: true, title: true, dueAt: true, status: true },
    }),
    activityScope
      ? prisma.activity.findMany({
          where: { ...activityScope, deletedAt: null, occurredAt: inMonth },
          take: 300,
          select: { id: true, occurredAt: true, leadId: true, type: { select: { name: true } } },
        })
      : [],
    prisma.followUpTask.findMany({
      where: { tenantId: ctx.tenantId, ownerId: ctx.actor.id, deletedAt: null, dueAt: inMonth },
      take: 300,
      select: { id: true, title: true, dueAt: true, status: true },
    }),
    callScope
      ? prisma.call.findMany({
          // A completed call sits at its start time; one not yet dialled at its creation.
          where: {
            ...callScope,
            deletedAt: null,
            OR: [{ startedAt: inMonth }, { startedAt: null, createdAt: inMonth }],
          },
          take: 300,
          select: { id: true, startedAt: true, createdAt: true, direction: true, status: true },
        })
      : [],
    // Events are tenant-wide, matching the Events list page.
    prisma.event.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, startAt: inMonth },
      take: 300,
      select: { id: true, title: true, startAt: true },
    }),
  ]);

  const items = [
    ...tasks.map((t) => ({
      id: `task-${t.id}`,
      date: t.dueAt.toISOString(),
      label: t.title,
      kind: 'task' as const,
      completed: t.status === 'COMPLETED',
      href: '/tasks',
    })),
    ...activities.map((a) => ({
      id: `act-${a.id}`,
      date: a.occurredAt.toISOString(),
      label: a.type.name,
      kind: 'activity' as const,
      href: a.leadId ? `/leads/${a.leadId}` : '/activities',
    })),
    ...followUps.map((f) => ({
      id: `fup-${f.id}`,
      date: f.dueAt.toISOString(),
      label: f.title,
      kind: 'follow-up' as const,
      completed: f.status === 'COMPLETED',
      href: '/follow-ups',
    })),
    ...calls.map((c) => ({
      id: `call-${c.id}`,
      date: (c.startedAt ?? c.createdAt).toISOString(),
      label: `${c.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} call`,
      kind: 'call' as const,
      href: `/calls/${c.id}`,
    })),
    ...events.map((e) => ({
      id: `event-${e.id}`,
      date: e.startAt.toISOString(),
      label: e.title,
      kind: 'event' as const,
      href: `/events/${e.id}`,
    })),
  ];

  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();

  return (
    <>
      <header style={{ marginBottom: 'var(--lf-space-4)' }}>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
          Calendar
        </h1>
        <p style={{ margin: '2px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
          Tasks, follow-ups, calls, events and activities
        </p>
      </header>
      <CalendarView
        items={items}
        year={year}
        month={month}
        prevHref={`/calendar?month=${monthParam(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1)}`}
        nextHref={`/calendar?month=${monthParam(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1)}`}
        todayHref={isCurrentMonth ? null : '/calendar'}
      />
    </>
  );
}
