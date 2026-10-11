import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// The screens read the session from the request's cookie, set per case.
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
import { PATCH as patchActivity } from '@/app/api/v1/activities/[id]/route';
import { POST as audience } from '@/app/api/v1/campaigns/[id]/audience/route';
import { GET as listCalls } from '@/app/api/v1/calls/route';
import { GET as readCall, PATCH as patchCall } from '@/app/api/v1/calls/[id]/route';
import { GET as readCoaching } from '@/app/api/v1/calls/[id]/coaching/route';
import { POST as recordConsent } from '@/app/api/v1/calls/[id]/consent/route';
import { POST as createCaptureLink } from '@/app/api/v1/capture-links/route';
import { PATCH as patchCaptureLink } from '@/app/api/v1/capture-links/[id]/route';
import { PATCH as patchColdRecord } from '@/app/api/v1/cold-data/[id]/route';
import { POST as assignColdList } from '@/app/api/v1/cold-data/assign/route';
import { GET as listEvents, POST as createEvent } from '@/app/api/v1/events/route';
import { DELETE as deleteEvent, GET as readEvent, PATCH as patchEvent } from '@/app/api/v1/events/[id]/route';
import { POST as queueEventCalls } from '@/app/api/v1/events/[id]/calls/route';
import { PATCH as patchFollowUp } from '@/app/api/v1/follow-ups/[id]/route';
import { POST as createLead } from '@/app/api/v1/leads/route';
import { POST as bulkAssign } from '@/app/api/v1/leads/assign/route';
import { DELETE as deleteLead, GET as getLead, PATCH as patchLead } from '@/app/api/v1/leads/[id]/route';
import { POST as closeOut } from '@/app/api/v1/leads/[id]/close-out/route';
import { DELETE as removePhone, POST as addPhone } from '@/app/api/v1/leads/[id]/phones/route';
import { POST as assignEnquiry } from '@/app/api/v1/social-leads/[id]/assign/route';
import { POST as convertEnquiry } from '@/app/api/v1/social-leads/[id]/convert/route';
import { POST as createTask } from '@/app/api/v1/tasks/route';
import { DELETE as deleteTask, PATCH as patchTask } from '@/app/api/v1/tasks/[id]/route';
import { POST as createWorkspaceLead } from '@/app/api/v1/workspaces/[workspaceSlug]/sales/leads/route';
import CallAuditsPage from '@/app/(workspace)/[workspaceSlug]/sales/call-audits/page';
import CallPage from '@/app/(workspace)/[workspaceSlug]/sales/calls/[id]/page';
import LiveCallPage from '@/app/(workspace)/[workspaceSlug]/sales/calls/[id]/live/page';
import EventsPage from '@/app/(workspace)/[workspaceSlug]/sales/events/page';
import EventPage from '@/app/(workspace)/[workspaceSlug]/sales/events/[id]/page';
import { createWorkspaceUser, grantPermissions, seedHierarchy, type Hierarchy, type Member } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { del, get, patch, post } from '../helpers/request';

/**
 * A lead's own by-id routes under the lead's rule. GET already answered 404 for
 * a lead outside the caller's scope; the writes beside it (PATCH, DELETE,
 * close-out, phones) answered 403, which told the caller the id was real. All
 * of them now answer exactly as a lead that does not exist, and a close-out's
 * `duplicateOfId` may name only a lead the caller may see. The lead work hung
 * on a lead (tasks, follow-ups) and the Sales routes that take lead ids
 * (campaign audience, social-lead conversion) follow the same rule, below.
 */
let h: Hierarchy;
let secondOwnLeadId: string;
let theirPhoneId: string;
let typeId: string;
let campaignId: string;
/** Sees every task (`tasks:VIEW` at ORGANIZATION) but edits only its own leads. */
let taskDesk: Member;
/** Holds `campaigns:EDIT` and no `leads` grant. */
let mailer: Member;
let poolLeadId: string;
let slug: string;
let stageId: string;
let activityTypeId: string;
const MISSING = `c${'0'.repeat(24)}`;
const THEIR_PHONE = '+971509990001';
const OWN_EMAIL = `repa1.second.${randomBytes(4).toString('hex')}@hierarchy.test`;

/** Every by-id route, as the OWN-scope rep `as` sends it. */
const BY_ID = [
  { name: 'GET', send: (id: string, as: string) => get(getLead, `/api/v1/leads/${id}`, as) },
  {
    name: 'PATCH',
    send: (id: string, as: string) => patch(patchLead, `/api/v1/leads/${id}`, { fullName: 'Taken' }, as),
  },
  { name: 'DELETE', send: (id: string, as: string) => del(deleteLead, `/api/v1/leads/${id}`, as) },
  {
    name: 'close-out',
    send: (id: string, as: string) => post(closeOut, `/api/v1/leads/${id}/close-out`, { status: 'ARCHIVED' }, as),
  },
  {
    name: 'adding a phone',
    send: (id: string, as: string) => post(addPhone, `/api/v1/leads/${id}/phones`, { phone: '+971500000002' }, as),
  },
  {
    name: 'removing a phone',
    send: (id: string, as: string) => del(removePhone, `/api/v1/leads/${id}/phones?phoneId=${theirPhoneId}`, as),
  },
];

beforeAll(async () => {
  h = await seedHierarchy();
  const { tenantId } = h;
  ({ stageId } = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: h.repA1.leadId } }));
  secondOwnLeadId = (
    await prisma.lead.create({
      data: {
        tenantId,
        reference: 'REPA1-SECOND',
        fullName: 'repA1 second lead',
        email: OWN_EMAIL,
        stageId,
        ownerId: h.repA1.id,
      },
    })
  ).id;
  theirPhoneId = (
    await prisma.leadPhone.create({
      data: { tenantId, leadId: h.repA2.leadId, raw: '0509990001', normalized: THEIR_PHONE },
    })
  ).id;

  // The fixture's roles hold only `leads`; a task is read under `tasks`.
  const roleOf = async (userId: string) =>
    (await prisma.user.findFirstOrThrow({ where: { tenantId, id: userId }, select: { roleId: true } })).roleId;
  const work = [
    ['tasks', 'VIEW'],
    ['tasks', 'DELETE'],
    ['campaigns', 'EDIT'],
  ] as const;
  await grantPermissions(tenantId, await roleOf(h.repA1.id), work, 'OWN');
  await grantPermissions(tenantId, await roleOf(h.teamManagerA.id), work, 'TEAM');
  await grantPermissions(tenantId, await roleOf(h.director.id), work, 'ORGANIZATION');
  // Events and calls mirror each role's `leads`, as the seed grants them; reps
  // hold no ASSIGN.
  const calendar = (['events', 'calls'] as const).flatMap((module) =>
    (['VIEW', 'CREATE', 'EDIT', 'DELETE', 'ASSIGN'] as const).map((action) => [module, action] as const),
  );
  const unassigning = calendar.filter(([, action]) => action !== 'ASSIGN');
  await grantPermissions(tenantId, await roleOf(h.repA1.id), unassigning, 'OWN');
  await grantPermissions(tenantId, await roleOf(h.teamManagerA.id), calendar, 'TEAM');
  await grantPermissions(tenantId, await roleOf(h.director.id), calendar, 'ORGANIZATION');
  slug = (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } })).slug;
  activityTypeId = (await prisma.activityType.create({ data: { tenantId, key: 'call', name: 'Call' } })).id;
  typeId = (await prisma.taskType.create({ data: { tenantId, key: 'call', name: 'Call' } })).id;
  campaignId = (
    await prisma.campaign.create({
      data: { tenantId, name: 'Spring launch', code: 'SPRING', campaignType: 'WHATSAPP' },
    })
  ).id;

  const deskRole = await prisma.role.create({
    data: { tenantId, key: `task-desk-${randomBytes(4).toString('hex')}`, name: 'Task desk', rank: 60 },
  });
  await grantPermissions(
    tenantId,
    deskRole.id,
    [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
    ],
    'OWN',
  );
  await grantPermissions(tenantId, deskRole.id, [['tasks', 'VIEW']], 'ORGANIZATION');
  const desk = await createWorkspaceUser({
    tenantId,
    roleId: deskRole.id,
    email: `task-desk-${randomBytes(4).toString('hex')}@hierarchy.test`,
    fullName: 'Task desk',
  });
  taskDesk = { id: desk.id, cookie: await createSessionToken(tenantId, desk.id), leadId: '' };

  const mailerRole = await prisma.role.create({
    data: { tenantId, key: `mailer-${randomBytes(4).toString('hex')}`, name: 'Mailer', rank: 60 },
  });
  await grantPermissions(tenantId, mailerRole.id, [['campaigns', 'EDIT']], 'ORGANIZATION');
  const mailerUser = await createWorkspaceUser({
    tenantId,
    roleId: mailerRole.id,
    email: `mailer-${randomBytes(4).toString('hex')}@hierarchy.test`,
    fullName: 'Mailer',
  });
  mailer = { id: mailerUser.id, cookie: await createSessionToken(tenantId, mailerUser.id), leadId: '' };
  poolLeadId = (
    await prisma.lead.create({ data: { tenantId, reference: 'POOL-AUDIENCE', fullName: 'Pool lead', stageId } })
  ).id;
}, 60_000);
afterAll(async () => {
  await h?.cleanup();
});

describe.each(BY_ID)('$name', ({ send }) => {
  it('answers a teammate’s lead exactly as a lead that does not exist', async () => {
    const theirs = await send(h.repA2.leadId, h.repA1.cookie);
    const missing = await send(MISSING, h.repA1.cookie);
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(theirs.body.detail).toBe(missing.body.detail);
  });
});

describe('the refusals', () => {
  it('left the teammate’s lead as it was', async () => {
    const where = { tenantId: h.tenantId, id: h.repA2.leadId };
    const lead = await prisma.lead.findFirstOrThrow({
      where,
      select: { fullName: true, deletedAt: true, status: true },
    });
    expect(lead).toEqual({ fullName: 'repA2 lead', deletedAt: null, status: null });
    expect(await prisma.leadPhone.count({ where: { tenantId: h.tenantId, leadId: h.repA2.leadId } })).toBe(1);
  });
});

describe('the caller’s own lead', () => {
  it('takes every route', async () => {
    const { leadId, cookie } = h.repA1;
    expect((await get(getLead, `/api/v1/leads/${leadId}`, cookie)).status).toBe(200);
    expect((await patch(patchLead, `/api/v1/leads/${leadId}`, { fullName: 'Mine' }, cookie)).status).toBe(200);
    const phone = await post(addPhone, `/api/v1/leads/${leadId}/phones`, { phone: '+971500000003' }, cookie);
    expect(phone.status, JSON.stringify(phone.body)).toBe(200);
    const removed = await del(removePhone, `/api/v1/leads/${leadId}/phones?phoneId=${phone.body.id}`, cookie);
    expect(removed.status).toBe(200);
    const closeOutAs = (status: string) => post(closeOut, `/api/v1/leads/${leadId}/close-out`, { status }, cookie);
    expect((await closeOutAs('ARCHIVED')).status).toBe(200);
    expect((await closeOutAs('OPEN')).status).toBe(200);
  });
});

describe('a team manager', () => {
  it('edits the team’s leads, descendant team included, and not another team’s', async () => {
    const edit = (leadId: string) =>
      patch(patchLead, `/api/v1/leads/${leadId}`, { fullName: 'Coached' }, h.teamManagerA.cookie);
    expect((await edit(h.repA1.leadId)).status).toBe(200);
    expect((await edit(h.repSubTeam.leadId)).status).toBe(200);
    const other = await edit(h.repB1.leadId);
    expect(other.status).toBe(404);
    expect(other.body.detail).toBe('Lead not found.');
    expect((await del(deleteLead, `/api/v1/leads/${h.repB1.leadId}`, h.teamManagerA.cookie)).status).toBe(404);
  });
});

describe('the director', () => {
  it('reaches a lead in another region', async () => {
    const { leadId } = h.repOtherRegion;
    expect((await get(getLead, `/api/v1/leads/${leadId}`, h.director.cookie)).status).toBe(200);
    expect((await patch(patchLead, `/api/v1/leads/${leadId}`, { fullName: 'Seen' }, h.director.cookie)).status).toBe(
      200,
    );
  });
});

describe('closing out as a duplicate', () => {
  it('names only a lead the caller may see as the original', async () => {
    const { leadId, cookie } = h.repA1;
    const dup = (duplicateOfId: string) =>
      post(closeOut, `/api/v1/leads/${leadId}/close-out`, { status: 'DUPLICATE', duplicateOfId }, cookie);
    const theirs = await dup(h.repA2.leadId);
    expect(theirs.status).toBe(404);
    expect(theirs.body.detail).toBe('Lead not found.');
    const row = await prisma.lead.findFirstOrThrow({
      where: { tenantId: h.tenantId, id: leadId },
      select: { status: true, duplicateOfId: true },
    });
    expect(row).toEqual({ status: null, duplicateOfId: null });

    const own = await dup(secondOwnLeadId);
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body.duplicateOfId).toBe(secondOwnLeadId);
  });
});

/**
 * A task or follow-up by id, under its list's rule (M2-05). The task routes
 * checked only the tenant, so `leads:EDIT` changed, completed or took any task
 * in the workspace and `tasks:DELETE` deleted it; the follow-up PATCH treated
 * TEAM scope as the whole workspace. Follow-ups have no DELETE route.
 */
const dueAt = new Date(Date.now() + 86_400_000);
const task = async (ownerId: string | null, leadId: string | null) =>
  (await prisma.task.create({ data: { tenantId: h.tenantId, typeId, ownerId, leadId, title: 'Chase', dueAt } })).id;
const taskRow = (id: string) =>
  prisma.task.findFirst({
    where: { tenantId: h.tenantId, id },
    select: { title: true, status: true, ownerId: true, deletedAt: true },
  });
/** Every write the caller may try on someone's task or follow-up, taking it for themselves where it can. */
const LEAD_WORK = [
  {
    name: 'PATCH tasks/{id}',
    make: task,
    send: (id: string, as: Member) =>
      patch(patchTask, `/api/v1/tasks/${id}`, { title: 'Taken', status: 'COMPLETED', ownerId: as.id }, as.cookie),
    row: taskRow,
    done: async (id: string) => (await taskRow(id))?.title === 'Taken',
  },
  {
    name: 'DELETE tasks/{id}',
    make: task,
    send: (id: string, as: Member) => del(deleteTask, `/api/v1/tasks/${id}`, as.cookie),
    row: taskRow,
    done: async (id: string) =>
      (await prisma.task.count({ where: { tenantId: h.tenantId, id, deletedAt: { not: null } } })) === 1,
  },
  {
    name: 'PATCH follow-ups/{id}',
    make: async (ownerId: string, leadId: string) =>
      (await prisma.followUpTask.create({ data: { tenantId: h.tenantId, ownerId, leadId, title: 'Chase', dueAt } })).id,
    send: (id: string, as: Member) =>
      patch(
        patchFollowUp,
        `/api/v1/follow-ups/${id}`,
        { title: 'Taken', status: 'COMPLETED', ownerId: as.id },
        as.cookie,
      ),
    row: (id: string) =>
      prisma.followUpTask.findFirst({
        where: { tenantId: h.tenantId, id },
        select: { title: true, status: true, ownerId: true, completedAt: true },
      }),
    done: async (id: string) =>
      (await prisma.followUpTask.count({ where: { tenantId: h.tenantId, id, title: 'Taken' } })) === 1,
  },
];

describe.each(LEAD_WORK)('$name', ({ make, send, row, done }) => {
  it('a team manager: another team’s answers exactly as a missing id, and nothing changes', async () => {
    const elsewhere = await make(h.repB1.id, h.repB1.leadId);
    const before = await row(elsewhere);
    const refused = await send(elsewhere, h.teamManagerA);
    const missing = await send(MISSING, h.teamManagerA);
    expect(refused.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(refused.body.detail).toBe(missing.body.detail);
    expect(await row(elsewhere)).toEqual(before);
  });

  it('an own-scope agent: a teammate’s answers exactly as a missing id, and nothing changes', async () => {
    const theirs = await make(h.repA2.id, h.repA2.leadId);
    const before = await row(theirs);
    const refused = await send(theirs, h.repA1);
    const missing = await send(MISSING, h.repA1);
    expect(refused.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(refused.body.detail).toBe(missing.body.detail);
    expect(await row(theirs)).toEqual(before);
  });

  it('reaches the agent’s own, the team manager’s team’s, and anyone’s at organisation scope', async () => {
    for (const [owner, as] of [
      [h.repA1, h.repA1],
      [h.repA2, h.teamManagerA],
      [h.repSubTeam, h.teamManagerA],
      [h.repOtherRegion, h.director],
    ]) {
      const id = await make(owner.id, owner.leadId);
      const res = await send(id, as);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await done(id)).toBe(true);
    }
  });
});

describe('a task by id', () => {
  it('with no owner is reached only at organisation scope', async () => {
    const nobodys = await task(null, null);
    const takeIt = (as: Member) => patch(patchTask, `/api/v1/tasks/${nobodys}`, { ownerId: as.id }, as.cookie);
    expect((await takeIt(h.repA1)).status).toBe(404);
    expect((await takeIt(h.teamManagerA)).status).toBe(404);
    expect((await takeIt(h.director)).status).toBe(200);
  });

  it('is changed only where the caller both sees it and edits its owner’s leads', async () => {
    // Seeing every task does not stretch `leads:EDIT` at OWN, the route's own
    // action: the desk could otherwise take any task by naming itself owner.
    const theirs = await task(h.repA2.id, h.repA2.leadId);
    const before = await taskRow(theirs);
    const refused = await patch(patchTask, `/api/v1/tasks/${theirs}`, { ownerId: taskDesk.id }, taskDesk.cookie);
    expect(refused.status).toBe(404);
    expect(await taskRow(theirs)).toEqual(before);
    const own = await task(taskDesk.id, null);
    expect((await patch(patchTask, `/api/v1/tasks/${own}`, { status: 'COMPLETED' }, taskDesk.cookie)).status).toBe(200);
  });
});

describe('a campaign’s audience', () => {
  const change = (body: Record<string, string[]>, as: Member) =>
    post(audience, `/api/v1/campaigns/${campaignId}/audience`, body, as.cookie);
  const onCampaign = async (leadId: string) =>
    (await prisma.lead.findFirstOrThrow({ where: { tenantId: h.tenantId, id: leadId }, select: { campaignId: true } }))
      .campaignId === campaignId;

  it('takes and drops only the leads the caller may see', async () => {
    const added = await change({ add: [h.repA1.leadId, h.repA2.leadId, MISSING] }, h.repA1);
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect(added.body).toEqual({ added: 1, removed: 0 });
    expect(await onCampaign(h.repA1.leadId)).toBe(true);
    expect(await onCampaign(h.repA2.leadId)).toBe(false);

    await prisma.lead.update({ where: { tenantId: h.tenantId, id: h.repA2.leadId }, data: { campaignId } });
    expect((await change({ remove: [h.repA2.leadId] }, h.repA1)).body).toEqual({ added: 0, removed: 0 });
    expect(await onCampaign(h.repA2.leadId)).toBe(true);
  });

  it('a team manager reaches the team’s leads and not another team’s; the director any', async () => {
    expect((await change({ add: [h.repSubTeam.leadId, h.repB1.leadId] }, h.teamManagerA)).body).toEqual({
      added: 1,
      removed: 0,
    });
    expect(await onCampaign(h.repB1.leadId)).toBe(false);
    await prisma.lead.update({ where: { tenantId: h.tenantId, id: h.repA2.leadId }, data: { campaignId } });
    expect((await change({ add: [h.repB1.leadId], remove: [h.repA2.leadId] }, h.director)).body).toEqual({
      added: 1,
      removed: 1,
    });
    expect(await onCampaign(h.repB1.leadId)).toBe(true);
    expect(await onCampaign(h.repA2.leadId)).toBe(false);
  });

  it('takes an unassigned lead only for someone who may assign it', async () => {
    expect((await change({ add: [poolLeadId] }, h.repA1)).body).toEqual({ added: 0, removed: 0 });
    expect(await onCampaign(poolLeadId)).toBe(false);
    expect((await change({ add: [poolLeadId] }, h.teamManagerA)).body).toEqual({ added: 1, removed: 0 });
    expect(await onCampaign(poolLeadId)).toBe(true);
  });

  it('refuses a campaign editor who may see no leads at all, and moves nothing', async () => {
    await prisma.lead.update({ where: { tenantId: h.tenantId, id: h.repA2.leadId }, data: { campaignId } });
    expect((await change({ add: [h.repB1.leadId], remove: [h.repA2.leadId] }, mailer)).status).toBe(403);
    expect(await onCampaign(h.repA2.leadId)).toBe(true);
  });
});

describe('converting a social enquiry', () => {
  const enquiry = async () =>
    (
      await prisma.socialComment.create({
        data: {
          tenantId: h.tenantId,
          provider: 'facebook',
          providerCommentId: randomBytes(8).toString('hex'),
          authorName: 'commenter',
          commentText: 'Price for the 2-bed?',
          commentCreatedAt: new Date(),
          ownerId: h.repA1.id,
        },
      })
    ).id;
  const convert = async (body: Record<string, string>, id?: string) =>
    post(
      convertEnquiry,
      `/api/v1/social-leads/${id ?? (await enquiry())}/convert`,
      { fullName: 'Social Buyer', ...body },
      h.repA1.cookie,
    );

  it('links a teammate’s lead without handing back its id or reference', async () => {
    const id = await enquiry();
    const res = await convert({ phone: THEIR_PHONE }, id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ leadId: null, reference: null, linkedToExisting: true, visible: false });
    const linked = await prisma.socialComment.findFirstOrThrow({ where: { tenantId: h.tenantId, id } });
    expect(linked).toMatchObject({ linkedLeadId: h.repA2.leadId, status: 'CONVERTED' });
  });

  it('keeps a new lead with the enquiry’s owner when the caller may not assign', async () => {
    const res = await convert({
      fullName: `Fresh ${Date.now()}`,
      phone: `+97155${String(Date.now()).slice(-7)}`,
      ownerId: h.repA2.id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ linkedToExisting: false });
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId: h.tenantId, id: res.body.leadId } });
    expect(lead.ownerId).toBe(h.repA1.id);
  });

  it('opens a match the caller may see', async () => {
    const res = await convert({ email: OWN_EMAIL });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ leadId: secondOwnLeadId, linkedToExisting: true, visible: true });
  });
});

/**
 * Events and calls under one rule, lists and by id: TEAM, BRANCH and REGION
 * scope are the caller's resolved owners. The by-id guards returned early from
 * TEAM up, so a team manager read and changed every event and call in the
 * workspace by quoting its id; the call page loaded by id and workspace only.
 */
const startAt = new Date(Date.now() + 86_400_000);
const anEvent = async (hostId: string) =>
  (
    await prisma.event.create({
      data: { tenantId: h.tenantId, title: 'Launch evening', startAt, endAt: startAt, hostId, createdById: hostId },
    })
  ).id;
const aCall = async (callerId: string) => (await prisma.call.create({ data: { tenantId: h.tenantId, callerId } })).id;
const eventRow = (id: string) =>
  prisma.event.findFirst({ where: { tenantId: h.tenantId, id }, select: { title: true, deletedAt: true } });
const callRow = (id: string) =>
  prisma.call.findFirst({
    where: { tenantId: h.tenantId, id },
    select: { notes: true, deletedAt: true, consent: { select: { id: true } } },
  });
/** Logged by `ownerId` on a lead nobody owns: only who logged it places it. */
const anActivity = async (ownerId: string) =>
  (
    await prisma.activity.create({
      data: { tenantId: h.tenantId, typeId: activityTypeId, leadId: poolLeadId, ownerId, notes: 'Called' },
    })
  ).id;
const activityRow = (id: string) =>
  prisma.activity.findFirst({ where: { tenantId: h.tenantId, id }, select: { notes: true, deletedAt: true } });
const TEAM_RECORDS = [
  {
    name: 'PATCH activities/{id}',
    make: anActivity,
    send: (id: string, as: Member) => patch(patchActivity, `/api/v1/activities/${id}`, { notes: 'Taken' }, as.cookie),
    row: activityRow,
  },
  {
    name: 'GET events/{id}',
    make: anEvent,
    send: (id: string, as: Member) => get(readEvent, `/api/v1/events/${id}`, as.cookie),
    row: eventRow,
  },
  {
    name: 'PATCH events/{id}',
    make: anEvent,
    send: (id: string, as: Member) => patch(patchEvent, `/api/v1/events/${id}`, { title: 'Taken' }, as.cookie),
    row: eventRow,
  },
  {
    name: 'DELETE events/{id}',
    make: anEvent,
    send: (id: string, as: Member) => del(deleteEvent, `/api/v1/events/${id}`, as.cookie),
    row: eventRow,
  },
  {
    name: 'GET calls/{id}',
    make: aCall,
    send: (id: string, as: Member) => get(readCall, `/api/v1/calls/${id}`, as.cookie),
    row: callRow,
  },
  {
    name: 'PATCH calls/{id}',
    make: aCall,
    send: (id: string, as: Member) => patch(patchCall, `/api/v1/calls/${id}`, { notes: 'Taken' }, as.cookie),
    row: callRow,
  },
  {
    name: 'POST calls/{id}/consent',
    make: aCall,
    send: (id: string, as: Member) =>
      post(recordConsent, `/api/v1/calls/${id}/consent`, { consentGiven: true, method: 'VERBAL' }, as.cookie),
    row: callRow,
  },
  {
    name: 'GET calls/{id}/coaching',
    make: aCall,
    send: (id: string, as: Member) => get(readCoaching, `/api/v1/calls/${id}/coaching`, as.cookie),
    row: callRow,
  },
];

describe.each(TEAM_RECORDS)('$name', ({ make, send, row }) => {
  it('a team manager: another team’s answers exactly as a missing id, and nothing changes', async () => {
    const elsewhere = await make(h.repB1.id);
    const before = await row(elsewhere);
    const refused = await send(elsewhere, h.teamManagerA);
    const missing = await send(MISSING, h.teamManagerA);
    expect(refused.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(refused.body.detail).toBe(missing.body.detail);
    expect(await row(elsewhere)).toEqual(before);
  });

  it('a team manager reaches the team’s, the director another region’s', async () => {
    for (const [owner, as] of [
      [h.repA2, h.teamManagerA],
      [h.repSubTeam, h.teamManagerA],
      [h.repOtherRegion, h.director],
    ]) {
      const res = await send(await make(owner.id), as);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
  });
});

/** Every element a server component hands back, depth first. */
const elements = (node: unknown): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...elements(el.props.children)];
};
const hrefs = (node: unknown) =>
  elements(node)
    .map((el) => el.props.href)
    .filter((href): href is string => typeof href === 'string');

describe('the lists and screens of events and calls', () => {
  const ids = (res: { body: { data: { id: string }[] } }) => res.body.data.map((row) => row.id);

  it('the events and calls lists name the team’s and not another team’s; the director’s both', async () => {
    const [ours, theirs] = [await anEvent(h.repA2.id), await anEvent(h.repB1.id)];
    const [ourCall, theirCall] = [await aCall(h.repA2.id), await aCall(h.repB1.id)];
    const events = ids(await get(listEvents, '/api/v1/events', h.teamManagerA.cookie));
    const calls = ids(await get(listCalls, '/api/v1/calls?limit=200', h.teamManagerA.cookie));
    expect(events).toContain(ours);
    expect(events).not.toContain(theirs);
    expect(calls).toContain(ourCall);
    expect(calls).not.toContain(theirCall);
    expect(ids(await get(listEvents, '/api/v1/events', h.director.cookie))).toEqual(
      expect.arrayContaining([ours, theirs]),
    );
    expect(ids(await get(listCalls, '/api/v1/calls?limit=200', h.director.cookie))).toEqual(
      expect.arrayContaining([ourCall, theirCall]),
    );
  });

  it('the Events page and the call audits list the team’s only', async () => {
    const [ours, theirs] = [await anEvent(h.repA2.id), await anEvent(h.repB1.id)];
    const [ourCall, theirCall] = [await aCall(h.repA2.id), await aCall(h.repB1.id)];
    await prisma.callAudit.createMany({
      data: [ourCall, theirCall].map((callId) => ({ tenantId: h.tenantId, callId, scorecardId: 'scorecard' })),
    });
    cookieJar.value = h.teamManagerA.cookie;
    const listed = hrefs(await EventsPage({ searchParams: Promise.resolve({}) }));
    expect(listed).toContain(`/events/${ours}`);
    expect(listed).not.toContain(`/events/${theirs}`);
    const audited = hrefs(await CallAuditsPage());
    expect(audited).toContain(`/calls/${ourCall}`);
    expect(audited).not.toContain(`/calls/${theirCall}`);
  });

  it('a call’s page, its live page and an event’s page: another team’s is not found, the team’s opens', async () => {
    cookieJar.value = h.teamManagerA.cookie;
    const openCall = (id: string) => CallPage({ params: Promise.resolve({ id }) });
    const openLive = (id: string) => LiveCallPage({ params: Promise.resolve({ workspaceSlug: slug, id }) });
    const openEvent = (id: string) => EventPage({ params: Promise.resolve({ id }) });
    for (const open of [openCall, openLive]) {
      await expect(open(await aCall(h.repB1.id))).rejects.toThrow(/;404$/);
      await expect(open(await aCall(h.repA2.id))).resolves.toBeTruthy();
    }
    await expect(openEvent(await anEvent(h.repB1.id))).rejects.toThrow(/;404$/);
    await expect(openEvent(await anEvent(h.repA2.id))).resolves.toBeTruthy();
  });
});

/**
 * Handing work to someone: the person must be an active member inside the
 * caller's own scope for the assignment (the module's ASSIGN). From TEAM up,
 * these took any active user in the workspace; a few took anyone at all. Out of
 * scope answers as an unknown user does, and nothing lands.
 */
let handed = 0;
const fresh = () => `${Date.now()}-${(handed += 1)}`;
type Handing = { res: { status: number; body: any }; landed: () => Promise<boolean> };
const ownedBy = (count: Promise<number>) => count.then((n) => n === 1);
const freshLead = async (ownerId: string) =>
  (
    await prisma.lead.create({
      data: { tenantId: h.tenantId, reference: `HAND-${fresh()}`, fullName: 'Handed lead', stageId, ownerId },
    })
  ).id;
const enquiryOf = async (ownerId: string) =>
  (
    await prisma.socialComment.create({
      data: {
        tenantId: h.tenantId,
        provider: 'facebook',
        providerCommentId: randomBytes(8).toString('hex'),
        authorName: 'commenter',
        commentText: 'Price?',
        commentCreatedAt: new Date(),
        ownerId,
      },
    })
  ).id;
const coldRecordOf = (ownerId: string) =>
  prisma.dataRecord.create({ data: { tenantId: h.tenantId, fullName: 'Cold', batch: `list-${fresh()}`, ownerId } });
const HANDING: { name: string; refusal?: number; hand: (as: Member, to: string) => Promise<Handing> }[] = [
  {
    name: 'POST tasks',
    hand: async (as, to) => {
      const title = `Handed ${fresh()}`;
      const res = await post(createTask, '/api/v1/tasks', { typeId, title, ownerId: to, dueAt }, as.cookie);
      return { res, landed: () => ownedBy(prisma.task.count({ where: { tenantId: h.tenantId, title, ownerId: to } })) };
    },
  },
  {
    name: 'PATCH tasks/{id}',
    hand: async (as, to) => {
      const id = await task(as.id, null);
      const res = await patch(patchTask, `/api/v1/tasks/${id}`, { ownerId: to }, as.cookie);
      return { res, landed: async () => (await taskRow(id))?.ownerId === to };
    },
  },
  {
    name: 'PATCH follow-ups/{id}',
    hand: async (as, to) => {
      const { id } = await prisma.followUpTask.create({
        data: { tenantId: h.tenantId, ownerId: as.id, title: 'Chase', dueAt },
      });
      const res = await patch(patchFollowUp, `/api/v1/follow-ups/${id}`, { ownerId: to }, as.cookie);
      return {
        res,
        landed: () => ownedBy(prisma.followUpTask.count({ where: { tenantId: h.tenantId, id, ownerId: to } })),
      };
    },
  },
  {
    name: 'POST leads',
    hand: async (as, to) => {
      const fullName = `Handed ${fresh()}`;
      const res = await post(createLead, '/api/v1/leads', { fullName, ownerId: to }, as.cookie);
      return {
        res,
        landed: () => ownedBy(prisma.lead.count({ where: { tenantId: h.tenantId, fullName, ownerId: to } })),
      };
    },
  },
  {
    name: 'PATCH leads/{id}',
    hand: async (as, to) => {
      const id = await freshLead(as.id);
      const res = await patch(patchLead, `/api/v1/leads/${id}`, { ownerId: to }, as.cookie);
      return { res, landed: () => ownedBy(prisma.lead.count({ where: { tenantId: h.tenantId, id, ownerId: to } })) };
    },
  },
  {
    name: 'POST leads/assign',
    hand: async (as, to) => {
      const id = await freshLead(as.id);
      const res = await post(bulkAssign, '/api/v1/leads/assign', { leadIds: [id], ownerId: to }, as.cookie);
      return { res, landed: () => ownedBy(prisma.lead.count({ where: { tenantId: h.tenantId, id, ownerId: to } })) };
    },
  },
  {
    name: 'POST workspaces/{slug}/sales/leads',
    hand: async (as, to) => {
      const fullName = `Handed ${fresh()}`;
      const res = await post(
        createWorkspaceLead,
        `/api/v1/workspaces/${slug}/sales/leads`,
        { fullName, ownerId: to },
        as.cookie,
        { workspaceSlug: slug },
      );
      return {
        res,
        landed: () => ownedBy(prisma.lead.count({ where: { tenantId: h.tenantId, fullName, ownerId: to } })),
      };
    },
  },
  {
    name: 'POST capture-links',
    hand: async (as, to) => {
      const label = `Stand ${fresh()}`;
      const res = await post(createCaptureLink, '/api/v1/capture-links', { label, ownerId: to }, as.cookie);
      return {
        res,
        landed: () => ownedBy(prisma.captureLink.count({ where: { tenantId: h.tenantId, label, ownerId: to } })),
      };
    },
  },
  {
    name: 'PATCH capture-links/{id}',
    hand: async (as, to) => {
      const { id } = await prisma.captureLink.create({
        data: { tenantId: h.tenantId, key: `stand-${fresh()}`, label: 'Stand', ownerId: as.id },
      });
      const res = await patch(patchCaptureLink, `/api/v1/capture-links/${id}`, { ownerId: to }, as.cookie);
      return {
        res,
        landed: () => ownedBy(prisma.captureLink.count({ where: { tenantId: h.tenantId, id, ownerId: to } })),
      };
    },
  },
  {
    name: 'PATCH cold-data/{id}',
    hand: async (as, to) => {
      const { id } = await coldRecordOf(as.id);
      const res = await patch(patchColdRecord, `/api/v1/cold-data/${id}`, { ownerId: to }, as.cookie);
      return {
        res,
        landed: () => ownedBy(prisma.dataRecord.count({ where: { tenantId: h.tenantId, id, ownerId: to } })),
      };
    },
  },
  {
    name: 'POST cold-data/assign',
    hand: async (as, to) => {
      const { id, batch } = await coldRecordOf(as.id);
      const res = await post(assignColdList, '/api/v1/cold-data/assign', { batch, ownerId: to }, as.cookie);
      return {
        res,
        landed: () => ownedBy(prisma.dataRecord.count({ where: { tenantId: h.tenantId, id, ownerId: to } })),
      };
    },
  },
  {
    name: 'POST social-leads/{id}/assign',
    hand: async (as, to) => {
      const id = await enquiryOf(as.id);
      const res = await post(assignEnquiry, `/api/v1/social-leads/${id}/assign`, { toUserId: to }, as.cookie);
      return {
        res,
        landed: () => ownedBy(prisma.socialComment.count({ where: { tenantId: h.tenantId, id, ownerId: to } })),
      };
    },
  },
  {
    name: 'POST social-leads/{id}/convert',
    hand: async (as, to) => {
      const fullName = `Social ${fresh()}`;
      // Leads are unique by phone in a workspace, and this one is new.
      const phone = `+97158${String(handed).padStart(7, '0')}`;
      const res = await post(
        convertEnquiry,
        `/api/v1/social-leads/${await enquiryOf(as.id)}/convert`,
        { fullName, phone, ownerId: to },
        as.cookie,
      );
      return {
        res,
        landed: () => ownedBy(prisma.lead.count({ where: { tenantId: h.tenantId, fullName, ownerId: to } })),
      };
    },
  },
  {
    name: 'POST events (its host)',
    hand: async (as, to) => {
      const title = `Launch ${fresh()}`;
      const endAt = new Date(startAt.getTime() + 3_600_000);
      const res = await post(createEvent, '/api/v1/events', { title, startAt, endAt, hostId: to }, as.cookie);
      return { res, landed: () => ownedBy(prisma.event.count({ where: { tenantId: h.tenantId, title, hostId: to } })) };
    },
  },
  {
    name: 'POST events/{id}/calls (its callers)',
    refusal: 422,
    hand: async (as, to) => {
      const eventId = await anEvent(as.id);
      await prisma.eventInvitee.create({
        data: { tenantId: h.tenantId, eventId, name: 'Guest', phone: `+97150${String(Date.now()).slice(-7)}` },
      });
      const res = await post(queueEventCalls, `/api/v1/events/${eventId}/calls`, { callerIds: [to] }, as.cookie);
      return {
        res,
        landed: () => ownedBy(prisma.call.count({ where: { tenantId: h.tenantId, eventId, callerId: to } })),
      };
    },
  },
];

describe.each(HANDING)('handing work: $name', ({ hand, refusal = 404 }) => {
  it('a team manager: someone in another team answers as an unknown user, and nothing lands', async () => {
    const theirs = await hand(h.teamManagerA, h.repB1.id);
    const unknown = await hand(h.teamManagerA, MISSING);
    expect(theirs.res.status, JSON.stringify(theirs.res.body)).toBe(refusal);
    expect(unknown.res.status).toBe(refusal);
    expect(theirs.res.body.detail).toBe(unknown.res.body.detail);
    expect(await theirs.landed()).toBe(false);
  });

  it('a team manager hands to the team; the director to either team', async () => {
    for (const [as, to] of [
      [h.teamManagerA, h.repA2],
      [h.director, h.repB1],
      [h.director, h.repA2],
    ]) {
      const handing = await hand(as, to.id);
      expect(handing.res.status, JSON.stringify(handing.res.body)).toBe(200);
      expect(await handing.landed()).toBe(true);
    }
  });

  it('an own-scope agent cannot hand it to a teammate', async () => {
    const handing = await hand(h.repA1, h.repA2.id);
    expect(handing.res.status).toBeLessThan(500);
    expect(await handing.landed()).toBe(false);
  });
});

describe('deleting', () => {
  it('takes the caller’s own lead', async () => {
    expect((await del(deleteLead, `/api/v1/leads/${h.repA1.leadId}`, h.repA1.cookie)).status).toBe(200);
  });
});
