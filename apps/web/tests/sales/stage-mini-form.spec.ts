/**
 * The status mini-form (M4-18) and the stage rail (M4-45).
 *
 * A stage that books something says so (`LeadStage.requiredFields`: `visitAt`
 * for a site visit, which also names its project, `meetingAt` for a meeting).
 * Moving a lead there takes the booking in the same request: the site visit or
 * the meeting task is written in the transaction that moves the stage, audited,
 * and without the fields the move is refused 422, so no screen and no API
 * caller can claim a visit nobody booked. The project is one the caller's
 * picker offers: the catalogue, to a role that reads it.
 *
 * Checked on the route and on the lead page server component (what it hands
 * the rail and the mini-form).
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
import { PATCH as patchLead } from '@/app/api/v1/leads/[id]/route';
import LeadPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import LeadDetail from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/LeadDetail';
import StageRail from '@/components/ui/StageRail';
import StageReason from '@/components/workspace/StageReason';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture, type Grants } from '../helpers/fixtures';
import { patch } from '../helpers/request';
import { createSessionToken } from '../helpers/session';

const suffix = randomBytes(4).toString('hex');
let fixture: Fixture;
let tenantId: string;
let visitStage: { id: string };
let meetingStage: { id: string };
let dropped: { id: string };
let marina: { id: string };
let retired: { id: string };
let elsewhere: { id: string };
let meetingType: { id: string };
const cookies: Record<'noProjects' | 'noVisits', string> = { noProjects: '', noVisits: '' };

const url = (leadId: string) => `/api/v1/leads/${leadId}`;
const lead = async (name: string, stageId = fixture.a.stageId) =>
  (
    await prisma.lead.create({
      data: {
        tenantId,
        reference: `MF-${randomBytes(4).toString('hex')}`,
        fullName: name,
        stageId,
        ownerId: fixture.a.userId,
      },
    })
  ).id;
const stageOf = async (leadId: string) =>
  (await prisma.lead.findFirstOrThrow({ where: { tenantId, id: leadId }, select: { stageId: true } })).stageId;
const visitsOf = (leadId: string) => prisma.siteVisit.findMany({ where: { tenantId, leadId } });

/** Next Thursday-ish, far enough ahead never to be "past"; the wall clock Dubai shows. */
const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

async function role(name: string, grants: Grants) {
  const created = await prisma.role.create({
    data: { tenantId, key: `${name}-${suffix}`, name, rank: 40, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, created.id, grants, 'ORGANIZATION');
  const user = await createWorkspaceUser({
    tenantId,
    roleId: created.id,
    email: `${name}.${suffix}@mini-form.test`,
    fullName: name,
  });
  return createSessionToken(tenantId, user.id);
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  // The fixture's administrator holds the lead modules but not the visit
  // register or the catalogue; a Company Admin holds both.
  const admin = await prisma.user.findFirstOrThrow({ where: { tenantId, id: fixture.a.userId } });
  await grantPermissions(tenantId, admin.roleId, [
    ['visits', 'VIEW'],
    ['visits', 'CREATE'],
    ['projects', 'VIEW'],
  ]);
  const leadWork: Grants = [
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
  ];
  cookies.noProjects = await role('no-projects', [...leadWork, ['visits', 'CREATE']]);
  cookies.noVisits = await role('no-visits', [...leadWork, ['projects', 'VIEW']]);

  meetingStage = await prisma.leadStage.create({
    data: { tenantId, key: 'meeting_scheduled', name: 'Meeting Scheduled', position: 3, requiredFields: ['meetingAt'] },
  });
  visitStage = await prisma.leadStage.create({
    data: {
      tenantId,
      key: 'site_visit_scheduled',
      name: 'Site Visit Scheduled',
      position: 5,
      requiredFields: ['visitAt'],
    },
  });
  await prisma.leadStage.create({
    data: { tenantId, key: 'booked', name: 'Booked', position: 8, category: 'CONVERSION' },
  });
  dropped = await prisma.leadStage.create({
    data: {
      tenantId,
      key: 'dropped',
      name: 'Dropped',
      position: 10,
      category: 'TERMINAL_NEGATIVE',
      requiresReason: true,
    },
  });
  meetingType = await prisma.taskType.create({
    data: { tenantId, key: 'meeting', name: 'Meeting', category: 'APPOINTMENT' },
  });
  marina = await prisma.project.create({ data: { tenantId, name: 'Marina Heights', code: `MH-${suffix}` } });
  retired = await prisma.project.create({
    data: { tenantId, name: 'Old Tower', code: `OT-${suffix}`, deletedAt: new Date() },
  });
  elsewhere = await prisma.project.create({
    data: { tenantId: fixture.b.tenantId, name: 'Other Company Tower', code: `OC-${suffix}` },
  });
});

afterAll(async () => {
  await fixture.cleanup();
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { endsWith: `${suffix}@mini-form.test` } } });
});

describe('moving a lead to Site Visit Scheduled', () => {
  it('is refused 422 without the visit time and project, and nothing is written', async () => {
    const leadId = await lead('No details');
    const none = await patch(patchLead, url(leadId), { stageId: visitStage.id }, fixture.a.cookie);
    expect(none.status).toBe(422);
    expect(none.body.detail).toBe('Site Visit Scheduled needs: visitAt, projectId.');
    const noProject = await patch(
      patchLead,
      url(leadId),
      { stageId: visitStage.id, visitAt: `${day}T16:30` },
      fixture.a.cookie,
    );
    expect(noProject.status).toBe(422);
    expect(noProject.body.detail).toBe('Site Visit Scheduled needs: projectId.');
    expect(await stageOf(leadId)).toBe(fixture.a.stageId);
    expect(await visitsOf(leadId)).toEqual([]);
  });

  it('books the site visit in the same request, at the workspace’s clock, and audits both', async () => {
    const leadId = await lead('Visit booked');
    const moved = await patch(
      patchLead,
      url(leadId),
      { stageId: visitStage.id, visitAt: `${day}T16:30`, projectId: marina.id },
      fixture.a.cookie,
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(await stageOf(leadId)).toBe(visitStage.id);

    const visits = await visitsOf(leadId);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({
      kind: 'PROPERTY_VISIT',
      status: 'REQUESTED',
      projectId: marina.id,
      ownerId: fixture.a.userId,
      createdById: fixture.a.userId,
    });
    // 16:30 in Dubai (UTC+4, the workspace's zone) is 12:30 UTC.
    expect(visits[0]!.scheduledAt.toISOString()).toBe(`${day}T12:30:00.000Z`);

    const audited = await prisma.auditLog.findMany({
      where: { tenantId, OR: [{ recordId: leadId, event: 'STAGE_CHANGED' }, { recordId: visits[0]!.id }] },
      select: { event: true, objectType: true },
    });
    expect(audited).toEqual(
      expect.arrayContaining([
        { event: 'STAGE_CHANGED', objectType: 'lead' },
        { event: 'RECORD_CREATED', objectType: 'visits' },
      ]),
    );
  });

  it('takes an instant with its offset as it is', async () => {
    const leadId = await lead('Offset instant');
    const at = `${day}T09:15:00.000Z`;
    const moved = await patch(
      patchLead,
      url(leadId),
      { stageId: visitStage.id, visitAt: at, projectId: marina.id },
      fixture.a.cookie,
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((await visitsOf(leadId))[0]!.scheduledAt.toISOString()).toBe(at);
  });

  it('refuses a visit in the past or a time that is not one', async () => {
    const leadId = await lead('Past visit');
    const past = await patch(
      patchLead,
      url(leadId),
      { stageId: visitStage.id, visitAt: '2020-01-01T10:00', projectId: marina.id },
      fixture.a.cookie,
    );
    expect(past.status).toBe(422);
    const garbage = await patch(
      patchLead,
      url(leadId),
      { stageId: visitStage.id, visitAt: 'next tuesday', projectId: marina.id },
      fixture.a.cookie,
    );
    expect(garbage.status).toBe(422);
    expect(await stageOf(leadId)).toBe(fixture.a.stageId);
  });

  it('a project outside the caller’s catalogue is not found, and the stage does not move', async () => {
    const leadId = await lead('Wrong project');
    for (const projectId of [elsewhere.id, retired.id]) {
      const res = await patch(
        patchLead,
        url(leadId),
        { stageId: visitStage.id, visitAt: `${day}T11:00`, projectId },
        fixture.a.cookie,
      );
      expect(res.status, projectId).toBe(404);
    }
    // A role that cannot read the catalogue names no project at all.
    const blind = await patch(
      patchLead,
      url(leadId),
      { stageId: visitStage.id, visitAt: `${day}T11:00`, projectId: marina.id },
      cookies.noProjects,
    );
    expect(blind.status).toBe(404);
    expect(await stageOf(leadId)).toBe(fixture.a.stageId);
    expect(await prisma.leadStageHistory.count({ where: { tenantId, leadId } })).toBe(0);
    expect(await visitsOf(leadId)).toEqual([]);
  });

  it('needs the right to book a site visit', async () => {
    const leadId = await lead('No visit right');
    const res = await patch(
      patchLead,
      url(leadId),
      { stageId: visitStage.id, visitAt: `${day}T11:00`, projectId: marina.id },
      cookies.noVisits,
    );
    expect(res.status).toBe(403);
    expect(await stageOf(leadId)).toBe(fixture.a.stageId);
  });
});

describe('moving a lead to Meeting Scheduled', () => {
  it('is refused 422 without the meeting time', async () => {
    const leadId = await lead('No meeting time');
    const res = await patch(patchLead, url(leadId), { stageId: meetingStage.id }, fixture.a.cookie);
    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('Meeting Scheduled needs: meetingAt.');
    expect(await stageOf(leadId)).toBe(fixture.a.stageId);
  });

  it('books a meeting task in the same request, the lead’s next follow-up, audited', async () => {
    const leadId = await lead('Meeting booked');
    const moved = await patch(
      patchLead,
      url(leadId),
      { stageId: meetingStage.id, meetingAt: `${day}T10:00` },
      fixture.a.cookie,
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const tasks = await prisma.task.findMany({ where: { tenantId, leadId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      typeId: meetingType.id,
      category: 'APPOINTMENT',
      ownerId: fixture.a.userId,
      title: 'Meeting with Meeting booked',
    });
    expect(tasks[0]!.dueAt.toISOString()).toBe(`${day}T06:00:00.000Z`);
    const after = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: leadId } });
    expect(after.stageId).toBe(meetingStage.id);
    expect(after.nextFollowUpAt?.toISOString()).toBe(`${day}T06:00:00.000Z`);
    expect(
      await prisma.auditLog.count({
        where: { tenantId, recordId: tasks[0]!.id, event: 'RECORD_CREATED', objectType: 'tasks' },
      }),
    ).toBe(1);
  });
});

/** The lead page's rail, as its client component renders it. */
async function leadPage(cookie: string, leadId: string) {
  cookieJar.value = cookie;
  const page = (await LeadPage({ params: Promise.resolve({ id: leadId }) })) as ReactElement<{
    children: ReactElement[];
  }>;
  const find = (type: unknown) => page.props.children.find((child) => child?.type === type) as ReactElement;
  return { rail: find(StageRail), detail: find(LeadDetail) as ReactElement<{ projects: { name: string }[] }> };
}

/** Each segment in order: its stage, its state, and whether it sits in the exits group. */
function segments(rail: ReactElement) {
  const markup = renderToStaticMarkup(rail);
  const exitsAt = markup.indexOf('aria-label="Exits"');
  return [...markup.matchAll(/data-state="(\w+)"[^>]*?title="([^"]+)"/g)].map((m) => ({
    name: m[2],
    state: m[1],
    exit: exitsAt >= 0 && m.index! > exitsAt,
  }));
}

describe('the lead page', () => {
  it('shows the rail with the exits apart: the current stage highlighted, an exit not a step after Booked', async () => {
    const atVisit = await lead('On the ladder', visitStage.id);
    expect(segments((await leadPage(fixture.a.cookie, atVisit)).rail)).toEqual([
      { name: 'New', state: 'done', exit: false },
      { name: 'Meeting Scheduled', state: 'done', exit: false },
      { name: 'Site Visit Scheduled', state: 'active', exit: false },
      { name: 'Booked', state: 'pending', exit: false },
      { name: 'Dropped', state: 'pending', exit: true },
    ]);

    // A lead that left by an exit has not passed the steps before it.
    const out = await lead('Dropped out', dropped.id);
    expect(segments((await leadPage(fixture.a.cookie, out)).rail)).toEqual([
      { name: 'New', state: 'pending', exit: false },
      { name: 'Meeting Scheduled', state: 'pending', exit: false },
      { name: 'Site Visit Scheduled', state: 'pending', exit: false },
      { name: 'Booked', state: 'pending', exit: false },
      { name: 'Dropped', state: 'active', exit: true },
    ]);
  });

  it('offers the projects the caller’s catalogue holds, and none to a role that cannot read it', async () => {
    const leadId = await lead('Picker');
    const names = async (cookie: string) =>
      (await leadPage(cookie, leadId)).detail.props.projects.map((project) => project.name);
    expect(await names(fixture.a.cookie)).toEqual(['Marina Heights']);
    expect(await names(cookies.noProjects)).toEqual([]);
  });

  it('the mini-form asks for the visit’s date, time and project, all required', () => {
    const markup = renderToStaticMarkup(
      createElement(StageReason, {
        stage: {
          id: visitStage.id,
          name: 'Site Visit Scheduled',
          requiresReason: false,
          reasons: [],
          requiredFields: ['visitAt'],
        },
        projects: [{ id: marina.id, name: 'Marina Heights' }],
        busy: false,
        onMove: () => {},
        onCancel: () => {},
      }),
    );
    expect(markup).toMatch(/^<dialog class="lf-drawer" aria-labelledby="[^"]+">/);
    expect(markup).toMatch(/required=""[^>]*aria-label="Visit date and time, date"/);
    expect(markup).toMatch(/type="time"[^>]*required[^>]*aria-label="Visit date and time, time"/);
    expect(markup).toMatch(/<select[^>]*name="projectId"[^>]*required/);
    expect(markup).toContain(`<option value="${marina.id}">Marina Heights</option>`);
  });
});
