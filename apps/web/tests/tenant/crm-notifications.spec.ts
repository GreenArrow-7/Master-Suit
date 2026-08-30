import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withPlatformTx } from '@/lib/db';
import { notifyCrm } from '@/services/crm/notify';
import type { Ctx } from '@/lib/security/rbac';

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
