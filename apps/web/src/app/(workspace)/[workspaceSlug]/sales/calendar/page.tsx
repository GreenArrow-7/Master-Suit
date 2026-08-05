import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { visibilityWhere } from '@/lib/security/visibility';
import { prisma } from '@/lib/db';
import CalendarView from './CalendarView';

export const metadata = { title: 'Calendar' };

export default async function CalendarPage() {
  const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [taskScope, activityScope] = await Promise.all([
    visibilityWhere(ctx, 'tasks', 'VIEW', { ownerField: 'ownerId' }),
    visibilityWhere(ctx, 'activities', 'VIEW', { ownerField: 'ownerId' }),
  ]);

  const [tasks, activities] = await Promise.all([
    prisma.task.findMany({
      where: { ...taskScope, deletedAt: null, dueAt: { gte: monthStart, lte: monthEnd } },
      take: 200,
      select: { id: true, title: true, dueAt: true, status: true },
    }),
    prisma.activity.findMany({
      where: { ...activityScope, deletedAt: null, occurredAt: { gte: monthStart, lte: monthEnd } },
      take: 200,
      select: { id: true, occurredAt: true, type: { select: { name: true } } },
    }),
  ]);

  const items = [
    ...tasks.map(t => ({
      id: t.id,
      date: t.dueAt.toISOString(),
      label: t.title,
      kind: 'task' as const,
      completed: t.status === 'COMPLETED',
    })),
    ...activities.map(a => ({
      id: a.id,
      date: a.occurredAt.toISOString(),
      label: a.type.name,
      kind: 'activity' as const,
    })),
  ];

  return (
    <>
      <header style={{ marginBottom: 'var(--lf-space-4)' }}>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>Calendar</h1>
        <p style={{ margin: '2px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
          Tasks and activities for the current month
        </p>
      </header>
      <CalendarView items={items} />
    </>
  );
}
