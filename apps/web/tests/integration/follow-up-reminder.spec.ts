import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { runReminderSweep } from '@/services/crm/reminders';
import { createWorkspaceUser } from '../helpers/fixtures';

// Audit M8-02: a Follow-ups register entry coming due rings the owner's bell, once.
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

it('a follow-up due in 20 minutes raises one follow_up.due notice, and a second sweep adds none', async () => {
  const followUp = await prisma.followUpTask.create({
    data: {
      tenantId,
      ownerId,
      title: 'Call back about the villa',
      dueAt: new Date(Date.now() + 20 * 60_000),
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

it('a site visit starting in 30 minutes raises one visit.reminder to its agent (M8-13)', async () => {
  const contact = await prisma.contact.create({
    data: { tenantId, reference: `C-FU-${suffix}`, fullName: 'Visiting client' },
  });
  const visit = await prisma.siteVisit.create({
    data: {
      tenantId,
      ownerId,
      contactId: contact.id,
      scheduledAt: new Date(Date.now() + 30 * 60_000),
      status: 'REQUESTED',
      kind: 'CLIENT_MEETING',
    },
  });

  await runReminderSweep();
  await runReminderSweep();

  const bell = await prisma.notification.findMany({
    where: { tenantId, userId: ownerId, kind: 'visit.reminder' },
    select: { recordId: true, title: true },
  });
  expect(bell).toEqual([{ recordId: visit.id, title: 'Site visit soon: a client' }]);
});
