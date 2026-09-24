import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, withPlatformTx } from '@/lib/db';
import { notifyCrm } from '@/services/crm/notify';
import { enqueue } from '@/lib/queue';
import type { Ctx } from '@/lib/security/rbac';

/**
 * The queue is stubbed so the push enqueue is observable without a Redis and
 * without a worker. What is being asserted is the decision — which events ring
 * a phone and what the job carries — not BullMQ's ability to hold a job.
 */
vi.mock('@/lib/queue', () => ({ enqueue: vi.fn(async () => undefined) }));
const enqueued = vi.mocked(enqueue);

/**
 * The CRM bell, which until now only rang for workspaces that had built an
 * automation rule.
 *
 * The cases below are the ones that separate a working notifier from a plausible
 * one. Each maps to a way this feature fails in production rather than in a
 * type check:
 *
 *   * Notifying yourself. The owner of a new lead is usually the person who just
 *     created it, so without the actor filter the commonest event in the system
 *     is a bell telling you about your own click. That is how a notification
 *     panel becomes something people stop opening.
 *   * Deactivated logins. Their rows survive, so a leaver keeps accruing an
 *     unread count nobody will ever clear, and any per-user delivery built on
 *     top of this would keep addressing them.
 *   * Reassignment reaching the previous owner. The record leaves their list
 *     either way; the notification is the only thing that says why.
 *   * Never throwing. A lead must save even when the notification cannot be
 *     written — the record is the durable thing and the bell is not.
 */

const suffix = randomBytes(4).toString('hex');
const state = { tenantId: '', roleId: '', actorId: '', ownerId: '', leaverId: '' };

async function makeUser(email: string, status: 'ACTIVE' | 'DEACTIVATED') {
  const user = await prisma.user.create({
    data: {
      tenantId: state.tenantId,
      email,
      fullName: email,
      roleId: state.roleId,
      status,
    },
  });
  return user.id;
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `crmnoti-${suffix}`, legalName: `crmnoti ${suffix} LLC`, displayName: `crmnoti ${suffix}` },
  });
  state.tenantId = tenant.id;

  const role = await prisma.role.create({
    data: { tenantId: tenant.id, key: `agent-${suffix}`, name: 'Agent', rank: 50 },
  });
  state.roleId = role.id;

  state.actorId = await makeUser(`actor-${suffix}@example.test`, 'ACTIVE');
  state.ownerId = await makeUser(`owner-${suffix}@example.test`, 'ACTIVE');
  state.leaverId = await makeUser(`leaver-${suffix}@example.test`, 'DEACTIVATED');
});

afterAll(async () => {
  await withPlatformTx(async (tx) => {
    if (state.tenantId) await tx.tenant.delete({ where: { id: state.tenantId } });
  });
});

const ctx = () => ({ tenantId: state.tenantId, actor: { id: state.actorId } }) as unknown as Ctx;

const rowsFor = (userId: string) =>
  prisma.notification.findMany({
    where: { tenantId: state.tenantId, userId },
    select: { kind: true, title: true, objectType: true, recordId: true, readAt: true },
  });

describe('notifyCrm', () => {
  it('does not tell you about your own action', async () => {
    const result = await notifyCrm(ctx(), {
      event: 'lead.created',
      ownerId: state.actorId,
      title: 'New lead: self',
      objectType: 'lead',
      recordId: 'lead-self',
    });

    expect(result.recipients).toBe(0);
    expect(await rowsFor(state.actorId)).toHaveLength(0);
  });

  it('writes a row for another owner, carrying the record it points at', async () => {
    const result = await notifyCrm(ctx(), {
      event: 'lead.created',
      ownerId: state.ownerId,
      title: 'New lead: Marco Haddad',
      body: 'LD-000123',
      objectType: 'lead',
      recordId: 'lead-abc',
    });

    expect(result.recipients).toBe(1);
    const [row] = await rowsFor(state.ownerId);
    // objectType + recordId are what the read path resolves into a destination;
    // a row without them is a notification that cannot be clicked.
    expect(row).toMatchObject({
      kind: 'lead.created',
      objectType: 'lead',
      recordId: 'lead-abc',
      readAt: null,
    });
  });

  it('skips a deactivated login rather than accruing unread rows for a leaver', async () => {
    const result = await notifyCrm(ctx(), {
      event: 'lead.assigned',
      ownerId: state.leaverId,
      title: 'Lead assigned: nobody',
      objectType: 'lead',
      recordId: 'lead-leaver',
    });

    expect(result.recipients).toBe(0);
    expect(await rowsFor(state.leaverId)).toHaveLength(0);
  });

  it('tells the previous owner too, so a record does not vanish unexplained', async () => {
    const second = await makeUser(`second-${suffix}@example.test`, 'ACTIVE');

    const result = await notifyCrm(ctx(), {
      event: 'lead.assigned',
      ownerId: second,
      alsoNotify: [state.ownerId],
      title: 'Lead assigned: Marco Haddad',
      objectType: 'lead',
      recordId: 'lead-moved',
    });

    expect(result.recipients).toBe(2);
    expect((await rowsFor(second)).some((row) => row.recordId === 'lead-moved')).toBe(true);
    expect((await rowsFor(state.ownerId)).some((row) => row.recordId === 'lead-moved')).toBe(true);
  });

  it('de-duplicates a recipient named twice', async () => {
    const result = await notifyCrm(ctx(), {
      event: 'lead.stage_changed',
      ownerId: state.ownerId,
      // The previous owner and the new owner are the same person whenever a
      // stage change is written alongside a no-op reassignment.
      alsoNotify: [state.ownerId, null, undefined],
      title: 'Marco Haddad moved to Qualified',
      objectType: 'lead',
      recordId: 'lead-dedup',
    });

    expect(result.recipients).toBe(1);
    expect((await rowsFor(state.ownerId)).filter((row) => row.recordId === 'lead-dedup')).toHaveLength(1);
  });

  it('returns rather than throws when the write cannot happen', async () => {
    // A tenant that does not exist fails the foreign key. The caller is a lead
    // save, which must still succeed.
    const orphan = { tenantId: 'tenant-that-does-not-exist', actor: { id: state.actorId } } as unknown as Ctx;

    await expect(
      notifyCrm(orphan, {
        event: 'call.missed',
        ownerId: state.ownerId,
        title: 'Missed call',
        objectType: 'call',
        recordId: 'call-x',
      }),
    ).resolves.toEqual({ recipients: 0 });
  });
});

/**
 * Follow-ups have to reach the phone, and most things must not.
 *
 * The CRM bell wrote in-app rows and nothing else: push was wired for HR events
 * alone, so a follow-up falling due lit a screen nobody was looking at. That is
 * the case the owner named — "notifications we can miss".
 *
 * The other half of the property matters just as much. Pushing all eight events
 * would ring a pocket for every stage change, and a phone that buzzes at
 * bookkeeping is a phone whose notifications get turned off — taking the
 * follow-up reminder with them.
 */
describe('which events reach a phone', () => {
  beforeEach(() => {
    enqueued.mockClear();
  });

  it('a follow-up falling due rings the phone and says so on the row', async () => {
    const result = await notifyCrm(ctx(), {
      event: 'follow_up.due',
      ownerId: state.ownerId,
      title: 'Follow-up due: Marco Haddad',
      body: 'Call back at 3pm',
      objectType: 'lead',
      recordId: 'lead-followup',
    });
    expect(result.recipients).toBe(1);

    const row = (await rowsFor(state.ownerId)).find((r) => r.kind === 'follow_up.due');
    expect(row).toBeDefined();

    expect(enqueued).toHaveBeenCalledTimes(1);
    const [queue, name, payload] = enqueued.mock.calls[0]!;
    expect(queue).toBe('notifications');
    expect(name).toBe('record-push');
    // The record, never a path: the recipient's workspace slug is not known
    // here, and a stored path is what made these clicks 404 before.
    expect(payload).toMatchObject({
      tenantId: state.tenantId,
      userIds: [state.ownerId],
      objectType: 'lead',
      recordId: 'lead-followup',
    });
    expect(JSON.stringify(payload)).not.toContain('http');
  });

  it('a stage change stays in the bell', async () => {
    const result = await notifyCrm(ctx(), {
      event: 'lead.stage_changed',
      ownerId: state.ownerId,
      title: 'Marco Haddad moved to Contacted',
      objectType: 'lead',
      recordId: 'lead-stage',
    });
    expect(result.recipients).toBe(1);
    expect(enqueued).not.toHaveBeenCalled();
  });

  it('rings only for the events that have a clock or a handover behind them', async () => {
    const rings = async (event: Parameters<typeof notifyCrm>[1]['event']) => {
      enqueued.mockClear();
      await notifyCrm(ctx(), {
        event,
        ownerId: state.ownerId,
        title: `probe ${event}`,
        objectType: 'lead',
        recordId: `probe-${event}`,
      });
      return enqueued.mock.calls.length > 0;
    };

    expect(await rings('follow_up.due')).toBe(true);
    expect(await rings('call.reminder')).toBe(true);
    expect(await rings('lead.assigned')).toBe(true);
    expect(await rings('call.missed')).toBe(true);

    expect(await rings('lead.created')).toBe(false);
    expect(await rings('lead.stage_changed')).toBe(false);
    expect(await rings('call.scheduled')).toBe(false);
    expect(await rings('call.completed')).toBe(false);
  });

  it('tells nobody, and rings nothing, when there is no recipient', async () => {
    const result = await notifyCrm(ctx(), {
      event: 'follow_up.due',
      ownerId: state.actorId, // the actor is excluded
      title: 'Follow-up due: self',
      objectType: 'lead',
      recordId: 'lead-self-followup',
    });
    expect(result.recipients).toBe(0);
    expect(enqueued).not.toHaveBeenCalled();
  });
});
