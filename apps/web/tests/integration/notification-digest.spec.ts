import { randomBytes } from 'node:crypto';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { mockOutbox } from '@/lib/mailer';
import { readPrefs } from '@/lib/notificationPrefs';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import * as recordScope from '@/lib/security/record-scope';
import { runDigestSweep } from '@/services/notifications/digest';
import { pushRecord } from '@/workers/notifications';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';

// Audit M8-04, M17-04: one morning email to each person who chose it — follow-ups
// overdue and due today, leads given to them since the last one — in place of one
// email per notification. The fixture workspace keeps Dubai's clock (UTC+4).
const suffix = randomBytes(4).toString('hex');
let fixture: Fixture;
let tenantId = '';
const people = {} as Record<'digest' | 'each', { id: string; email: string }>;

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  const { roleId } = await prisma.user.findFirstOrThrow({ where: { tenantId, id: fixture.a.userId } });
  // The summary reader opens only their own leads, as an agent does.
  const ownRole = await prisma.role.create({ data: { tenantId, key: `own-${suffix}`, name: 'Own agent' } });
  await grantPermissions(tenantId, ownRole.id, [['leads', 'VIEW']], 'OWN');
  const prefs = { digest: { push: true, email: true, digest: true }, each: { push: true, email: true } };
  for (const label of ['digest', 'each'] as const) {
    const email = `${label}-${suffix}@digest.test`;
    const user = await createWorkspaceUser({
      tenantId,
      roleId: label === 'digest' ? ownRole.id : roleId,
      email,
      fullName: `${label} agent`,
    });
    await prisma.user.updateMany({ where: { tenantId, id: user.id }, data: { notificationPrefs: prefs[label] } });
    people[label] = { id: user.id, email };
  }
  // A lead and the hand-over that gave it to its owner: by `by`, at `at`.
  const lead = async (name: string, ownerId: string, at: string, by = fixture.a.userId, deletedAt?: string) => {
    const made = await prisma.lead.create({
      data: {
        tenantId,
        reference: `DG-${name.replace(/\W/g, '')}-${suffix}`,
        fullName: name,
        stageId: fixture.a.stageId,
        ownerId,
        assignedAt: new Date(at),
        deletedAt: deletedAt ? new Date(deletedAt) : null,
      },
    });
    await prisma.leadAssignmentHistory.create({
      data: { tenantId, leadId: made.id, toOwnerId: ownerId, assignedById: by, createdAt: new Date(at) },
    });
    return made;
  };
  const fresh = await lead('Fresh Lead', people.digest.id, '2026-10-17T10:00:00Z');
  await lead('Old Lead', people.digest.id, '2026-10-01T10:00:00Z');
  // Their own, made by themselves: not "given to" them.
  await lead('Self Made', people.digest.id, '2026-10-17T11:00:00Z', people.digest.id);
  // Handed on to a colleague since, and deleted: their open follow-ups stay, unnamed.
  const movedAway = await lead('Moved Away', people.each.id, '2026-10-17T12:00:00Z');
  const deleted = await lead('Gone Lead', people.digest.id, '2026-10-01T10:00:00Z', undefined, '2026-10-17T12:00:00Z');
  const followUp = (
    title: string,
    ownerId: string,
    dueAt: string,
    status: 'OPEN' | 'COMPLETED' = 'OPEN',
    leadId = fresh.id,
  ) =>
    prisma.followUpTask.create({
      data: { tenantId, leadId, ownerId, title, dueAt: new Date(dueAt), status },
    });
  await followUp('Overdue one', people.digest.id, '2026-10-16T10:00:00Z');
  await followUp('Overdue two', people.digest.id, '2026-10-17T06:00:00Z');
  await followUp('Due today', people.digest.id, '2026-10-18T09:00:00Z');
  await followUp('Tomorrow', people.digest.id, '2026-10-19T09:00:00Z');
  await followUp('Already done', people.digest.id, '2026-10-16T09:00:00Z', 'COMPLETED');
  await followUp('Not a digest reader', people.each.id, '2026-10-16T09:00:00Z');
  await followUp('Call back moved', people.digest.id, '2026-10-17T07:00:00Z', 'OPEN', movedAway.id);
  await followUp('Call back gone', people.digest.id, '2026-10-17T08:00:00Z', 'OPEN', deleted.id);
});

afterAll(async () => {
  await fixture.cleanup();
});

beforeEach(() => mockOutbox.clear());

const mails = () => mockOutbox.all().map((mail) => ({ to: mail.to, subject: mail.subject, body: mail.body }));
const sentAt = async () =>
  (await prisma.user.findFirstOrThrow({ where: { tenantId, id: people.digest.id }, select: { digestSentAt: true } }))
    .digestSentAt;

it('reads the daily summary only alongside email', () => {
  expect(readPrefs(undefined)).toEqual({ push: true, email: false, digest: false });
  expect(readPrefs({ push: true, email: true, digest: true })).toEqual({ push: true, email: true, digest: true });
  expect(readPrefs({ push: true, email: false, digest: true }).digest).toBe(false);
});

it('sends nothing before eight on the workspace clock', async () => {
  expect(await runDigestSweep(new Date('2026-10-18T03:30:00Z'), tenantId)).toEqual({ sent: 0 });
  expect(mails()).toEqual([]);
});

it('sends one summary at eight, to the person who chose it, and only once that day', async () => {
  expect(await runDigestSweep(new Date('2026-10-18T04:05:00Z'), tenantId)).toEqual({ sent: 1 });
  const [mail, ...rest] = mails();
  expect(rest).toEqual([]);
  expect(mail).toMatchObject({ to: people.digest.email, subject: 'Your day: 4 overdue, 1 due today, 1 new lead' });
  expect(mail!.body).toContain('Overdue one · Fresh Lead · 16 Oct, 14:00');
  expect(mail!.body).toContain('Overdue two');
  expect(mail!.body).toContain('Due today · Fresh Lead · 18 Oct, 13:00');
  expect(mail!.body).toContain('Fresh Lead (DG-FreshLead');
  // A lead the reader no longer opens, or one deleted, is not named.
  expect(mail!.body).toContain('- Call back moved · 17 Oct, 11:00');
  expect(mail!.body).toContain('- Call back gone · 17 Oct, 12:00');
  const absent = [
    'Old Lead',
    'Tomorrow',
    'Already done',
    'Not a digest reader',
    'Self Made',
    'Moved Away',
    'Gone Lead',
  ];
  for (const text of absent) expect(mail!.body).not.toContain(text);

  mockOutbox.clear();
  expect(await runDigestSweep(new Date('2026-10-18T05:05:00Z'), tenantId)).toEqual({ sent: 0 });
  expect(mails()).toEqual([]);
});

it('lists the next morning only the leads given since the last summary', async () => {
  await runDigestSweep(new Date('2026-10-19T04:05:00Z'), tenantId);
  const [mail] = mails();
  // Yesterday's "due today" is overdue now; tomorrow's is today's.
  expect(mail!.subject).toBe('Your day: 5 overdue, 1 due today');
  expect(mail!.body).not.toContain('Fresh Lead (');
});

it('hands the day back when anything fails after the claim, so the next hour tries again', async () => {
  const before = await sentAt();
  const lost = vi.spyOn(recordScope, 'leadsInScope').mockRejectedValueOnce(new Error('connection lost'));
  try {
    expect(await runDigestSweep(new Date('2026-10-20T04:05:00Z'), tenantId)).toEqual({ sent: 0 });
  } finally {
    lost.mockRestore();
  }
  expect(await sentAt()).toEqual(before);
  expect(await runDigestSweep(new Date('2026-10-20T05:05:00Z'), tenantId)).toEqual({ sent: 1 });
});

it('sends nothing to a workspace that no longer has a lead product', async () => {
  const sales = { tenantId, module: 'SALES' as const };
  await prisma.moduleEntitlement.updateMany({ where: sales, data: { state: 'CANCELED' } });
  await invalidateEntitlements(tenantId);
  try {
    expect(await runDigestSweep(new Date('2026-10-21T04:05:00Z'), tenantId)).toEqual({ sent: 0 });
  } finally {
    await prisma.moduleEntitlement.updateMany({ where: sales, data: { state: 'ACTIVE' } });
    await invalidateEntitlements(tenantId);
  }
  expect(await runDigestSweep(new Date('2026-10-21T05:05:00Z'), tenantId)).toEqual({ sent: 1 });
});

it('sends at eight on the local clock on the day the clocks change', async () => {
  await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: 'Europe/London' } });
  try {
    // 25 Oct 2026: London is back on GMT from 01:00, so 07:05Z is 07:05 there.
    expect(await runDigestSweep(new Date('2026-10-25T07:05:00Z'), tenantId)).toEqual({ sent: 0 });
    expect(await runDigestSweep(new Date('2026-10-25T08:05:00Z'), tenantId)).toEqual({ sent: 1 });
    // 28 Mar 2027: on BST from 01:00 GMT, so 06:05Z is 07:05 there and 07:05Z is 08:05.
    expect(await runDigestSweep(new Date('2027-03-28T06:05:00Z'), tenantId)).toEqual({ sent: 0 });
    expect(await runDigestSweep(new Date('2027-03-28T07:05:00Z'), tenantId)).toEqual({ sent: 1 });
  } finally {
    await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: 'Asia/Dubai' } });
  }
});

it('stops the email copy of each notification for a summary reader', async () => {
  const result = await pushRecord({
    tenantId,
    userIds: [people.digest.id, people.each.id],
    title: 'Follow-up due: Fresh Lead',
    body: 'Due soon',
    objectType: 'lead',
    recordId: 'lead-1',
  });
  expect(result.emailed).toBe(1);
  expect(mails().map((mail) => mail.to)).toEqual([people.each.email]);
});

it('runs from the maintenance queue every hour', async () => {
  const { MAINTENANCE_JOBS, armMaintenanceScheduler } = await import('@/workers/maintenance');
  expect(Object.keys(MAINTENANCE_JOBS)).toContain('digest');
  const armed = vi.spyOn(Queue.prototype, 'upsertJobScheduler').mockResolvedValue(undefined as never);
  try {
    await armMaintenanceScheduler();
    expect(armed).toHaveBeenCalledWith('morning-digest-hourly', { pattern: '5 * * * *' }, { name: 'digest' });
  } finally {
    armed.mockRestore();
  }
});
