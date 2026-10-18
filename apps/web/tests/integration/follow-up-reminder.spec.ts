import { randomBytes } from 'node:crypto';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { runReminderSweep } from '@/services/crm/reminders';
import { createWorkspaceUser } from '../helpers/fixtures';

// Audit M8-02: a Follow-ups register entry coming due rings the owner's bell, once.
// Audit M8-05: fifteen minutes before it is due (T-15), not 30-45.
const suffix = randomBytes(4).toString('hex');
let tenantId = '';
let ownerId = '';

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `fu-remind-${suffix}`, legalName: 'FU LLC', displayName: 'FU', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({
    data: { tenantId, key: `agent-${suffix}`, name: 'Agent', rank: 50, defaultScope: 'OWN' },
  });
  ownerId = (await createWorkspaceUser({ tenantId, roleId: role.id, email: `a@fu-${suffix}.test`, fullName: 'Agent' }))
    .id;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

it('a follow-up due in 20 minutes rings nothing yet; one due in 10 raises one follow_up.due notice, and a second sweep adds none (M8-05)', async () => {
  await prisma.followUpTask.create({
    data: { tenantId, ownerId, title: 'Not yet', dueAt: new Date(Date.now() + 20 * 60_000) },
  });
  const followUp = await prisma.followUpTask.create({
    data: {
      tenantId,
      ownerId,
      title: 'Call back about the villa',
      dueAt: new Date(Date.now() + 10 * 60_000),
    },
  });

  await runReminderSweep();
  await runReminderSweep();

  const bell = await prisma.notification.findMany({
    where: { tenantId, userId: ownerId, kind: 'follow_up.due' },
    select: { recordId: true, title: true },
  });
  expect(bell).toEqual([{ recordId: followUp.id, title: 'Call back about the villa' }]);
});

it('a site visit starting in 10 minutes raises one visit.reminder to its agent, one in 20 none yet (M8-13, M8-05)', async () => {
  const contact = await prisma.contact.create({
    data: { tenantId, reference: `C-FU-${suffix}`, fullName: 'Visiting client' },
  });
  const visitAt = (minutes: number) =>
    prisma.siteVisit.create({
      data: {
        tenantId,
        ownerId,
        contactId: contact.id,
        scheduledAt: new Date(Date.now() + minutes * 60_000),
        status: 'REQUESTED',
        kind: 'CLIENT_MEETING',
      },
    });
  await visitAt(20);
  const visit = await visitAt(10);

  await runReminderSweep();
  await runReminderSweep();

  const bell = await prisma.notification.findMany({
    where: { tenantId, userId: ownerId, kind: 'visit.reminder' },
    select: { recordId: true, title: true },
  });
  expect(bell).toEqual([{ recordId: visit.id, title: 'Site visit soon: a client' }]);
});

it('runs the reminder sweep from the maintenance queue every five minutes, and retires the quarter-hourly schedule (M8-05)', async () => {
  const { MAINTENANCE_JOBS, armMaintenanceScheduler } = await import('@/workers/maintenance');
  expect(Object.keys(MAINTENANCE_JOBS)).toContain('reminders');
  const armed = vi.spyOn(Queue.prototype, 'upsertJobScheduler').mockResolvedValue(undefined as never);
  const removed = vi.spyOn(Queue.prototype, 'removeJobScheduler').mockResolvedValue(true);
  try {
    await armMaintenanceScheduler();
    expect(armed).toHaveBeenCalledWith('reminders-five-minutely', { pattern: '*/5 * * * *' }, { name: 'reminders' });
    expect(armed.mock.calls.map(([id]) => id)).not.toContain('reminders-quarter-hourly');
    expect(removed).toHaveBeenCalledWith('reminders-quarter-hourly');
  } finally {
    armed.mockRestore();
    removed.mockRestore();
  }
});
