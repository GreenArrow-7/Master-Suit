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
import { DELETE as deleteCall, GET as readCall, PATCH as patchCall } from '@/app/api/v1/calls/[id]/route';
import {
  GET as readAnalysis,
  PATCH as editAnalysis,
  POST as runAnalysis,
} from '@/app/api/v1/calls/[id]/analysis/route';
import {
  DELETE as deleteAudit,
  GET as readAudit,
  PATCH as reviewAudit,
  POST as runAudit,
} from '@/app/api/v1/calls/[id]/audit/route';
import { POST as coachCall } from '@/app/api/v1/calls/[id]/coach/route';
import {
  GET as readCoaching,
  PATCH as resolveCoaching,
  POST as writeCoaching,
} from '@/app/api/v1/calls/[id]/coaching/route';
import { DELETE as withdrawConsent, POST as recordConsent } from '@/app/api/v1/calls/[id]/consent/route';
import { POST as dialCall } from '@/app/api/v1/calls/[id]/dial/route';
import { POST as draftEmail, PUT as sendEmail } from '@/app/api/v1/calls/[id]/follow-up-email/route';
import { POST as draftWhatsApp } from '@/app/api/v1/calls/[id]/follow-up-whatsapp/route';
import { GET as liveCall } from '@/app/api/v1/calls/[id]/live/route';
import { POST as liveAudio } from '@/app/api/v1/calls/[id]/live-audio/route';
import { GET as readRecording, POST as storeRecording } from '@/app/api/v1/calls/[id]/recording/route';
import { GET as playRecording, PUT as uploadRecording } from '@/app/api/v1/calls/[id]/recording/media/route';
import { POST as applyTemperature } from '@/app/api/v1/calls/[id]/temperature/route';
import { GET as readTranscript, POST as storeTranscript } from '@/app/api/v1/calls/[id]/transcript/route';
import { POST as createCaptureLink } from '@/app/api/v1/capture-links/route';
import { PATCH as patchCaptureLink } from '@/app/api/v1/capture-links/[id]/route';
import { PATCH as patchColdRecord } from '@/app/api/v1/cold-data/[id]/route';
import { POST as assignColdList } from '@/app/api/v1/cold-data/assign/route';
import { GET as listEvents, POST as createEvent } from '@/app/api/v1/events/route';
import { DELETE as deleteEvent, GET as readEvent, PATCH as patchEvent } from '@/app/api/v1/events/[id]/route';
import { POST as queueEventCalls } from '@/app/api/v1/events/[id]/calls/route';
import { GET as listFollowUps } from '@/app/api/v1/follow-ups/route';
import { PATCH as patchFollowUp } from '@/app/api/v1/follow-ups/[id]/route';
import { GET as listLeads, POST as createLead } from '@/app/api/v1/leads/route';
import { POST as bulkAssign } from '@/app/api/v1/leads/assign/route';
import { DELETE as deleteLead, GET as getLead, PATCH as patchLead } from '@/app/api/v1/leads/[id]/route';
import { POST as closeOut } from '@/app/api/v1/leads/[id]/close-out/route';
import { DELETE as removePhone, POST as addPhone } from '@/app/api/v1/leads/[id]/phones/route';
import { POST as assignEnquiry } from '@/app/api/v1/social-leads/[id]/assign/route';
import { POST as convertEnquiry } from '@/app/api/v1/social-leads/[id]/convert/route';
import { GET as listTasks, POST as createTask } from '@/app/api/v1/tasks/route';
import { DELETE as deleteTask, PATCH as patchTask } from '@/app/api/v1/tasks/[id]/route';
import { POST as createWorkspaceLead } from '@/app/api/v1/workspaces/[workspaceSlug]/sales/leads/route';
import DashboardPage from '@/app/(workspace)/[workspaceSlug]/dashboard/page';
import CalendarPage from '@/app/(workspace)/[workspaceSlug]/sales/calendar/page';
import CallAuditsPage from '@/app/(workspace)/[workspaceSlug]/sales/call-audits/page';
import CallActions from '@/app/(workspace)/[workspaceSlug]/sales/calls/[id]/CallActions';
import CoachingNotes from '@/app/(workspace)/[workspaceSlug]/sales/calls/[id]/CoachingNotes';
import CallPage from '@/app/(workspace)/[workspaceSlug]/sales/calls/[id]/page';
import LiveCallPage from '@/app/(workspace)/[workspaceSlug]/sales/calls/[id]/live/page';
import EventsPage from '@/app/(workspace)/[workspaceSlug]/sales/events/page';
import EventPage from '@/app/(workspace)/[workspaceSlug]/sales/events/[id]/page';
import FollowUpsPage from '@/app/(workspace)/[workspaceSlug]/sales/follow-ups/page';
import TasksPage from '@/app/(workspace)/[workspaceSlug]/sales/tasks/page';
import TaskRowActions from '@/app/(workspace)/[workspaceSlug]/sales/tasks/TaskRowActions';
import RowDetails from '@/components/workspace/RowDetails';
import SalesHomePage from '@/app/(workspace)/[workspaceSlug]/sales/page';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import { entityRoute } from '@/lib/nav/entityRoute';
import LeadGrid from '@/app/(workspace)/[workspaceSlug]/sales/leads/LeadGrid';
import LeadDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import SmartViewsPage from '@/app/(workspace)/[workspaceSlug]/sales/smart-views/page';
import SocialLeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/social-leads/page';
import SocialLeadList from '@/components/workspace/SocialLeadList';
import type { PermissionAction, VisibilityScope } from '@prisma/client';
import { createWorkspaceUser, grantPermissions, seedHierarchy, type Hierarchy, type Member } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { buildActor, buildCtx } from '../helpers/ctx';
import { executeTool } from '@/lib/ai/assistant/tools';
import type { PermissionMap } from '@/lib/security/rbac';
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
/** In team A: reads the team's calls, changes only its own (the seeded Marketing Executive's calls). */
let callDesk: Member;
/** In team A: every lead, event and call action at OWN, ASSIGN included. */
let ownAssigner: Member;
/** In team A: edits the team's leads without `leads:ASSIGN` (the seeded Marketing Manager's leads). */
let leadEditor: Member;
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
  for (const [manager, scope] of [
    [h.branchManager, 'BRANCH'],
    [h.regionalManager, 'REGION'],
  ] as const) {
    await grantPermissions(tenantId, await roleOf(manager.id), [...work, ...calendar], scope);
  }
  await grantPermissions(tenantId, await roleOf(h.teamManagerA.id), [['smartviews', 'VIEW']], 'TEAM');
  slug = (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } })).slug;

  /** A member of team A holding exactly `grants`, each at its own scope. */
  const teamAMember = async (name: string, grants: [string, PermissionAction, VisibilityScope][]) => {
    const key = `${name}-${randomBytes(4).toString('hex')}`;
    const role = await prisma.role.create({ data: { tenantId, key, name, rank: 55 } });
    for (const [module, action, scope] of grants) await grantPermissions(tenantId, role.id, [[module, action]], scope);
    const { branchId, regionId } = await prisma.user.findFirstOrThrow({
      where: { tenantId, id: h.repA1.id },
      select: { branchId: true, regionId: true },
    });
    const user = await createWorkspaceUser({
      tenantId,
      roleId: role.id,
      email: `${key}@hierarchy.test`,
      fullName: name,
      branchId,
      regionId,
    });
    const { teamId } = await prisma.userTeam.findFirstOrThrow({ where: { tenantId, userId: h.repA1.id } });
    await prisma.userTeam.create({ data: { tenantId, userId: user.id, teamId } });
    return { id: user.id, cookie: await createSessionToken(tenantId, user.id), leadId: '' };
  };
  callDesk = await teamAMember('Call desk', [
    ['calls', 'VIEW', 'TEAM'],
    ['calls', 'EDIT', 'OWN'],
  ]);
  ownAssigner = await teamAMember('Own assigner', [
    ...(['leads', 'events', 'calls'] as const).flatMap((module) =>
      (['VIEW', 'CREATE', 'EDIT', 'DELETE', 'ASSIGN'] as const).map(
        (action): [string, PermissionAction, VisibilityScope] => [module, action, 'OWN'],
      ),
    ),
    ['tasks', 'VIEW', 'OWN'],
  ]);
  leadEditor = await teamAMember('Lead editor', [
    ['leads', 'VIEW', 'ORGANIZATION'],
    ['leads', 'EDIT', 'TEAM'],
    ['tasks', 'VIEW', 'TEAM'],
    ['tasks', 'DELETE', 'OWN'],
  ]);
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
    select: {
      notes: true,
      status: true,
      deletedAt: true,
      consent: { select: { id: true, withdrawnAt: true } },
      recording: { select: { storageKey: true } },
      transcript: { select: { id: true } },
      _count: { select: { coachingNotes: true, callAudits: true } },
    },
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

/**
 * A manager at each scope below ORGANIZATION, someone inside it and someone
 * outside it (fixtures.ts draws the tree): TEAM, BRANCH and REGION are the
 * caller's resolved people, not the workspace.
 */
const MANAGERS = [
  { who: 'a team manager', as: 'teamManagerA', inside: 'repSubTeam', outside: 'repB1' },
  { who: 'a branch manager', as: 'branchManager', inside: 'repSubTeam', outside: 'repB1' },
  { who: 'a regional manager', as: 'regionalManager', inside: 'repB1', outside: 'repOtherRegion' },
] as const;

describe.each(TEAM_RECORDS)('$name', ({ make, send, row }) => {
  it.each(MANAGERS)(
    '$who: one outside their scope answers exactly as a missing id, and nothing changes',
    async ({ as, outside }) => {
      const elsewhere = await make(h[outside].id);
      const before = await row(elsewhere);
      const refused = await send(elsewhere, h[as]);
      const missing = await send(MISSING, h[as]);
      expect(refused.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(refused.body.detail).toBe(missing.body.detail);
      expect(await row(elsewhere)).toEqual(before);
    },
  );

  it.each(MANAGERS)('$who reaches one inside their scope', async ({ as, inside }) => {
    const res = await send(await make(h[inside].id), h[as]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('a team manager reaches the team’s own, the director another region’s', async () => {
    for (const [owner, as] of [
      [h.repA2, h.teamManagerA],
      [h.repOtherRegion, h.director],
    ]) {
      const res = await send(await make(owner.id), as);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
  });
});

/**
 * A call with everything its routes read or replace: consent, a recording, a
 * transcript, an analysis, an audit and a coaching note. Without them a route
 * answers 404 for its own missing row, and a refusal cannot be told from it.
 */
const aWorkedCall = async (callerId: string) => {
  const callId = await aCall(callerId);
  const tenantId = h.tenantId;
  await prisma.recordingConsent.create({
    data: { tenantId, callId, consentGiven: true, method: 'VERBAL', givenAt: new Date() },
  });
  await prisma.recording.create({ data: { tenantId, callId, storageKey: `recordings/original-${callId}` } });
  await prisma.transcript.create({ data: { tenantId, callId, content: 'Hello' } });
  await prisma.aIAnalysis.create({ data: { tenantId, callId, status: 'COMPLETED' } });
  await prisma.callAudit.create({ data: { tenantId, callId, scorecardId: 'scorecard', status: 'COMPLETED' } });
  await prisma.coachingNote.create({ data: { tenantId, callId, authorId: h.director.id, body: 'Pace' } });
  return callId;
};
/** The id of a row the call carries, or a missing one for a missing call. */
const auditOf = async (callId: string) =>
  (await prisma.callAudit.findFirst({ where: { tenantId: h.tenantId, callId }, select: { id: true } }))?.id ?? MISSING;
const noteOf = async (callId: string) =>
  (await prisma.coachingNote.findFirst({ where: { tenantId: h.tenantId, callId }, select: { id: true } }))?.id ??
  MISSING;
/** A PUT, which the request helpers do not send: JSON, or a multipart form. */
const put = async (
  handler: (req: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>,
  id: string,
  path: string,
  as: Member,
  body: Record<string, unknown> | FormData,
) => {
  const json = !(body instanceof FormData);
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method: 'PUT',
      headers: { cookie: as.cookie, ...(json ? { 'content-type': 'application/json' } : {}) },
      body: json ? JSON.stringify(body) : body,
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
};
const upload = () => {
  const form = new FormData();
  form.append('file', new Blob(['not a recording'], { type: 'text/plain' }), 'note.txt');
  return form;
};
/**
 * Every other route under calls/{id}. Each loads the call through
 * `assertCallInScope` at its own action before anything else, so outside the
 * caller's scope it answers as a missing id does and changes nothing. A PUT of
 * recording media loaded the call by id and workspace alone: calls:EDIT
 * replaced another team's recording, and a call without consent answered 403.
 */
const CALL_ROUTES: {
  name: string;
  make?: (callerId: string) => Promise<string>;
  send: (id: string, as: Member) => Promise<{ status: number; body: any }>;
}[] = [
  { name: 'DELETE calls/{id}', send: (id, as) => del(deleteCall, `/api/v1/calls/${id}`, as.cookie) },
  { name: 'GET analysis', send: (id, as) => get(readAnalysis, `/api/v1/calls/${id}/analysis`, as.cookie) },
  { name: 'POST analysis', send: (id, as) => post(runAnalysis, `/api/v1/calls/${id}/analysis`, {}, as.cookie) },
  {
    name: 'PATCH analysis',
    send: (id, as) => patch(editAnalysis, `/api/v1/calls/${id}/analysis`, { summary: 'Taken' }, as.cookie),
  },
  { name: 'GET audit', send: (id, as) => get(readAudit, `/api/v1/calls/${id}/audit`, as.cookie) },
  {
    name: 'POST audit',
    send: (id, as) => post(runAudit, `/api/v1/calls/${id}/audit`, { scorecardId: MISSING }, as.cookie),
  },
  {
    name: 'PATCH audit',
    send: async (id, as) => patch(reviewAudit, `/api/v1/calls/${id}/audit`, { auditId: await auditOf(id) }, as.cookie),
  },
  {
    name: 'DELETE audit',
    send: async (id, as) => del(deleteAudit, `/api/v1/calls/${id}/audit?auditId=${await auditOf(id)}`, as.cookie),
  },
  {
    name: 'POST coach',
    send: (id, as) => post(coachCall, `/api/v1/calls/${id}/coach`, { action: 'ASK_NEXT' }, as.cookie),
  },
  {
    name: 'POST coaching',
    send: (id, as) => post(writeCoaching, `/api/v1/calls/${id}/coaching`, { body: 'Slow down' }, as.cookie),
  },
  {
    name: 'PATCH coaching',
    send: async (id, as) =>
      patch(resolveCoaching, `/api/v1/calls/${id}/coaching`, { noteId: await noteOf(id), resolved: true }, as.cookie),
  },
  {
    name: 'DELETE consent',
    send: (id, as) => del(withdrawConsent, `/api/v1/calls/${id}/consent`, as.cookie),
  },
  { name: 'POST dial', send: (id, as) => post(dialCall, `/api/v1/calls/${id}/dial`, {}, as.cookie) },
  {
    name: 'POST follow-up-email',
    send: (id, as) => post(draftEmail, `/api/v1/calls/${id}/follow-up-email`, {}, as.cookie),
  },
  {
    name: 'PUT follow-up-email',
    send: (id, as) =>
      put(sendEmail, id, `/api/v1/calls/${id}/follow-up-email`, as, { subject: 'Thanks', body: 'Taken' }),
  },
  {
    name: 'POST follow-up-whatsapp',
    send: (id, as) => post(draftWhatsApp, `/api/v1/calls/${id}/follow-up-whatsapp`, {}, as.cookie),
  },
  { name: 'GET live', send: (id, as) => get(liveCall, `/api/v1/calls/${id}/live`, as.cookie) },
  {
    name: 'POST live-audio',
    send: (id, as) => post(liveAudio, `/api/v1/calls/${id}/live-audio`, {}, as.cookie),
  },
  {
    name: 'GET recording',
    send: (id, as) => get(readRecording, `/api/v1/calls/${id}/recording`, as.cookie),
  },
  {
    name: 'POST recording',
    send: (id, as) => post(storeRecording, `/api/v1/calls/${id}/recording`, { storageKey: 'taken' }, as.cookie),
  },
  {
    name: 'GET recording/media',
    send: (id, as) => get(playRecording, `/api/v1/calls/${id}/recording/media`, as.cookie),
  },
  {
    name: 'PUT recording/media',
    send: (id, as) => put(uploadRecording, id, `/api/v1/calls/${id}/recording/media`, as, upload()),
  },
  {
    name: 'PUT recording/media, no consent',
    make: aCall,
    send: (id, as) => put(uploadRecording, id, `/api/v1/calls/${id}/recording/media`, as, upload()),
  },
  {
    name: 'POST temperature',
    send: (id, as) => post(applyTemperature, `/api/v1/calls/${id}/temperature`, {}, as.cookie),
  },
  { name: 'GET transcript', send: (id, as) => get(readTranscript, `/api/v1/calls/${id}/transcript`, as.cookie) },
  {
    name: 'POST transcript',
    send: (id, as) => post(storeTranscript, `/api/v1/calls/${id}/transcript`, { content: 'Taken' }, as.cookie),
  },
];

describe.each(CALL_ROUTES)('calls/{id}: $name', ({ make = aWorkedCall, send }) => {
  it.each(MANAGERS)(
    '$who: a call outside their scope answers exactly as a missing id, and nothing changes',
    async ({ as, outside }) => {
      const elsewhere = await make(h[outside].id);
      const before = await callRow(elsewhere);
      const refused = await send(elsewhere, h[as]);
      const missing = await send(MISSING, h[as]);
      expect(refused.status, JSON.stringify(refused.body)).toBe(404);
      expect(missing.status).toBe(404);
      expect(refused.body.detail).toBe(missing.body.detail);
      expect(await callRow(elsewhere)).toEqual(before);
    },
  );
});

describe('a call’s writes check it at their own action', () => {
  it('reading a teammate’s call does not stretch to changing it or coaching on it', async () => {
    const theirs = await aCall(h.repA2.id);
    const before = await callRow(theirs);
    expect((await get(readCall, `/api/v1/calls/${theirs}`, callDesk.cookie)).status).toBe(200);
    for (const send of [
      (id: string) => patch(patchCall, `/api/v1/calls/${id}`, { notes: 'Taken' }, callDesk.cookie),
      (id: string) =>
        post(recordConsent, `/api/v1/calls/${id}/consent`, { consentGiven: true, method: 'VERBAL' }, callDesk.cookie),
      (id: string) => post(writeCoaching, `/api/v1/calls/${id}/coaching`, { body: 'Slow down' }, callDesk.cookie),
    ]) {
      const refused = await send(theirs);
      const missing = await send(MISSING);
      expect(refused.status, JSON.stringify(refused.body)).toBe(404);
      expect(refused.body.detail).toBe(missing.body.detail);
    }
    expect(await callRow(theirs)).toEqual(before);
  });

  it('the call page offers its writes only on a call the viewer may change', async () => {
    cookieJar.value = callDesk.cookie;
    const open = async (id: string) => {
      const tree = await CallPage({ params: Promise.resolve({ id }) });
      const props = (type: unknown) => elements(tree).find((el) => el.type === type)?.props;
      return {
        actions: props(CallActions)?.canEdit,
        coach: props(CoachingNotes)?.canCoach,
        live: hrefs(tree).includes(`/calls/${id}/live`),
      };
    };
    expect(await open(await aCall(h.repA2.id))).toEqual({ actions: false, coach: false, live: false });
    expect(await open(await aCall(callDesk.id))).toEqual({ actions: true, coach: false, live: true });
  });
});

describe('an activity by id, at TEAM scope', () => {
  const logged = async (ownerId: string, leadId: string) =>
    (
      await prisma.activity.create({
        data: { tenantId: h.tenantId, typeId: activityTypeId, leadId, ownerId, notes: 'Called' },
      })
    ).id;
  const correct = async (id: string) =>
    (await patch(patchActivity, `/api/v1/activities/${id}`, { notes: 'Corrected' }, h.teamManagerA.cookie)).status;

  it('is the team’s when one of its people owns the lead, whoever logged it', async () => {
    expect(await correct(await logged(h.repB1.id, h.repA2.leadId))).toBe(200);
  });

  it('is the team’s when one of its people logged it, whoever owns the lead', async () => {
    expect(await correct(await logged(h.repA2.id, h.repB1.leadId))).toBe(200);
  });

  it('is not the team’s when neither who logged it nor the lead’s owner is in the team', async () => {
    const id = await logged(h.repB1.id, h.repOtherRegion.leadId);
    expect(await correct(id)).toBe(404);
    expect(await activityRow(id)).toMatchObject({ notes: 'Called' });
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

  it('the calendar draws the team’s events and calls, not another team’s', async () => {
    const [ours, theirs] = [await anEvent(h.repA2.id), await anEvent(h.repB1.id)];
    const [ourCall, theirCall] = [await aCall(h.repA2.id), await aCall(h.repB1.id)];
    cookieJar.value = h.teamManagerA.cookie;
    const month = (at: Date) => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
    const drawn = async (at: Date) => {
      const tree = await CalendarPage({ searchParams: Promise.resolve({ month: month(at) }) });
      const items = elements(tree).find((el) => Array.isArray(el.props.items))?.props.items as { id: string }[];
      return items.map((item) => item.id);
    };
    const events = await drawn(startAt);
    expect(events).toContain(`event-${ours}`);
    expect(events).not.toContain(`event-${theirs}`);
    const calls = await drawn(new Date());
    expect(calls).toContain(`call-${ourCall}`);
    expect(calls).not.toContain(`call-${theirCall}`);
  });

  it('the dashboard counts the calls and audits the Calls and Call Audits pages list', async () => {
    cookieJar.value = h.teamManagerA.cookie;
    const panel = async () => {
      const tree = await DashboardPage({ params: Promise.resolve({ workspaceSlug: slug }) });
      const values = elements(tree).find((el) => el.props.title === 'Call quality')?.props.values;
      return Object.fromEntries(values as [string, string | number][]);
    };
    const before = await panel();
    const startedAt = new Date();
    const theirs = await prisma.call.create({ data: { tenantId: h.tenantId, callerId: h.repB1.id, startedAt } });
    await prisma.callAudit.create({
      data: { tenantId: h.tenantId, callId: theirs.id, scorecardId: 'scorecard', status: 'COMPLETED' },
    });
    expect(await panel()).toEqual(before);
    await prisma.call.create({ data: { tenantId: h.tenantId, callerId: h.repA2.id, startedAt } });
    expect((await panel())['Calls today']).toBe(Number(before['Calls today']) + 1);
  });
});

describe('the people a screen offers to hand work to', () => {
  it('Smart Views’ bulk assign lists whom the assign route accepts', async () => {
    cookieJar.value = h.teamManagerA.cookie;
    const tree = await SmartViewsPage({ searchParams: Promise.resolve({}) });
    const offered = (elements(tree).find((el) => el.type === LeadGrid)?.props.users as { id: string }[]).map(
      (user) => user.id,
    );
    expect(offered).toContain(h.repA2.id);
    expect(offered).not.toContain(h.repB1.id);
  });

  it('Social Leads offers only those, and still names everyone who touched an enquiry', async () => {
    cookieJar.value = h.teamManagerA.cookie;
    const tree = await SocialLeadsPage({
      params: Promise.resolve({ workspaceSlug: slug }),
      searchParams: Promise.resolve({}),
    });
    const { users, assignees } = elements(tree).find((el) => el.type === SocialLeadList)?.props.options as {
      users: { id: string }[];
      assignees: { id: string }[];
    };
    expect(assignees.map((user) => user.id)).toContain(h.repA2.id);
    expect(assignees.map((user) => user.id)).not.toContain(h.repB1.id);
    expect(users.map((user) => user.id)).toEqual(expect.arrayContaining([h.repB1.id, h.director.id]));
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

/** Refused exactly as an unknown user is, and nothing lands. */
const refusedAsUnknown = async (refusal: number, theirs: Handing, unknown: Handing) => {
  expect(theirs.res.status, JSON.stringify(theirs.res.body)).toBe(refusal);
  expect(unknown.res.status).toBe(refusal);
  expect(theirs.res.body.detail).toBe(unknown.res.body.detail);
  expect(await theirs.landed()).toBe(false);
};

describe.each(HANDING)('handing work: $name', ({ hand, refusal = 404 }) => {
  it.each(MANAGERS)('$who: someone outside their scope answers as an unknown user', async ({ as, outside }) => {
    await refusedAsUnknown(refusal, await hand(h[as], h[outside].id), await hand(h[as], MISSING));
  });

  it.each(MANAGERS)('$who hands inside their scope', async ({ as, inside }) => {
    const handing = await hand(h[as], h[inside].id);
    expect(handing.res.status, JSON.stringify(handing.res.body)).toBe(200);
    expect(await handing.landed()).toBe(true);
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

  it('an own-scope agent who may assign: a teammate answers as an unknown user', async () => {
    await refusedAsUnknown(refusal, await hand(ownAssigner, h.repA2.id), await hand(ownAssigner, MISSING));
  });

  it('an own-scope agent who may not assign never hands it to a teammate', async () => {
    const handing = await hand(h.repA1, h.repA2.id);
    expect(handing.res.status).toBeLessThan(500);
    expect(await handing.landed()).toBe(false);
  });
});

/**
 * `leads:EDIT` at TEAM without `leads:ASSIGN`, as the seeded Marketing Manager
 * holds them: a task or follow-up stays with the editor. These took any active
 * user before, on the EDIT scope; the target is now checked under ASSIGN.
 */
describe('editing the team’s leads without assigning them', () => {
  it.each(HANDING.filter(({ name }) => /tasks|follow-ups/.test(name)))(
    '$name: a teammate answers as an unknown user',
    async ({ hand }) => {
      await refusedAsUnknown(404, await hand(leadEditor, h.repA2.id), await hand(leadEditor, MISSING));
    },
  );
});

/**
 * The follow-ups and tasks lists show the work of the people the caller's scope
 * covers, as the by-id routes reach it: a follow-up under `leads:VIEW`, a task
 * under `tasks:VIEW`, a task with no owner only at ORGANIZATION. The follow-ups
 * list and its API filtered on the caller alone, so a team lead saw none of the
 * team's; a Lead-Eagle-only workspace had no task list and there was no tasks
 * list API. "Mine" keeps the caller's own queue one click away.
 */
type Owner = 'teamManagerA' | 'repA1' | 'repA2' | 'repB1' | 'director';
const OWNERS: Owner[] = ['teamManagerA', 'repA1', 'repA2', 'repB1', 'director'];
const TEAM_A: Owner[] = ['teamManagerA', 'repA1', 'repA2'];
const VIEWERS: { name: string; who: Owner; sees: (Owner | null)[]; wide?: string }[] = [
  { name: 'a team manager (TEAM)', who: 'teamManagerA', sees: TEAM_A, wide: 'Team' },
  { name: 'an agent (OWN)', who: 'repA1', sees: ['repA1'] },
  { name: 'the director (ORGANIZATION)', who: 'director', sees: [...OWNERS, null], wide: 'Everyone' },
];
const followUpOf = new Map<Owner | null, string>();
const taskOf = new Map<Owner | null, string>();

/** `listed` holds the row of every owner in `sees`, and no other row of `rows`. */
const exactly = (listed: string[], rows: Map<Owner | null, string>, sees: (Owner | null)[]) => {
  for (const [owner, id] of rows) expect(listed.includes(id), `${owner ?? 'nobody'}’s`).toBe(sees.includes(owner));
};
const followUpsApi = async (cookie: string, query = '') => {
  const res = await get(listFollowUps, `/api/v1/follow-ups${query}`, cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.data as { id: string }[]).map((row) => row.id);
};
/** Every page of the tasks API, `limit` rows at a time. */
const tasksApi = async (cookie: string, query = '', limit = 200) => {
  const listed: string[] = [];
  let cursor = '';
  do {
    const res = await get(listTasks, `/api/v1/tasks?limit=${limit}${query}${cursor && `&cursor=${cursor}`}`, cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    listed.push(...(res.body.data as { id: string }[]).map((row) => row.id));
    cursor = res.body.nextCursor ?? '';
  } while (cursor);
  return listed;
};
const followUpsPage = async (cookie: string, searchParams: Record<string, string> = {}) => {
  cookieJar.value = cookie;
  const tree = await FollowUpsPage({ searchParams: Promise.resolve(searchParams) });
  const grid = elements(tree).find((el) => el.type === ConfigurableGrid)?.props;
  return {
    tree,
    rows: (grid?.rows ?? []) as { id: string; canAct?: boolean; lead?: { fullName: string } | null }[],
    ownerColumn: ((grid?.columns ?? []) as { key: string }[]).some((column) => column.key === 'owner'),
  };
};
const tasksPage = async (cookie: string, searchParams: Record<string, string> = {}) => {
  cookieJar.value = cookie;
  const tree = await TasksPage({ searchParams: Promise.resolve(searchParams) });
  return { tree, rows: elements(tree).flatMap((el) => (el.type === 'tr' && el.key ? [String(el.key)] : [])) };
};
/** The elements of one task's row on the Tasks page. */
const taskCells = (tree: unknown, id: string) =>
  elements(elements(tree).find((el) => el.type === 'tr' && el.key === id)?.props.children);
/** The labels of the page's switch between the caller's own work and their scope's. */
const switchLabels = (tree: unknown) => {
  const nav = elements(tree).find((el) => el.props['aria-label'] === 'Whose work');
  return nav ? elements(nav.props.children).map((el) => el.props.children) : [];
};

describe('the follow-ups and tasks lists', () => {
  beforeAll(async () => {
    const { tenantId } = h;
    // Overdue, so they lead every list ordered by due date.
    const dueAt = new Date(Date.now() - 86_400_000);
    for (const owner of OWNERS) {
      const data = { tenantId, ownerId: h[owner].id, createdById: h[owner].id, dueAt };
      followUpOf.set(owner, (await prisma.followUpTask.create({ data: { ...data, title: 'Call back' } })).id);
      taskOf.set(owner, (await prisma.task.create({ data: { ...data, typeId, title: 'Send brochure' } })).id);
    }
    taskOf.set(null, (await prisma.task.create({ data: { tenantId, typeId, title: 'Nobody’s', dueAt } })).id);
  });

  describe.each(VIEWERS)('$name', ({ who, sees, wide }) => {
    it('the follow-ups API and page list the follow-ups of the people in scope, overdue filter included', async () => {
      const { cookie } = h[who];
      exactly(await followUpsApi(cookie), followUpOf, sees);
      exactly(await followUpsApi(cookie, '?due=overdue'), followUpOf, sees);
      for (const params of [{}, { due: 'overdue' }] as Record<string, string>[]) {
        const page = await followUpsPage(cookie, params);
        exactly(
          page.rows.map((row) => row.id),
          followUpOf,
          sees,
        );
        expect(page.ownerColumn).toBe(Boolean(wide));
      }
    });

    it('the tasks API and page list the tasks of the people in scope, overdue filter included', async () => {
      const { cookie } = h[who];
      exactly(await tasksApi(cookie), taskOf, sees);
      exactly((await tasksPage(cookie)).rows, taskOf, sees);
      exactly((await tasksPage(cookie, { tab: 'overdue' })).rows, taskOf, sees);
    });

    it('Mine lists only their own, overdue filter included', async () => {
      const { cookie } = h[who];
      exactly(await followUpsApi(cookie, '?view=mine'), followUpOf, [who]);
      exactly(await followUpsApi(cookie, '?view=mine&due=overdue'), followUpOf, [who]);
      const page = await followUpsPage(cookie, { view: 'mine', due: 'overdue' });
      exactly(
        page.rows.map((row) => row.id),
        followUpOf,
        [who],
      );
      expect(page.ownerColumn).toBe(false);
      exactly(await tasksApi(cookie, '&view=mine'), taskOf, [who]);
      exactly((await tasksPage(cookie, { view: 'mine' })).rows, taskOf, [who]);
      exactly((await tasksPage(cookie, { view: 'mine', tab: 'overdue' })).rows, taskOf, [who]);
    });

    it(wide ? `offers Mine and ${wide}` : 'offers no switch: their own is all they see', async () => {
      const { cookie } = h[who];
      const offered = wide ? ['Mine', wide] : [];
      expect(switchLabels((await followUpsPage(cookie)).tree)).toEqual(offered);
      expect(switchLabels((await tasksPage(cookie)).tree)).toEqual(offered);
    });
  });

  it('the tasks API pages through the same rows', async () => {
    const { cookie } = h.teamManagerA;
    const paged = await tasksApi(cookie, '', 2);
    expect(paged.length).toBeGreaterThan(2);
    expect(paged).toEqual(await tasksApi(cookie));
  });

  it('offers Complete and Reschedule only on follow-ups the viewer’s leads:EDIT reaches', async () => {
    // Reads every lead, edits the team's.
    const { rows } = await followUpsPage(leadEditor.cookie);
    const canAct = (owner: Owner) => rows.find((row) => row.id === followUpOf.get(owner))?.canAct;
    expect(canAct('repA2')).toBe(true);
    expect(canAct('repB1')).toBe(false);
  });

  it('the screens that count the caller’s own follow-ups open them under Mine', async () => {
    cookieJar.value = h.repA1.cookie;
    const home = await SalesHomePage();
    expect(hrefs(await (home.type as (props: unknown) => Promise<unknown>)(home.props))).toContain(
      '/follow-ups?view=mine&due=overdue',
    );
    cookieJar.value = h.teamManagerA.cookie;
    const due = new Date(Date.now() - 86_400_000);
    const month = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}`;
    const tree = await CalendarPage({ searchParams: Promise.resolve({ month }) });
    const items = elements(tree).find((el) => Array.isArray(el.props.items))?.props.items as {
      id: string;
      href: string;
    }[];
    expect(items.find((item) => item.id === `fup-${followUpOf.get('teamManagerA')}`)?.href).toBe(
      '/follow-ups?view=mine',
    );
    expect(entityRoute('follow_ups_overdue', null, slug)).toBe(`/${slug}/sales/follow-ups?view=mine&due=overdue`);
    // The daily brief's "Overdue tasks" counts the user's own too.
    expect(entityRoute('tasks_overdue', null, slug)).toBe(`/${slug}/sales/tasks?view=mine&tab=overdue`);
  });

  it('offers a task’s buttons only where its PATCH and DELETE reach the owner', async () => {
    // Overdue, so they sort ahead of the rest of the fixture's tasks.
    const own = async (as: Member) =>
      (
        await prisma.task.create({
          data: {
            tenantId: h.tenantId,
            typeId,
            ownerId: as.id,
            title: 'Own',
            dueAt: new Date(Date.now() - 86_400_000),
          },
        })
      ).id;
    const actions = async (as: Member, id: string) =>
      taskCells((await tasksPage(as.cookie)).tree, id).find((el) => el.type === TaskRowActions)?.props;
    // The desk reads every task and edits its own leads alone.
    const deskOwn = await own(taskDesk);
    expect(await actions(taskDesk, deskOwn)).toBeDefined();
    expect(await actions(taskDesk, taskOf.get('repA2')!)).toBeUndefined();
    expect(await actions(taskDesk, taskOf.get('repB1')!)).toBeUndefined();
    // The editor edits the team's leads and deletes only its own tasks.
    const editorOwn = await own(leadEditor);
    expect((await actions(leadEditor, editorOwn))?.canDelete).toBe(true);
    expect((await actions(leadEditor, taskOf.get('repA2')!))?.canDelete).toBe(false);
    // The director reaches all of them.
    expect((await actions(h.director, taskOf.get('repB1')!))?.canDelete).toBe(true);
  });

  it('names a row’s lead only where the viewer may open the lead', async () => {
    // Team A's work on a lead that has since gone to team B: a reassignment moves only open work.
    const lead = await prisma.lead.findFirstOrThrow({
      where: { tenantId: h.tenantId, id: h.repB1.leadId },
      select: { id: true, fullName: true },
    });
    const data = {
      tenantId: h.tenantId,
      ownerId: h.repA2.id,
      leadId: lead.id,
      dueAt: new Date(Date.now() - 86_400_000),
    };
    const followUp = (await prisma.followUpTask.create({ data: { ...data, title: 'Moved on' } })).id;
    const theTask = (await prisma.task.create({ data: { ...data, typeId, title: 'Moved on' } })).id;
    for (const [as, named] of [
      [h.teamManagerA, false],
      [h.director, true],
    ] as const) {
      const row = (await followUpsPage(as.cookie)).rows.find((r) => r.id === followUp);
      expect(row?.lead?.fullName).toBe(named ? lead.fullName : undefined);
      expect(hrefs(taskCells((await tasksPage(as.cookie)).tree, theTask)).includes(`/leads/${lead.id}`)).toBe(named);
    }
    // A lead the team manager may open is still named.
    const ours = await prisma.task.create({ data: { ...data, typeId, leadId: h.repA2.leadId, title: 'Ours' } });
    expect(hrefs(taskCells((await tasksPage(h.teamManagerA.cookie)).tree, ours.id))).toContain(
      `/leads/${h.repA2.leadId}`,
    );
  });

  it('labels and ranks each task cell for a phone card, as the grid does', async () => {
    const cells = taskCells((await tasksPage(h.teamManagerA.cookie)).tree, taskOf.get('repA2')!);
    expect(
      cells.filter((el) => el.type === 'td').map((el) => [el.props['data-label'], el.props['data-priority']]),
    ).toEqual([
      ['Task', 'primary'],
      ['Type', 'detail'],
      ['Related lead', 'detail'],
      ['Owner', 'detail'],
      ['Due', 'secondary'],
      ['Priority', 'secondary'],
      ['Status', 'secondary'],
      ['', 'secondary'],
    ]);
    expect(cells.some((el) => el.type === RowDetails)).toBe(true);
  });

  it('a Lead-Eagle-only workspace lists its team lead the team’s tasks, on the page and through the API', async () => {
    const swap = async (from: 'SALES' | 'LEAD_EAGLE', to: 'SALES' | 'LEAD_EAGLE') => {
      await prisma.moduleEntitlement.updateMany({
        where: { tenantId: h.tenantId, module: from },
        data: { module: to },
      });
      await invalidateEntitlements(h.tenantId);
    };
    await swap('SALES', 'LEAD_EAGLE');
    try {
      const { cookie } = h.teamManagerA;
      exactly((await tasksPage(cookie)).rows, taskOf, TEAM_A);
      exactly(await tasksApi(cookie), taskOf, TEAM_A);
    } finally {
      await swap('LEAD_EAGLE', 'SALES');
    }
  });
});

/**
 * A second person who works a lead (`secondaryOwnerId`, M4-09) reaches it as
 * its owner does, at every scope: by id, in the list, on the page and on its
 * writes. Naming one follows the ASSIGN scope, as naming the owner does.
 */
describe('a secondary owner', () => {
  /** Owned by repB1 (another team); repA1 works it too. */
  let shared: string;
  /** Owned by repOtherRegion; repA2 (team A) works it too. */
  let teamShared: string;
  let ownAssignerLead: string;
  const leadPage = (id: string) => LeadDetailPage({ params: Promise.resolve({ id }) });
  const listed = async (cookie: string) => {
    const res = await get(listLeads, '/api/v1/leads?limit=100', cookie);
    expect(res.status).toBe(200);
    return (res.body.data as { id: string }[]).map((l) => l.id);
  };

  beforeAll(async () => {
    const make = async (reference: string, ownerId: string, secondaryOwnerId: string | null) =>
      (
        await prisma.lead.create({
          data: { tenantId: h.tenantId, reference, fullName: reference, stageId, ownerId, secondaryOwnerId },
        })
      ).id;
    shared = await make('SHARED-OWN', h.repB1.id, h.repA1.id);
    teamShared = await make('SHARED-TEAM', h.repOtherRegion.id, h.repA2.id);
    ownAssignerLead = await make('OWN-ASSIGNER', ownAssigner.id, null);
  });

  it('OWN: the secondary owner reaches the lead as its owner does; a teammate does not', async () => {
    const url = `/api/v1/leads/${shared}`;
    expect((await get(getLead, url, h.repA1.cookie)).status).toBe(200);
    expect((await patch(patchLead, url, { fullName: 'Shared, edited' }, h.repA1.cookie)).status).toBe(200);
    expect(await listed(h.repA1.cookie)).toContain(shared);
    cookieJar.value = h.repA1.cookie;
    await expect(leadPage(shared)).resolves.toBeTruthy();

    const theirs = await get(getLead, url, h.repA2.cookie);
    expect(theirs.status).toBe(404);
    expect(theirs.body.detail).toBe('Lead not found.');
    expect(await listed(h.repA2.cookie)).not.toContain(shared);
    cookieJar.value = h.repA2.cookie;
    await expect(leadPage(shared)).rejects.toThrow(/;404$/);
  });

  it('TEAM and wider: a manager sees a lead a member of theirs works as its secondary owner', async () => {
    for (const manager of [h.teamManagerA, h.branchManager, h.regionalManager, h.director]) {
      const res = await get(getLead, `/api/v1/leads/${teamShared}`, manager.cookie);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await listed(manager.cookie)).toContain(teamShared);
    }
    expect(await listed(h.repB1.cookie)).not.toContain(teamShared);
  });

  it('naming one follows the ASSIGN scope', async () => {
    const name = (leadId: string, userId: string, cookie: string) =>
      patch(patchLead, `/api/v1/leads/${leadId}`, { secondaryOwnerId: userId }, cookie);
    const outside = await name(h.repA1.leadId, h.repB1.id, h.teamManagerA.cookie);
    expect(outside.status).toBe(404);
    expect(outside.body.detail).toBe('User not found.');
    const inside = await name(h.repA1.leadId, h.repA2.id, h.teamManagerA.cookie);
    expect(inside.status, JSON.stringify(inside.body)).toBe(200);
    expect(inside.body.secondaryOwnerId).toBe(h.repA2.id);
    // ASSIGN at OWN reaches nobody else; without ASSIGN the field is ignored.
    expect((await name(ownAssignerLead, h.repA1.id, ownAssigner.cookie)).status).toBe(404);
    const ignored = await name(h.repA1.leadId, h.repB1.id, h.repA1.cookie);
    expect(ignored.status).toBe(200);
    expect(ignored.body.secondaryOwnerId).toBe(h.repA2.id);
  });

  it('the assistant’s day lists a breached lead to its secondary owner, not to a teammate', async () => {
    await prisma.lead.update({ where: { tenantId: h.tenantId, id: shared }, data: { slaState: 'BREACHED' } });
    const breached = async (member: { id: string }) => {
      const ctx = buildCtx(
        buildActor({
          id: member.id,
          tenantId: h.tenantId,
          permissions: new Map([['leads:VIEW', 'OWN']]) as PermissionMap,
        }),
      );
      const day = await executeTool(ctx, 'getMyDay', {});
      return (day.data as { slaBreachedLeads: { id: string }[] }).slaBreachedLeads.map((lead) => lead.id);
    };
    expect(await breached(h.repA1)).toContain(shared);
    expect(await breached(h.repA2)).not.toContain(shared);
  });
});

describe('deleting', () => {
  it('takes the caller’s own lead', async () => {
    expect((await del(deleteLead, `/api/v1/leads/${h.repA1.leadId}`, h.repA1.cookie)).status).toBe(200);
  });
});
