/**
 * Events must respect record scope, without hiding the company calendar.
 *
 * `GET /api/v1/events` filtered on `tenantId` alone, so `events:VIEW` at OWN
 * listed every event in the company, and the detail and child routes did not
 * scope at all. The call fix could not simply be copied: an all-hands is meant
 * to be seen by everyone, and somebody invited to an event must be able to open
 * it even when its host is outside their scope.
 *
 * So there are exactly three ways to see an event — it is ORGANIZATION-wide,
 * its host is in your scope, or you are on its invitee list — and the third one
 * grants READ ONLY. These assertions pin all of that down, and pin down that
 * mutations never inherit the exemption.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { grantPermissions } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { del, get, patch, post } from '../helpers/request';
import { GET as listEvents } from '@/app/api/v1/events/route';
import { GET as getEvent, PATCH as patchEvent, DELETE as deleteEvent } from '@/app/api/v1/events/[id]/route';
import { POST as addInvitee } from '@/app/api/v1/events/[id]/invitees/route';

const suffix = randomBytes(4).toString('hex');

let tenantId = '';
let hostUserId = '';
let scopedEventId = '';
let orgEventId = '';
let invitedEventId = '';
let hostCookie = '';
let outsiderCookie = '';
let inviteeCookie = '';
let inviteeUserId = '';
let directorCookie = '';

async function member(label: string, scope: 'OWN' | 'ORGANIZATION') {
  const email = `${label}-${suffix}@event-visibility.test`;
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: label, status: 'ACTIVE' },
  });
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 50, defaultScope: scope },
  });
  await grantPermissions(
    tenantId,
    role.id,
    [
      ['events', 'VIEW'],
      ['events', 'EDIT'],
      ['events', 'DELETE'],
      ['events', 'CREATE'],
    ],
    scope,
  );
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: label, roleId: role.id, status: 'ACTIVE' },
  });
  await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  return { userId: user.id, cookie: await createSessionToken(tenantId, user.id) };
}

const times = () => ({ startAt: new Date(Date.now() + 86_400_000), endAt: new Date(Date.now() + 90_000_000) });

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `event-vis-${suffix}`, legalName: 'Event Visibility LLC', displayName: 'Event Visibility' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const host = await member('host', 'OWN');
  const outsider = await member('outsider', 'OWN');
  const invitee = await member('invitee', 'OWN');
  const director = await member('director', 'ORGANIZATION');
  hostUserId = host.userId;
  hostCookie = host.cookie;
  outsiderCookie = outsider.cookie;
  inviteeCookie = invitee.cookie;
  inviteeUserId = invitee.userId;
  directorCookie = director.cookie;

  const scoped = await prisma.event.create({
    data: { tenantId, title: 'Private client dinner', hostId: hostUserId, visibility: 'SCOPED', ...times() },
  });
  scopedEventId = scoped.id;

  const org = await prisma.event.create({
    data: { tenantId, title: 'All hands', hostId: hostUserId, visibility: 'ORGANIZATION', ...times() },
  });
  orgEventId = org.id;

  const invited = await prisma.event.create({
    data: { tenantId, title: 'Scoped but invited', hostId: hostUserId, visibility: 'SCOPED', ...times() },
  });
  invitedEventId = invited.id;
  await prisma.eventInvitee.create({
    data: { tenantId, eventId: invitedEventId, userId: inviteeUserId, name: 'Invitee' },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
});

describe('event record visibility', () => {
  it('lets the host see their own scoped event', async () => {
    const res = await get(getEvent, `/api/v1/events/${scopedEventId}`, hostCookie, { id: scopedEventId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('hides a scoped event from someone with no relationship to it', async () => {
    // The regression: this returned 200 before, for every event in the company.
    const res = await get(getEvent, `/api/v1/events/${scopedEventId}`, outsiderCookie, { id: scopedEventId });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
  });

  it('shows an ORGANIZATION event to everyone', async () => {
    // The reason events could not simply be owner-scoped: the company calendar
    // has to stay visible to the company.
    const res = await get(getEvent, `/api/v1/events/${orgEventId}`, outsiderCookie, { id: orgEventId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('shows a scoped event to someone personally invited to it', async () => {
    const res = await get(getEvent, `/api/v1/events/${invitedEventId}`, inviteeCookie, { id: invitedEventId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('shows everything to an ORGANIZATION-scoped viewer', async () => {
    const res = await get(getEvent, `/api/v1/events/${scopedEventId}`, directorCookie, { id: scopedEventId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('filters the list by the same three rules', async () => {
    const outsiderList = await get(listEvents, '/api/v1/events', outsiderCookie);
    expect(outsiderList.status).toBe(200);
    const outsiderIds = (outsiderList.body as { data: { id: string }[] }).data.map((row) => row.id);
    expect(outsiderIds, 'the company-wide event is listed').toContain(orgEventId);
    expect(outsiderIds, 'somebody else’s scoped event is not').not.toContain(scopedEventId);

    const inviteeList = await get(listEvents, '/api/v1/events', inviteeCookie);
    const inviteeIds = (inviteeList.body as { data: { id: string }[] }).data.map((row) => row.id);
    expect(inviteeIds, 'the event they were invited to is listed').toContain(invitedEventId);
    expect(inviteeIds, 'an event they were not invited to is not').not.toContain(scopedEventId);
  });

  /**
   * The exemption is READ-ONLY. Being invited to something is not authority
   * over it, and neither is an event being published company-wide.
   */
  it('does not let an invitee edit the event they were invited to', async () => {
    const res = await patch(
      patchEvent,
      `/api/v1/events/${invitedEventId}`,
      { title: 'Renamed by an attendee' },
      inviteeCookie,
      { id: invitedEventId },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const unchanged = await prisma.event.findFirstOrThrow({ where: { id: invitedEventId, tenantId } });
    expect(unchanged.title).toBe('Scoped but invited');
  });

  it('does not let an invitee delete the event', async () => {
    const res = await del(deleteEvent, `/api/v1/events/${invitedEventId}`, inviteeCookie, { id: invitedEventId });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const alive = await prisma.event.findFirstOrThrow({ where: { id: invitedEventId, tenantId } });
    expect(alive.deletedAt).toBeNull();
  });

  it('does not let an invitee manage the invitee list', async () => {
    const res = await post(
      addInvitee,
      `/api/v1/events/${invitedEventId}/invitees`,
      { invitees: [{ name: 'Gatecrasher', email: `crasher-${suffix}@example.com` }] },
      inviteeCookie,
      { id: invitedEventId },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('does not let a company-wide event be edited by the whole company', async () => {
    const res = await patch(
      patchEvent,
      `/api/v1/events/${orgEventId}`,
      { title: 'Renamed by anyone' },
      outsiderCookie,
      { id: orgEventId },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it('still lets the host edit their own event', async () => {
    const res = await patch(patchEvent, `/api/v1/events/${scopedEventId}`, { title: 'Renamed by host' }, hostCookie, {
      id: scopedEventId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});
