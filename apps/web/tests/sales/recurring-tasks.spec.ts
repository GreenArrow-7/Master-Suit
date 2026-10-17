import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { nextDue } from '@/lib/tasks/recurrence';
import { POST as createTask } from '@/app/api/v1/tasks/route';
import { PATCH as editTask } from '@/app/api/v1/tasks/[id]/route';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { patch, post } from '../helpers/request';

// Audit M8-10: a repeating task books its next occurrence when completed, once.
const suffix = randomBytes(4).toString('hex');
let fixture: Fixture;

beforeAll(async () => {
  fixture = await seedTwoTenants();
});
afterAll(async () => {
  await fixture.cleanup();
});

it('nextDue steps a day, a week or a month, and nothing for an unknown rule', () => {
  const due = new Date('2026-01-31T09:00:00Z');
  expect(nextDue(due, 'DAILY')?.toISOString()).toBe('2026-02-01T09:00:00.000Z');
  expect(nextDue(due, 'WEEKLY')?.toISOString()).toBe('2026-02-07T09:00:00.000Z');
  expect(nextDue(new Date('2026-03-15T09:00:00Z'), 'MONTHLY')?.toISOString()).toBe('2026-04-15T09:00:00.000Z');
  expect(nextDue(due, 'YEARLY')).toBeNull();
});

it('completing a weekly task creates next week’s, and completing it again creates no second copy', async () => {
  const { tenantId, cookie } = fixture.a;
  const type = await prisma.taskType.create({
    data: { tenantId, key: `call-${suffix}`, name: 'Call', category: 'TODO' },
  });
  const dueAt = new Date('2026-11-02T08:00:00Z');
  const created = await post(
    createTask,
    '/api/v1/tasks',
    { typeId: type.id, title: 'Weekly pipeline review', dueAt: dueAt.toISOString(), repeat: 'WEEKLY' },
    cookie,
  );
  expect(created.status).toBe(200);
  const id = created.body.id as string;

  expect((await patch(editTask, `/api/v1/tasks/${id}`, { status: 'COMPLETED' }, cookie, { id })).status).toBe(200);
  expect((await patch(editTask, `/api/v1/tasks/${id}`, { status: 'COMPLETED' }, cookie, { id })).status).toBe(200);

  const next = await prisma.task.findMany({
    where: { tenantId, parentTaskId: id },
    select: { title: true, dueAt: true, status: true, recurrenceRule: true },
  });
  expect(next).toEqual([
    {
      title: 'Weekly pipeline review',
      dueAt: new Date('2026-11-09T08:00:00Z'),
      status: 'OPEN',
      recurrenceRule: 'WEEKLY',
    },
  ]);
});
