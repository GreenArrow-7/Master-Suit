import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { DELETE as deleteEvent, GET as readEvent, PATCH as patchEvent } from '@/app/api/v1/events/[id]/route';
import { POST as circulate } from '@/app/api/v1/events/[id]/invite/route';
import { POST as addInvitees } from '@/app/api/v1/events/[id]/invitees/route';
import { POST as rsvp } from '@/app/api/v1/events/[id]/rsvp/route';
import { grantPermissions, seedHierarchy, type Hierarchy } from '../helpers/fixtures';
import { del, get, patch, post } from '../helpers/request';

/**
 * Adding invitees took any lead id in the body, and the event's calling queue
 * then showed each invitee's lead, by name and number, to the event's callers.
 * The route also checked the event at VIEW, which lets an invitee in.
 */
let h: Hierarchy;
let unassigned: string;
let repA1Event: string;
let repA2Event: string;
let managerEvent: string;
let repA1Invite: string;
const MISSING = `c${'0'.repeat(24)}`;
const invite = (eventId: string, invitees: Record<string, unknown>[], cookie: string) =>
  post(addInvitees, `/api/v1/events/${eventId}/invitees`, { invitees }, cookie);
const lead = (leadId: string) => ({ leadId, name: 'Guest', phone: '+971500000001' });
const inviteesOf = (eventId: string, leadId?: string) =>
  prisma.eventInvitee.count({ where: { tenantId: h.tenantId, eventId, ...(leadId ? { leadId } : {}) } });

beforeAll(async () => {
  h = await seedHierarchy();
  const { tenantId } = h;
  const roleOf = async (userId: string) =>
    (await prisma.user.findFirstOrThrow({ where: { tenantId, id: userId }, select: { roleId: true } })).roleId;
  // The fixture's roles hold only `leads`. Reps run their own events; the team
  // manager reads the team's events and edits only their own.
  await grantPermissions(
    tenantId,
    await roleOf(h.repA1.id),
    [
      ['events', 'VIEW'],
      ['events', 'EDIT'],
      ['events', 'DELETE'],
    ],
    'OWN',
  );
  const managerRole = await roleOf(h.teamManagerA.id);
  await grantPermissions(tenantId, managerRole, [['events', 'VIEW']], 'TEAM');
  await grantPermissions(tenantId, managerRole, [['events', 'EDIT']], 'OWN');

  const startAt = new Date(Date.now() + 86_400_000);
  const eventOf = async (hostId: string) =>
    (
      await prisma.event.create({
        data: { tenantId, title: 'Launch evening', startAt, endAt: startAt, hostId, createdById: hostId },
      })
    ).id;
  repA1Event = await eventOf(h.repA1.id);
  repA2Event = await eventOf(h.repA2.id);
  managerEvent = await eventOf(h.teamManagerA.id);
  repA1Invite = (await prisma.eventInvitee.create({ data: { tenantId, eventId: repA2Event, userId: h.repA1.id } })).id;

  const { stageId } = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: h.repA1.leadId } });
  unassigned = (await prisma.lead.create({ data: { tenantId, reference: 'POOL-1', fullName: 'Pool lead', stageId } }))
    .id;
}, 60_000);
afterAll(async () => {
  await h?.cleanup();
});

describe('naming a lead as an invitee', () => {
  it('refuses a teammate’s lead exactly as one that does not exist, and adds nobody from the batch', async () => {
    const theirs = await invite(repA1Event, [lead(h.repA1.leadId), lead(h.repA2.leadId)], h.repA1.cookie);
    const missing = await invite(repA1Event, [lead(MISSING)], h.repA1.cookie);
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(theirs.body.detail).toBe(missing.body.detail);
    expect(await inviteesOf(repA1Event)).toBe(0);
  });

  it('refuses an unassigned lead to someone who may not assign it', async () => {
    expect((await invite(repA1Event, [lead(unassigned)], h.repA1.cookie)).status).toBe(404);
  });

  it('takes the caller’s own lead', async () => {
    const res = await invite(repA1Event, [lead(h.repA1.leadId), { name: 'Walk-in' }], h.repA1.cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await inviteesOf(repA1Event, h.repA1.leadId)).toBe(1);
  });

  it('a team manager names the team’s leads and unassigned ones, not another team’s', async () => {
    const ours = await invite(managerEvent, [lead(h.repA1.leadId), lead(unassigned)], h.teamManagerA.cookie);
    expect(ours.status, JSON.stringify(ours.body)).toBe(200);
    expect((await invite(managerEvent, [lead(h.repB1.leadId)], h.teamManagerA.cookie)).status).toBe(404);
  });
});

describe('the event', () => {
  it('an invitee reads it and cannot add to it', async () => {
    expect((await get(readEvent, `/api/v1/events/${repA2Event}`, h.repA1.cookie)).status).toBe(200);
    expect((await invite(repA2Event, [{ name: 'Plus one' }], h.repA1.cookie)).status).toBe(404);
    expect(await inviteesOf(repA2Event)).toBe(1);
  });

  it('reading the team’s events does not stretch editing to them', async () => {
    expect((await invite(repA2Event, [{ name: 'Plus one' }], h.teamManagerA.cookie)).status).toBe(404);
  });

  it('an invitee holding each action at OWN cannot change, delete, circulate or answer for it', async () => {
    const url = `/api/v1/events/${repA2Event}`;
    const missing = await patch(patchEvent, `/api/v1/events/${MISSING}`, { title: 'Mine now' }, h.repA1.cookie);
    for (const res of [
      await patch(patchEvent, url, { title: 'Mine now' }, h.repA1.cookie),
      await del(deleteEvent, url, h.repA1.cookie),
      await post(circulate, `${url}/invite`, { template: 'launch' }, h.repA1.cookie),
      await post(rsvp, `${url}/rsvp`, { inviteeId: repA1Invite, rsvpStatus: 'DECLINED' }, h.repA1.cookie),
    ]) {
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body.detail).toBe(missing.body.detail);
    }
    const event = await prisma.event.findFirstOrThrow({ where: { tenantId: h.tenantId, id: repA2Event } });
    expect(event).toMatchObject({ title: 'Launch evening', deletedAt: null });
    const invitee = await prisma.eventInvitee.findFirstOrThrow({ where: { tenantId: h.tenantId, id: repA1Invite } });
    expect(invitee).toMatchObject({ rsvpStatus: 'PENDING', rsvpAt: null });
  });

  it('its host changes it and answers for its invitees', async () => {
    const url = `/api/v1/events/${repA2Event}`;
    const answered = await post(
      rsvp,
      `${url}/rsvp`,
      { inviteeId: repA1Invite, rsvpStatus: 'CONFIRMED' },
      h.repA2.cookie,
    );
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect((await patch(patchEvent, url, { title: 'Launch night' }, h.repA2.cookie)).status).toBe(200);
  });
});
