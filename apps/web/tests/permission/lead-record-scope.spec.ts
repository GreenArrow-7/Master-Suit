import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as audience } from '@/app/api/v1/campaigns/[id]/audience/route';
import { PATCH as patchFollowUp } from '@/app/api/v1/follow-ups/[id]/route';
import { DELETE as deleteLead, GET as getLead, PATCH as patchLead } from '@/app/api/v1/leads/[id]/route';
import { POST as closeOut } from '@/app/api/v1/leads/[id]/close-out/route';
import { DELETE as removePhone, POST as addPhone } from '@/app/api/v1/leads/[id]/phones/route';
import { POST as convertEnquiry } from '@/app/api/v1/social-leads/[id]/convert/route';
import { DELETE as deleteTask, PATCH as patchTask } from '@/app/api/v1/tasks/[id]/route';
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
  const { stageId } = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: h.repA1.leadId } });
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
  },
  {
    name: 'DELETE tasks/{id}',
    make: task,
    send: (id: string, as: Member) => del(deleteTask, `/api/v1/tasks/${id}`, as.cookie),
    row: taskRow,
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
  },
];

describe.each(LEAD_WORK)('$name', ({ make, send, row }) => {
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
      const res = await send(await make(owner.id, owner.leadId), as);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
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
    expect((await change({ add: [h.repB1.leadId], remove: [h.repA2.leadId] }, h.director)).body).toEqual({
      added: 1,
      removed: 1,
    });
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
  const convert = async (body: Record<string, string>) =>
    post(
      convertEnquiry,
      `/api/v1/social-leads/${await enquiry()}/convert`,
      { fullName: 'Social Buyer', ...body },
      h.repA1.cookie,
    );

  it('links a teammate’s lead without handing back its id', async () => {
    const res = await convert({ phone: THEIR_PHONE });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ leadId: null, linkedToExisting: true, visible: false });
    expect(JSON.stringify(res.body)).not.toContain(h.repA2.leadId);
  });

  it('opens a match the caller may see', async () => {
    const res = await convert({ email: OWN_EMAIL });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ leadId: secondOwnLeadId, linkedToExisting: true, visible: true });
  });
});

describe('deleting', () => {
  it('takes the caller’s own lead', async () => {
    expect((await del(deleteLead, `/api/v1/leads/${h.repA1.leadId}`, h.repA1.cookie)).status).toBe(200);
  });
});
