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
  return { id: user.id, roleId: role.id, cookie: await createSessionToken(tenantId, user.id) };
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
      // When it happened: not ahead, and within the last week.
      { outcome: 'Connected', occurredAt: new Date(Date.now() + 3_600_000).toISOString() },
      { outcome: 'Connected', occurredAt: new Date(Date.now() - 8 * 86_400_000).toISOString() },
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

  it('a send repeated under its Idempotency-Key is checked before it is replayed', async () => {
    const leadId = (
      await prisma.lead.create({
        data: {
          tenantId,
          reference: `CL-${randomBytes(3).toString('hex')}`,
          fullName: 'Outbox Lead',
          stageId: fixture.a.stageId,
          ownerId: agentId,
        },
      })
    ).id;
    // As lib/offline.ts sends it: the outbox item's id in the header, beside any body key.
    const send = async (body: Record<string, unknown>, key: string) => {
      const res = await logCall(
        new Request(`http://localhost${url(leadId)}`, {
          method: 'POST',
          headers: { cookie: agent, 'content-type': 'application/json', 'idempotency-key': key },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: leadId }) },
      );
      return { status: res.status, body: await res.json() };
    };
    const queued = { outcome: 'Connected', requestKey: randomUUID() };
    const outboxItem = randomUUID();
    const first = await send(queued, outboxItem);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect((await send(queued, outboxItem)).body.activity.id).toBe(first.body.activity.id);
    // The header alone (an API client) still keeps a repeat to one call.
    const headerOnly = randomUUID();
    const byHeader = await send({ outcome: 'No answer' }, headerOnly);
    expect((await send({ outcome: 'No answer' }, headerOnly)).body.activity.id).toBe(byHeader.body.activity.id);
    expect(await calls(leadId)).toHaveLength(2);

    // The lead moved to another owner: both repeats answer 404, not their first answers.
    await prisma.lead.updateMany({ where: { tenantId, id: leadId }, data: { ownerId: fixture.a.userId } });
    expect((await send(queued, outboxItem)).status).toBe(404);
    expect((await send({ outcome: 'No answer' }, headerOnly)).status).toBe(404);
    expect(await calls(leadId)).toHaveLength(2);
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

  it('offers Log call only on the leads its route takes: a role that reads further than it edits', async () => {
    const reacher = await roleUser('reacher', [['leads', 'VIEW']], 'ORGANIZATION');
    await grantPermissions(tenantId, reacher.roleId, [['leads', 'EDIT']], 'OWN');
    const lead = (fullName: string, data: { ownerId?: string | null; secondaryOwnerId?: string }) =>
      prisma.lead.create({
        data: {
          tenantId,
          reference: `CL-${randomBytes(3).toString('hex')}`,
          fullName,
          stageId: fixture.a.stageId,
          ...data,
        },
      });
    const [own, second, pool, other] = await Promise.all([
      lead('Reach own', { ownerId: reacher.id }),
      lead('Reach second', { ownerId: fixture.a.userId, secondaryOwnerId: reacher.id }),
      lead('Reach pool', { ownerId: null }),
      lead('Reach other', { ownerId: fixture.a.userId }),
    ]);

    cookieJar.value = reacher.cookie;
    try {
      const grid = propsWith(await LeadsPage({ searchParams: Promise.resolve({}) }), 'emptyLabel')!;
      const canLog = (id: string) => grid.rows.find((r: { id: string }) => r.id === id)?.canLog;
      expect([own, second, pool, other].map((l) => canLog(l.id))).toEqual([true, true, true, false]);
      // No second owner's id leaves the server with the row.
      expect(JSON.stringify(grid.rows)).not.toContain('secondaryOwnerId');

      const page = async (id: string) =>
        propsWith(await LeadDetailPage({ params: Promise.resolve({ id }) }), 'canLog')?.canLog;
      expect(await page(other.id)).toBe(false);
      expect(await page(second.id)).toBe(true);
    } finally {
      cookieJar.value = admin;
    }
    // And the route agrees.
    expect((await post(logCall, url(other.id), { outcome: 'Connected' }, reacher.cookie)).status).toBe(404);
    expect((await post(logCall, url(second.id), { outcome: 'Connected' }, reacher.cookie)).status).toBe(200);
  });
});

/** The props of the first element in a rendered tree that has `key`. */
function propsWith(node: unknown, key: string): Record<string, any> | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = propsWith(child, key);
      if (found) return found;
    }
    return undefined;
  }
  const props = (node as { props?: Record<string, any> }).props;
  if (!props) return undefined;
  return key in props ? props : propsWith(props.children, key);
}

describe('a call the phone app logged by itself (M9-09)', () => {
  const newLead = async (ownerId: string) =>
    (
      await prisma.lead.create({
        data: {
          tenantId,
          reference: `CW-${randomBytes(3).toString('hex')}`,
          fullName: 'Watched Lead',
          stageId: fixture.a.stageId,
          ownerId,
        },
      })
    ).id;

  it('keeps the measured talk time, and a correction rewrites that call rather than adding one', async () => {
    const leadId = await newLead(fixture.a.userId);
    const startedAt = new Date(Date.now() - 10 * 60_000);
    const auto = await post(
      logCall,
      url(leadId),
      { outcome: 'Connected', durationSecs: 125, occurredAt: startedAt.toISOString(), requestKey: randomUUID() },
      admin,
    );
    expect(auto.status, JSON.stringify(auto.body)).toBe(200);
    const activityId = auto.body.activity.id;
    expect(await calls(leadId)).toEqual([
      expect.objectContaining({ id: activityId, outcome: 'Connected', durationSecs: 125, occurredAt: startedAt }),
    ]);

    // Edit from the notice: what happened, a note, the next follow-up; the minutes left as measured.
    const edit = await post(
      logCall,
      url(leadId),
      {
        outcome: 'Call back later',
        notes: 'Driving, call tonight',
        activityId,
        followUpAt: '2027-01-14T10:00',
        occurredAt: new Date().toISOString(),
        requestKey: randomUUID(),
      },
      admin,
    );
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const [call, ...more] = await calls(leadId);
    expect(more).toHaveLength(0);
    expect(call).toMatchObject({
      id: activityId,
      outcome: 'Call back later',
      notes: 'Driving, call tonight',
      durationSecs: 125,
      occurredAt: startedAt,
    });
    expect(await followUps(leadId)).toEqual([expect.objectContaining({ id: edit.body.followUp.id })]);
    expect(
      await prisma.auditLog.findFirst({
        where: { tenantId, objectType: 'activity', recordId: activityId, event: 'RECORD_UPDATED' },
      }),
    ).toMatchObject({ metadata: expect.objectContaining({ leadId, outcome: 'Call back later' }) });

    // Minutes typed in the correction are taken.
    expect(
      (await post(logCall, url(leadId), { outcome: 'Connected', durationMins: 3, activityId }, admin)).status,
    ).toBe(200);
    expect(await calls(leadId)).toEqual([expect.objectContaining({ id: activityId, durationSecs: 180 })]);
  });

  it("corrects only the caller's own call on that lead: another's, or one on another lead, answers 404 and is left alone", async () => {
    const leadId = await newLead(agentId);
    const agents = await post(logCall, url(leadId), { outcome: 'No answer' }, agent);
    expect(agents.status, JSON.stringify(agents.body)).toBe(200);
    const activityId = agents.body.activity.id;

    // The admin reaches the lead, but the call is the agent's.
    const theirs = { outcome: 'Connected', activityId, followUpAt: '2027-01-15T10:00' };
    expect((await post(logCall, url(leadId), theirs, admin)).status).toBe(404);
    // The agent's own call, named on another of its leads.
    expect((await post(logCall, url(agentLeadId), { outcome: 'Connected', activityId }, agent)).status).toBe(404);

    expect(await calls(leadId)).toEqual([expect.objectContaining({ id: activityId, outcome: 'No answer' })]);
    expect(await followUps(leadId)).toEqual([]);

    // The call is checked before a replay: once it is gone, its correction's key answers 404, not the old answer.
    const again = { outcome: 'Connected', activityId, requestKey: randomUUID() };
    expect((await post(logCall, url(leadId), again, agent)).status).toBe(200);
    await prisma.activity.updateMany({ where: { tenantId, id: activityId }, data: { deletedAt: new Date() } });
    expect((await post(logCall, url(leadId), again, agent)).status).toBe(404);
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

describe("done follow-ups follow the viewer's reach (M4-47)", () => {
  it("an OWN agent sees its own follow-ups on its lead, never a colleague's open or done work there", async () => {
    const done = new Date('2026-10-02T06:00:00.000Z');
    const followUp = (ownerId: string, title: string, completed: boolean) =>
      prisma.followUpTask.create({
        data: {
          tenantId,
          leadId: agentLeadId,
          ownerId,
          title,
          dueAt: new Date('2027-04-01T06:00:00.000Z'),
          ...(completed && { status: 'COMPLETED' as const, completedAt: done }),
        },
      });
    await followUp(agentId, 'Agent done follow-up', true);
    await followUp(fixture.a.userId, 'Admin done follow-up', true);
    await followUp(fixture.a.userId, 'Admin open follow-up', false);
    const taskType = await prisma.taskType.create({
      data: { tenantId, key: `own-${randomBytes(3).toString('hex')}`, name: 'Visit' },
    });
    await prisma.task.create({
      data: {
        tenantId,
        leadId: agentLeadId,
        typeId: taskType.id,
        ownerId: fixture.a.userId,
        title: 'Admin done task',
        dueAt: done,
        status: 'COMPLETED',
        completedAt: done,
      },
    });

    cookieJar.value = agent;
    try {
      const text = await pageText(LeadDetailPage({ params: Promise.resolve({ id: agentLeadId }) }));
      expect(text).toContain('Agent done follow-up');
      expect(text).toContain('02 Oct 2026, 10:00');
      for (const theirs of ['Admin done follow-up', 'Admin open follow-up', 'Admin done task']) {
        expect(text).not.toContain(theirs);
      }
    } finally {
      cookieJar.value = admin;
    }
  });
});
