import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const cookieJar = vi.hoisted(() => ({ value: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: cookieJar.value, 'x-pathname': '/' }),
  cookies: async () => ({
    get: (name: string) => {
      const match = cookieJar.value.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? { name, value: match[1] } : undefined;
    },
  }),
}));

import { prisma } from '@/lib/db';
import { executeTool } from '@/lib/ai/assistant/tools';
import { DELETE as deleteEvent, GET as readEvent, PATCH as patchEvent } from '@/app/api/v1/events/[id]/route';
import { POST as circulate } from '@/app/api/v1/events/[id]/invite/route';
import { POST as addInvitees } from '@/app/api/v1/events/[id]/invitees/route';
import { POST as rsvp } from '@/app/api/v1/events/[id]/rsvp/route';
import EventsPage from '@/app/(workspace)/[workspaceSlug]/sales/events/page';
import EventPage from '@/app/(workspace)/[workspaceSlug]/sales/events/[id]/page';
import EventActions from '@/app/(workspace)/[workspaceSlug]/sales/events/[id]/EventActions';
import RsvpControl from '@/app/(workspace)/[workspaceSlug]/sales/events/[id]/RsvpControl';
import CalendarPage from '@/app/(workspace)/[workspaceSlug]/sales/calendar/page';
import CalendarView from '@/app/(workspace)/[workspaceSlug]/sales/calendar/CalendarView';
import { buildActor, buildCtx } from '../helpers/ctx';
import { grantPermissions, seedHierarchy, type Hierarchy } from '../helpers/fixtures';
import { del, get, patch, post } from '../helpers/request';
import type { PermissionMap } from '@/lib/security/rbac';

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
let repA1Meeting: string;
let repA2Meeting: string;
let eventMonth: string;
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
  // The screens: the calendar is gated on tasks, and an event's meetings are calls.
  await grantPermissions(
    tenantId,
    await roleOf(h.repA1.id),
    [
      ['tasks', 'VIEW'],
      ['calls', 'VIEW'],
    ],
    'OWN',
  );
  eventMonth = `${startAt.getFullYear()}-${String(startAt.getMonth() + 1).padStart(2, '0')}`;
  const meeting = async (callerId: string) =>
    (await prisma.call.create({ data: { tenantId, callerId, eventId: repA2Event } })).id;
  repA1Meeting = await meeting(h.repA1.id);
  repA2Meeting = await meeting(h.repA2.id);

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
    const url = `/api/v1/events/${repA2Event}`;
    const eventNow = () => prisma.event.findFirstOrThrow({ where: { tenantId: h.tenantId, id: repA2Event } });
    const rsvpNow = () => prisma.eventInvitee.findFirstOrThrow({ where: { tenantId: h.tenantId, id: repA1Invite } });
    const [event, answer] = [await eventNow(), await rsvpNow()];
    for (const res of [
      await invite(repA2Event, [{ name: 'Plus one' }], h.teamManagerA.cookie),
      await patch(patchEvent, url, { title: 'Ours now' }, h.teamManagerA.cookie),
      await post(circulate, `${url}/invite`, { template: 'launch' }, h.teamManagerA.cookie),
      await post(rsvp, `${url}/rsvp`, { inviteeId: repA1Invite, rsvpStatus: 'DECLINED' }, h.teamManagerA.cookie),
    ]) {
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    }
    expect(await eventNow()).toEqual(event);
    expect(await rsvpNow()).toEqual(answer);
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

/**
 * The screens read events by tenant alone while the API beside them applied the
 * scope: a rep at OWN listed every event in the workspace, opened any of them
 * with its invitees' contact details and meeting summaries, and was offered
 * Circulate and Record RSVP on events the API refuses them.
 */
describe('the event screens', () => {
  /** Every element a server component hands back, depth first. */
  const elements = (node: unknown): ReactElement<Record<string, unknown>>[] => {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!node || typeof node !== 'object' || !('props' in node)) return [];
    const el = node as ReactElement<Record<string, unknown>>;
    return [el, ...elements(el.props.children)];
  };
  const hrefs = (node: unknown, prefix: string) =>
    elements(node)
      .map((el) => el.props.href)
      .filter((href): href is string => typeof href === 'string' && href.startsWith(prefix))
      .sort();
  const as = (who: { cookie: string }) => {
    cookieJar.value = who.cookie;
  };
  const openEvent = (id: string) => EventPage({ params: Promise.resolve({ id }) });

  it('the Events page and the calendar list what the caller hosts or was invited to', async () => {
    as(h.repA1);
    const listed = hrefs(await EventsPage({ searchParams: Promise.resolve({}) }), '/events/');
    expect(listed).toEqual([`/events/${repA1Event}`, `/events/${repA2Event}`].sort());

    const calendar = elements(await CalendarPage({ searchParams: Promise.resolve({ month: eventMonth }) })).find(
      (el) => el.type === CalendarView,
    )!;
    const onCalendar = (calendar.props.items as { kind: string; href: string }[])
      .filter((item) => item.kind === 'event')
      .map((item) => item.href)
      .sort();
    expect(onCalendar).toEqual(listed);
  });

  it('an event outside the caller’s scope is not found', async () => {
    as(h.repA1);
    await expect(openEvent(managerEvent)).rejects.toThrow(/;404$/);
  });

  it('an invitee reads the event without the controls the API refuses them, and only their own meetings', async () => {
    as(h.repA1);
    const node = await openEvent(repA2Event);
    const page = elements(node);
    expect(page.filter((el) => el.type === EventActions || el.type === RsvpControl)).toEqual([]);
    expect(hrefs(node, '/calls/')).toEqual([`/calls/${repA1Meeting}`]);
  });

  it('its host gets them', async () => {
    as(h.repA2);
    const node = await openEvent(repA2Event);
    const page = elements(node);
    expect(page.some((el) => el.type === EventActions)).toBe(true);
    expect(page.some((el) => el.type === RsvpControl)).toBe(true);
    expect(hrefs(node, '/calls/')).toEqual([`/calls/${repA2Meeting}`]);
  });

  it('the assistant’s calendar names the same events', async () => {
    const ctx = buildCtx(
      buildActor({
        id: h.repA1.id,
        tenantId: h.tenantId,
        permissions: new Map([['events:VIEW', 'OWN']]) as PermissionMap,
      }),
    );
    const result = await executeTool(ctx, 'getCalendar', { days: 3 });
    const named = (result.sources ?? []).filter((s) => s.type === 'event').map((s) => s.id);
    expect(named.sort()).toEqual([repA1Event, repA2Event].sort());
  });
});
