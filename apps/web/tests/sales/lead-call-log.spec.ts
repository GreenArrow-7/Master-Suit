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

import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as logCall } from '@/app/api/v1/leads/[id]/call-log/route';
import { PATCH as editFollowUp } from '@/app/api/v1/follow-ups/[id]/route';
import LeadDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import LeadsPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/page';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { pageText } from '../helpers/render';
import { patch, post } from '../helpers/request';

/**
 * The one-step call log (Lead Eagle audit rows PROP-02.2 and M4-27): one POST
 * writes the call, what it found and a note, and books the next follow-up on
 * the workspace's clock, in one transaction, audited, under the lead's own
 * scope. And the lead keeps its done follow-ups in view (M4-47).
 */
let fixture: Fixture;
let tenantId: string;
let admin: string;
/** `leads:VIEW` and `EDIT` at OWN: reaches only the lead it owns. */
let agent: string;
let agentId: string;
let agentLeadId: string;
/** `leads:VIEW` and `EDIT` across the workspace, without the sensitive fields: sees numbers masked. */
let masked: string;

const PHONE = '+971501234567';
const url = (id: string) => `/api/v1/leads/${id}/call-log`;
const calls = (leadId: string) => prisma.activity.findMany({ where: { tenantId, leadId }, include: { type: true } });
const followUps = (leadId: string) =>
  prisma.followUpTask.findMany({ where: { tenantId, leadId }, orderBy: { createdAt: 'asc' } });

async function roleUser(key: string, grants: Parameters<typeof grantPermissions>[2], scope: 'OWN' | 'ORGANIZATION') {
  const suffix = randomBytes(4).toString('hex');
  const role = await prisma.role.create({ data: { tenantId, key: `${key}-${suffix}`, name: key, rank: 80 } });
  await grantPermissions(tenantId, role.id, grants, scope);
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `${key}-${suffix}@a.test`,
    fullName: `The ${key}`,
  });
  return { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  admin = fixture.a.cookie;
  cookieJar.value = admin;
  await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: 'Asia/Dubai' } });
  await prisma.lead.updateMany({ where: { tenantId }, data: { phone: PHONE, phoneNormalized: PHONE } });

  const own = await roleUser(
    'agent',
    [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
    ],
    'OWN',
  );
  agent = own.cookie;
  agentId = own.id;
  agentLeadId = (
    await prisma.lead.create({
      data: {
        tenantId,
        reference: `CL-${randomBytes(3).toString('hex')}`,
        fullName: 'Agent Lead',
        stageId: fixture.a.stageId,
        ownerId: agentId,
      },
    })
  ).id;
  masked = (
    await roleUser(
      'masked',
      [
        ['leads', 'VIEW'],
        ['leads', 'EDIT'],
      ],
      'ORGANIZATION',
    )
  ).cookie;
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('one POST logs the call and books the next follow-up (PROP-02.2, M4-27)', () => {
  it('writes the call, its follow-up on the workspace clock, the score and both audit rows', async () => {
    const leadId = fixture.a.leadIds[0]!;
    await prisma.lead.update({ where: { tenantId, id: leadId }, data: { score: 10 } });

    const res = await post(
      logCall,
      url(leadId),
      {
        outcome: 'Call back later',
        notes: 'Asked for Sunday morning',
        durationMins: 4,
        followUpAt: '2027-01-10T10:00',
      },
      admin,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const [call, ...moreCalls] = await calls(leadId);
    expect(moreCalls).toHaveLength(0);
    expect(call).toMatchObject({
      id: res.body.activity.id,
      outcome: 'Call back later',
      notes: 'Asked for Sunday morning',
      durationSecs: 240,
      ownerId: fixture.a.userId,
    });
    // An outbound call, the type the cold-call log and the move tool use.
    expect(call!.type).toMatchObject({ key: 'call_out', scoreDelta: 3 });

    const [followUp, ...moreFollowUps] = await followUps(leadId);
    expect(moreFollowUps).toHaveLength(0);
    expect(followUp).toMatchObject({
      id: res.body.followUp.id,
      ownerId: fixture.a.userId,
      status: 'OPEN',
      title: 'Follow-up call',
      description: 'Asked for Sunday morning',
    });
    // 10:00 on the workspace's clock: Dubai is four hours ahead of UTC.
    expect(followUp!.dueAt.toISOString()).toBe('2027-01-10T06:00:00.000Z');

    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: leadId } });
    // The type's points, as a call logged from the timeline moves them (M4-11).
    expect(lead.score).toBe(13);
    expect(lead.nextFollowUpAt?.toISOString()).toBe('2027-01-10T06:00:00.000Z');
    expect(lead.lastActivityAt).not.toBeNull();
    expect(await prisma.leadScoreHistory.findFirst({ where: { tenantId, leadId } })).toMatchObject({
      activityId: call!.id,
      delta: 3,
    });

    expect(
      await prisma.auditLog.findFirst({ where: { tenantId, objectType: 'activity', recordId: call!.id } }),
    ).toMatchObject({
      event: 'RECORD_CREATED',
      metadata: expect.objectContaining({ leadId, outcome: 'Call back later' }),
    });
    expect(
      await prisma.auditLog.findFirst({ where: { tenantId, objectType: 'follow-up', recordId: followUp!.id } }),
    ).toMatchObject({ event: 'RECORD_CREATED', metadata: expect.objectContaining({ leadId }) });
  });

  it('logs the call alone when no follow-up is asked for', async () => {
    const leadId = fixture.a.leadIds[1]!;
    const res = await post(logCall, url(leadId), { outcome: 'No answer' }, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.followUp).toBeNull();
    expect(await calls(leadId)).toEqual([expect.objectContaining({ outcome: 'No answer', notes: null })]);
    expect(await followUps(leadId)).toEqual([]);
  });

  it('refuses an outcome it does not offer and a follow-up that is not a time, writing nothing', async () => {
    const leadId = fixture.a.leadIds[2]!;
    for (const body of [
      { outcome: 'Went great' },
      { outcome: 'Connected', followUpAt: 'tomorrow' },
      { outcome: 'Connected', followUpAt: '2027-02-30T10:00' },
      { outcome: 'Connected', durationMins: -1 },
    ]) {
      expect((await post(logCall, url(leadId), body, admin)).status, JSON.stringify(body)).toBe(422);
    }
    expect(await calls(leadId)).toEqual([]);
    expect(await followUps(leadId)).toEqual([]);
  });

  it('a send repeated with the same request key is one call and one follow-up', async () => {
    const leadId = fixture.a.leadIds[3]!;
    const body = { outcome: 'Interested', followUpAt: '2027-01-11T09:30', requestKey: randomUUID() };
    const first = await post(logCall, url(leadId), body, admin);
    const again = await post(logCall, url(leadId), body, admin);
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body.activity.id).toBe(first.body.activity.id);
    expect(await calls(leadId)).toHaveLength(1);
    expect(await followUps(leadId)).toHaveLength(1);
  });

  it("follows the lead's scope: another's lead or workspace answers 404, a view-only role 403, and nothing is written", async () => {
    const othersLead = fixture.a.leadIds[4]!;
    expect((await post(logCall, url(othersLead), { outcome: 'Connected' }, agent)).status).toBe(404);
    expect(
      (await post(logCall, url(fixture.b.leadIds[0]!), { outcome: 'Connected', followUpAt: '2027-01-10T10:00' }, admin))
        .status,
    ).toBe(404);
    expect(await calls(othersLead)).toEqual([]);
    expect(await prisma.activity.count({ where: { tenantId: fixture.b.tenantId } })).toBe(0);

    const viewer = await roleUser('viewer', [['leads', 'VIEW']], 'ORGANIZATION');
    expect((await post(logCall, url(othersLead), { outcome: 'Connected' }, viewer.cookie)).status).toBe(403);
    expect(await calls(othersLead)).toEqual([]);

    // Its own lead: the call and the follow-up are the agent's.
    const own = await post(logCall, url(agentLeadId), { outcome: 'Connected', followUpAt: '2027-01-12T16:00' }, agent);
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(await followUps(agentLeadId)).toEqual([expect.objectContaining({ ownerId: agentId })]);
  });

  it('a role that sees numbers masked logs a call without the number ever being handed back', async () => {
    const leadId = fixture.a.leadIds[4]!;
    const res = await post(logCall, url(leadId), { outcome: 'Busy', followUpAt: '2027-01-13T11:00' }, masked);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('501234567');

    // The list it logs from shows the number masked, so there is nothing to dial.
    cookieJar.value = masked;
    try {
      const text = await pageText(LeadsPage({ searchParams: Promise.resolve({}) }));
      expect(text).not.toContain(PHONE);
      expect(text).toContain('•');
    } finally {
      cookieJar.value = admin;
    }
  });
});

describe('done follow-ups stay on the lead (M4-47)', () => {
  it('lists the open follow-ups beside the open tasks, and the last 10 done with when, on the workspace clock', async () => {
    const leadId = fixture.a.leadIds[0]!;
    const taskType = await prisma.taskType.create({ data: { tenantId, key: 'call', name: 'Call' } });
    // Eleven tasks done on 1 to 11 October at 20:30 UTC: 00:30 the next day in Dubai.
    for (let day = 1; day <= 11; day++) {
      await prisma.task.create({
        data: {
          tenantId,
          leadId,
          typeId: taskType.id,
          ownerId: fixture.a.userId,
          title: `Done task ${day}`,
          dueAt: new Date(Date.UTC(2026, 9, day, 8)),
          status: 'COMPLETED',
          completedAt: new Date(Date.UTC(2026, 9, day, 20, 30)),
        },
      });
    }
    await prisma.task.create({
      data: {
        tenantId,
        leadId,
        typeId: taskType.id,
        ownerId: fixture.a.userId,
        title: 'Still to do',
        dueAt: new Date('2027-02-01T08:00:00Z'),
      },
    });
    // The follow-up the call log booked, completed from the lead page.
    const [booked] = await followUps(leadId);
    const done = await patch(editFollowUp, `/api/v1/follow-ups/${booked!.id}`, { status: 'COMPLETED' }, admin);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    // And a new one, still open.
    await post(logCall, url(leadId), { outcome: 'Connected', followUpAt: '2027-03-01T15:00' }, admin);

    const text = await pageText(LeadDetailPage({ params: Promise.resolve({ id: leadId }) }));
    // Open: the task and the new follow-up, due 15:00 in Dubai.
    expect(text).toContain('Still to do');
    expect(text).toContain('01 Mar 2027, 15:00');
    // Done: the follow-up just completed and the nine newest tasks, newest first.
    expect(text).toContain('Done task 11');
    expect(text).toContain('Done task 3');
    expect(text).not.toContain('Done task 2');
    expect(text).not.toContain('Done task 1\n');
    expect(text).toContain('12 Oct 2026, 00:30');
    expect(text).toContain('04 Oct 2026, 00:30');
    expect(text).not.toContain('03 Oct 2026, 00:30');
    const completedAt = (await prisma.followUpTask.findFirstOrThrow({ where: { tenantId, id: booked!.id } }))
      .completedAt!;
    expect(text).toContain(
      completedAt.toLocaleString('en-GB', {
        timeZone: 'Asia/Dubai',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    );
  });
});
