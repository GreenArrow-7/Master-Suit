import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// The Targets page reads the session from the request's cookie, set per case.
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
import { PATCH as editActivity } from '@/app/api/v1/activities/[id]/route';
import { PATCH as finishCall } from '@/app/api/v1/calls/[id]/route';
import { PATCH as workRecord } from '@/app/api/v1/cold-data/[id]/route';
import { POST as convertRecord } from '@/app/api/v1/cold-data/[id]/convert/route';
import { GET as myTargets } from '@/app/api/v1/targets/my/route';
import { GET as readBoard } from '@/app/api/v1/targets/daily/route';
import { DELETE as deleteTarget, PATCH as patchTarget } from '@/app/api/v1/targets/[id]/route';
import { GET as listTargets, POST as createTarget } from '@/app/api/v1/targets/route';
import ColdDataPage from '@/app/(workspace)/[workspaceSlug]/sales/cold-data/page';
import TargetsPage from '@/app/(workspace)/[workspaceSlug]/sales/targets/page';
import TargetAdmin from '@/app/(workspace)/[workspaceSlug]/sales/targets/TargetAdmin';
import EntityDelete from '@/components/sales/EntityDelete';
import { DEFAULT_POLICY } from '@/services/hr/settings';
import { pendingLeadWork, validatePunch, workspaceTimezone } from '@/services/hr/attendance';
import { normalizePhone } from '@/services/leads/normalizePhone';
import { dailyBoard, dailyTargetShortfall } from '@/services/targets/dailyBoard';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createWorkspaceUser, grantPermissions, type Grants } from '../helpers/fixtures';
import { del, get, patch, post } from '../helpers/request';
import { createSessionToken } from '../helpers/session';

/**
 * A cold call is a logged call (Lead Eagle audit, M5-06). Working a cold record
 * — picking what the call found — writes an Activity on the record, audited,
 * and that call counts toward the daily calling target and the check-out gate
 * exactly as a call to a lead does. In a Lead-Eagle-only workspace an
 * administrator sets a 100-call daily target and the agent's 100 cold calls
 * meet it; at 99 the check-out is refused with the shortfall.
 */
const suffix = randomBytes(4).toString('hex');
const HQ = { latitude: 25.2048, longitude: 55.2708 };
const position = { ...HQ, gpsAccuracyM: 8 };
const targeted = { ...DEFAULT_POLICY, checkoutRequiresDailyTarget: true };
const QUOTA = 100;
let tenantId = '';
let admin: { id: string; cookie: string };
let agent: { id: string; cookie: string };
let teamLead: { id: string; cookie: string };
let outsider: { id: string; cookie: string };
let viewer: { id: string; cookie: string };
let employee: { id: string; employmentStatus: string };
let records: { id: string }[] = [];

const agentCtx = () => buildCtx(buildActor({ id: agent.id, tenantId }));
const leadsCalledToday = async () =>
  (await dailyBoard(agentCtx())).rows.find((r) => r.userId === agent.id)?.leadsCalled;
const work = (id: string, body: Record<string, unknown>, cookie = agent.cookie) =>
  patch(workRecord, `/api/v1/cold-data/${id}`, body, cookie, { id });
const callsOn = (dataRecordId: string) =>
  prisma.activity.findMany({
    where: { tenantId, dataRecordId },
    include: { type: true },
    orderBy: { createdAt: 'asc' },
  });
const achievedToday = async (cookie: string) => {
  const res = await get(myTargets, '/api/v1/targets/my', cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const target = (res.body.data as { metric: string; achieved: number; targetValue: number }[]).find(
    (t) => t.metric === 'LEADS_CALLED',
  );
  return target ? `${target.achieved}/${target.targetValue}` : null;
};

const elements = (node: unknown): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...elements(el.props.children)];
};
/**
 * The page's text, as a reader sees it: every string and number in the tree, in
 * order. The page's own `TargetCard` (a plain function) is rendered for its
 * text; client components stay as tags.
 */
const text = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  const el = node as ReactElement<{ children?: unknown }>;
  if (typeof el.type === 'function' && el.type.name === 'TargetCard') {
    return text((el.type as (props: unknown) => unknown)(el.props));
  }
  return text(el.props.children);
};
const targetsPage = async (cookie: string) => {
  cookieJar.value = cookie;
  return TargetsPage();
};

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `coldcall-${suffix}`, legalName: 'Cold Call LLC', displayName: 'Cold Call', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  // Lead Eagle alone: targets and the Targets page were Sales-only.
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  // A converted record lands in the default stage, as provisionLeadWork gives every lead module one.
  await prisma.leadStage.create({ data: { tenantId, key: 'new', name: 'New', position: 1, isDefault: true } });

  const role = async (key: string, scope: 'OWN' | 'TEAM' | 'ORGANIZATION', grants: Grants) => {
    const row = await prisma.role.create({
      data: {
        tenantId,
        key: `${key}-${suffix}`,
        name: key,
        rank: scope === 'ORGANIZATION' ? 0 : 50,
        defaultScope: scope,
      },
    });
    await grantPermissions(tenantId, row.id, grants, scope);
    return row.id;
  };
  const member = async (name: string, roleId: string) => {
    const user = await createWorkspaceUser({
      tenantId,
      roleId,
      email: `${name}-${suffix}@coldcall.test`,
      fullName: name,
    });
    return { id: user.id, membershipId: user.membershipId, cookie: await createSessionToken(tenantId, user.id) };
  };
  const all = ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'ASSIGN'] as const;
  // The board reads `reports:VIEW`; check-in times on it, `attendance` (employee:VIEW reads all).
  admin = await member(
    'Admin',
    await role('admin', 'ORGANIZATION', [
      ...all.map((a) => ['leads', a] as const),
      ['reports', 'VIEW'],
      ['employee', 'VIEW'],
    ]),
  );
  // Lead Eagle's starter Viewer: the whole desk's reports, its own attendance only.
  viewer = await member(
    'Viewer',
    await role('viewer', 'ORGANIZATION', [
      ['leads', 'VIEW'],
      ['reports', 'VIEW'],
    ]),
  );
  const agentRole = await role('agent', 'OWN', [
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
    ['leads', 'CREATE'],
    ['calls', 'VIEW'],
    ['calls', 'EDIT'],
  ]);
  const agentUser = await member('Agent', agentRole);
  agent = agentUser;
  outsider = await member('Outsider', agentRole);
  teamLead = await member(
    'Team Lead',
    await role(
      'team-lead',
      'TEAM',
      all.map((a) => ['leads', a] as const),
    ),
  );
  const team = await prisma.team.create({ data: { tenantId, name: 'Cold calling', code: `COLD-${suffix}` } });
  await prisma.userTeam.createMany({
    data: [teamLead.id, agent.id].map((userId) => ({ tenantId, userId, teamId: team.id })),
  });

  // The agent is an employee checked in at HQ, as checkout-work-gate.spec.ts sets one up.
  const profile = await prisma.employeeProfile.create({
    data: {
      tenantId,
      membershipId: agentUser.membershipId,
      employeeNumber: `CC-${suffix}`,
      employmentStatus: 'ACTIVE',
    },
  });
  employee = { id: profile.id, employmentStatus: profile.employmentStatus };
  const hq = await prisma.hrWorkLocation.create({
    data: { tenantId, name: `HQ ${suffix}`, ...HQ, radiusMeters: 150, status: 'ACTIVE' },
  });
  await prisma.hrEmployeeLocationAssignment.create({
    data: { tenantId, employeeId: profile.id, locationId: hq.id, status: 'ACTIVE', checkInAllowed: true },
  });
  await prisma.hrAttendancePunch.create({
    data: {
      tenantId,
      employeeId: profile.id,
      punchType: 'CHECK_IN',
      result: 'ACCEPTED',
      method: 'face',
      ...HQ,
      gpsAccuracyM: 8,
      deviceFingerprint: 'cold-device',
      locationId: hq.id,
    },
  });

  await prisma.dataRecord.createMany({
    data: Array.from({ length: QUOTA + 1 }, (_, n) => ({
      tenantId,
      fullName: `Cold ${n + 1}`,
      phone: `+97150${String(1000000 + n)}`,
      batch: 'Quota list',
      ownerId: agent.id,
    })),
  });
  records = await prisma.dataRecord.findMany({
    where: { tenantId, batch: 'Quota list' },
    select: { id: true },
    orderBy: { fullName: 'asc' },
  });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

let targetId = '';

describe('targets in a Lead-Eagle-only workspace', () => {
  it('the administrator sets the agent a daily target of 100 calls', async () => {
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    const res = await post(
      createTarget,
      '/api/v1/targets',
      {
        userId: agent.id,
        metric: 'LEADS_CALLED',
        period: 'DAILY',
        targetValue: QUOTA,
        periodStart: midnight.toISOString(),
        periodEnd: new Date(midnight.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
      },
      admin.cookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    targetId = res.body.id;
    expect(await achievedToday(agent.cookie)).toBe(`0/${QUOTA}`);
    expect(await dailyTargetShortfall(agentCtx(), agent.id)).toBe(QUOTA);
  });

  it('refuses a target that is not a whole number above zero (OWN-06.2)', async () => {
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    const day = {
      userId: agent.id,
      metric: 'LEADS_CALLED',
      period: 'DAILY',
      periodStart: midnight.toISOString(),
      periodEnd: new Date(midnight.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
    };
    for (const targetValue of [0, 2.5, -5]) {
      const res = await post(createTarget, '/api/v1/targets', { ...day, targetValue }, admin.cookie);
      expect(res.status, `${targetValue}: ${JSON.stringify(res.body)}`).toBe(422);
    }
    expect(await prisma.employeeTarget.count({ where: { tenantId, userId: agent.id } })).toBe(1);
  });
});

describe('a cold call is a logged call', () => {
  it('writes an outbound-call activity on the record, audited, with what the call found', async () => {
    const { id } = records[0]!;
    const res = await work(id, { status: 'INTERESTED', notes: 'Wants a viewing' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id, status: 'INTERESTED' });
    expect(await achievedToday(agent.cookie)).toBe(`1/${QUOTA}`);

    const [call, ...rest] = await callsOn(id);
    expect(rest).toEqual([]);
    expect(call).toMatchObject({
      ownerId: agent.id,
      leadId: null,
      outcome: 'INTERESTED',
      notes: 'Wants a viewing',
      type: { key: 'call_out' },
    });
    const audited = await prisma.auditLog.findFirst({
      where: { tenantId, event: 'RECORD_CREATED', objectType: 'activity', recordId: call!.id },
    });
    expect(audited).toMatchObject({ actorUserId: agent.id, metadata: { dataRecordId: id, outcome: 'INTERESTED' } });
  });

  it('a note alone, a hand-over, or resetting to Not contacted adds no call to a called record', async () => {
    const { id } = records[0]!;
    expect(await callsOn(id)).toHaveLength(1);
    expect((await work(id, { notes: 'Try after 5' })).status).toBe(200);
    expect((await work(id, { ownerId: agent.id }, admin.cookie)).status).toBe(200);
    expect((await work(id, { status: 'NOT_CONTACTED' })).status).toBe(200);
    expect(await callsOn(id)).toHaveLength(1);
    expect(await achievedToday(agent.cookie)).toBe(`1/${QUOTA}`);
  });

  it('a call outside the caller’s scope is not logged: the record answers as a missing one', async () => {
    const { id } = records[0]!;
    const res = await work(id, { status: 'NOT_INTERESTED' }, outsider.cookie);
    expect(res.status).toBe(404);
    expect(await callsOn(id)).toHaveLength(1);
    expect((await prisma.dataRecord.findFirstOrThrow({ where: { tenantId, id } })).status).toBe('NOT_CONTACTED');
  });
});

describe('a 100-call daily quota in a Lead-Eagle-only workspace', () => {
  it('at 99 calls the target reads 99/100 and the check-out is refused with the shortfall', async () => {
    // Record 1 was called above; 98 more, each a different record.
    for (const { id } of records.slice(1, QUOTA - 1)) {
      const res = await work(id, { status: 'NOT_REACHABLE' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    expect(await achievedToday(agent.cookie)).toBe(`${QUOTA - 1}/${QUOTA}`);
    expect(await dailyTargetShortfall(agentCtx(), agent.id)).toBe(1);
    await expect(validatePunch(agentCtx(), employee, 'CHECK_OUT', position, true, targeted)).rejects.toMatchObject({
      code: 'WORK_PENDING',
      message: expect.stringMatching(/calling target is 1 lead short/),
    });
  }, 120_000);

  it('a second call on a record already called today is a call, not a second lead', async () => {
    expect((await work(records[0]!.id, { status: 'NOT_REACHABLE' })).status).toBe(200);
    expect(await callsOn(records[0]!.id)).toHaveLength(2);
    expect(await achievedToday(agent.cookie)).toBe(`${QUOTA - 1}/${QUOTA}`);
    expect(await dailyTargetShortfall(agentCtx(), agent.id)).toBe(1);
  });

  it('the 100th call meets the target: 100/100, and the check-out goes through', async () => {
    expect((await work(records[QUOTA - 1]!.id, { status: 'INTERESTED' })).status).toBe(200);
    expect(await achievedToday(agent.cookie)).toBe(`${QUOTA}/${QUOTA}`);
    expect(await dailyTargetShortfall(agentCtx(), agent.id)).toBe(0);
    await expect(validatePunch(agentCtx(), employee, 'CHECK_OUT', position, true, targeted)).resolves.toBeTruthy();
  });

  it('counts a call on the day it was logged: editing its time moves it neither out of today nor into it', async () => {
    const [call] = await callsOn(records[1]!.id);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const edit = (id: string, occurredAt: Date) =>
      patch(editActivity, `/api/v1/activities/${id}`, { occurredAt: occurredAt.toISOString() }, agent.cookie, { id });
    expect((await edit(call!.id, yesterday)).status).toBe(200);
    expect(await leadsCalledToday()).toBe(QUOTA);
    // A call logged yesterday, dated today by hand, is still yesterday's.
    const old = await prisma.activity.create({
      data: {
        tenantId,
        typeId: call!.typeId,
        dataRecordId: records[QUOTA]!.id,
        ownerId: agent.id,
        outcome: 'NOT_REACHABLE',
        createdAt: yesterday,
        occurredAt: yesterday,
      },
    });
    expect((await edit(old.id, new Date())).status).toBe(200);
    expect(await leadsCalledToday()).toBe(QUOTA);
    expect(await dailyTargetShortfall(agentCtx(), agent.id)).toBe(0);
  });

  it('the Targets page opens under Lead Eagle and reads 100/100 for the agent and the administrator', async () => {
    expect(text(await targetsPage(agent.cookie))).toContain(`${QUOTA} done`);
    expect(text(await targetsPage(agent.cookie))).toContain('0 remaining');
    expect(text(await targetsPage(admin.cookie))).toContain(`${QUOTA} / ${QUOTA}`);
  });

  it('a team lead sets targets only for the team, and the page offers only the team', async () => {
    const body = (userId: string) => ({
      userId,
      metric: 'LEADS_CALLED',
      period: 'DAILY',
      targetValue: 5,
      periodStart: new Date().toISOString(),
      periodEnd: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const theirs = await post(createTarget, '/api/v1/targets', body(outsider.id), teamLead.cookie);
    expect(theirs.status).toBe(404);
    expect(await prisma.employeeTarget.count({ where: { tenantId, userId: outsider.id } })).toBe(0);
    const ours = await post(createTarget, '/api/v1/targets', body(agent.id), teamLead.cookie);
    expect(ours.status, JSON.stringify(ours.body)).toBe(200);

    const offered = elements(await targetsPage(teamLead.cookie)).find((el) => el.type === TargetAdmin)?.props.users as {
      id: string;
    }[];
    // Below ORGANIZATION, not themselves: their own target is their manager's to set.
    expect(offered.map((u) => u.id)).toEqual([agent.id]);
    // And the team's targets are listed, nobody else's.
    const page = text(await targetsPage(teamLead.cookie));
    expect(page).toContain('Agent');
    expect(page).not.toContain('Outsider');

    // A target outside the team cannot be removed by its id.
    const foreign = await prisma.employeeTarget.create({
      data: { ...body(outsider.id), tenantId, metric: 'LEADS_CALLED', period: 'DAILY' },
    });
    expect((await del(deleteTarget, `/api/v1/targets/${foreign.id}`, teamLead.cookie)).status).toBe(404);
    expect(await prisma.employeeTarget.count({ where: { tenantId, id: foreign.id } })).toBe(1);
    expect((await del(deleteTarget, `/api/v1/targets/${ours.body.id}`, teamLead.cookie)).status).toBe(200);
    expect((await del(deleteTarget, `/api/v1/targets/${targetId}`, admin.cookie)).status).toBe(200);
  });

  it('a team lead cannot set, lower or delete their own target, so the gate it feeds still holds', async () => {
    const day = {
      metric: 'LEADS_CALLED',
      period: 'DAILY',
      targetValue: 50,
      periodStart: new Date().toISOString(),
      periodEnd: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const shortfall = () => dailyTargetShortfall(buildCtx(buildActor({ id: teamLead.id, tenantId })), teamLead.id);
    const own = await post(createTarget, '/api/v1/targets', { ...day, userId: teamLead.id }, admin.cookie);
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(await shortfall()).toBe(50);

    const at = `/api/v1/targets/${own.body.id}`;
    expect(
      (await post(createTarget, '/api/v1/targets', { ...day, targetValue: 1, userId: teamLead.id }, teamLead.cookie))
        .status,
    ).toBe(404);
    expect((await patch(patchTarget, at, { targetValue: 1 }, teamLead.cookie)).status).toBe(404);
    expect((await del(deleteTarget, at, teamLead.cookie)).status).toBe(404);
    expect(
      await prisma.employeeTarget.findMany({
        where: { tenantId, userId: teamLead.id },
        select: { id: true, targetValue: true },
      }),
    ).toEqual([{ id: own.body.id, targetValue: 50 }]);
    expect(await shortfall()).toBe(50);
    // Their page reads it among their own, with no Delete beside it.
    const deletes = elements(await targetsPage(teamLead.cookie))
      .filter((el) => el.type === EntityDelete)
      .map((el) => el.props.endpoint);
    expect(deletes).not.toContain(at);

    // The administrator, at ORGANIZATION, removes it (audited) and may set their own.
    expect((await del(deleteTarget, at, admin.cookie)).status).toBe(200);
    expect(
      await prisma.auditLog.findFirst({ where: { tenantId, event: 'RECORD_DELETED', recordId: own.body.id } }),
    ).toMatchObject({ actorUserId: admin.id });
    const mine = await post(createTarget, '/api/v1/targets', { ...day, userId: admin.id }, admin.cookie);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    await prisma.employeeTarget.delete({ where: { tenantId, id: mine.body.id } });
  });

  it('lists and changes targets only within the caller’s scope, whoever ?userId= names', async () => {
    const theirs = await prisma.employeeTarget.create({
      data: {
        tenantId,
        userId: outsider.id,
        metric: 'LEADS_CALLED',
        period: 'DAILY',
        targetValue: 7,
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 3_600_000),
      },
    });
    const listed = async (cookie: string) =>
      ((await get(listTargets, `/api/v1/targets?userId=${outsider.id}`, cookie)).body.data as { id: string }[]).map(
        (t) => t.id,
      );
    expect(await listed(agent.cookie)).toEqual([]);
    expect(await listed(teamLead.cookie)).toEqual([]);
    expect(await listed(admin.cookie)).toContain(theirs.id);
    expect((await patch(patchTarget, `/api/v1/targets/${theirs.id}`, { targetValue: 1 }, teamLead.cookie)).status).toBe(
      404,
    );
    expect((await prisma.employeeTarget.findFirstOrThrow({ where: { tenantId, id: theirs.id } })).targetValue).toBe(7);
  });

  it('offers a Lead-Eagle-only workspace no Events metrics, which it could never count', async () => {
    const metrics = (
      elements(await targetsPage(admin.cookie)).find((el) => el.type === TargetAdmin)?.props.metrics as
        (readonly [string, string])[] | undefined
    )?.map(([metric]) => metric);
    expect(metrics).toContain('LEADS_CALLED');
    expect(metrics).not.toContain('INVITATIONS_SENT');
    expect(metrics).not.toContain('RSVPS_CONFIRMED');
  });
});

describe('making a lead of a called record', () => {
  it('carries its calls onto the lead, re-pointed not copied and audited, and the lead counts as worked', async () => {
    const { id } = records[0]!;
    const res = await post(convertRecord, `/api/v1/cold-data/${id}/convert`, {}, agent.cookie, { id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const leadId = res.body.leadId as string;

    const calls = await callsOn(id);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.leadId)).toEqual([leadId, leadId]);
    expect(await prisma.activity.count({ where: { tenantId, leadId, type: { key: 'call_out' } } })).toBe(2);
    // First contacted at the first of those calls (the Lead Eagle board's Untouched and Worked).
    const first = Math.min(...calls.map((c) => c.occurredAt.getTime()));
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: leadId } });
    expect(lead.firstContactedAt?.getTime()).toBe(first);
    const audited = await prisma.auditLog.findFirst({
      where: { tenantId, event: 'RECORD_UPDATED', objectType: 'lead', recordId: leadId },
    });
    expect(audited).toMatchObject({
      actorUserId: agent.id,
      metadata: { action: 'lead.cold_calls_attached', dataRecordId: id, calls: 2 },
    });
    // The calls were the work: the lead the agent just made does not hold them at check-out.
    expect(await pendingLeadWork(agentCtx(), await workspaceTimezone(agentCtx()))).toBe(0);
    // And the day still counts the record once.
    expect((await dailyBoard(agentCtx())).rows.find((r) => r.userId === agent.id)?.leadsCalled).toBe(QUOTA);
  });

  it('a call to that lead the same day is the same person: the day and the target count it once', async () => {
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    const target = await post(
      createTarget,
      '/api/v1/targets',
      {
        userId: agent.id,
        metric: 'LEADS_CALLED',
        period: 'DAILY',
        targetValue: 5,
        periodStart: midnight.toISOString(),
        periodEnd: new Date(midnight.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
      },
      admin.cookie,
    );
    expect(target.status, JSON.stringify(target.body)).toBe(200);
    const { convertedLeadId } = await prisma.dataRecord.findFirstOrThrow({ where: { tenantId, id: records[0]!.id } });
    const before = await leadsCalledToday();
    const call = await prisma.call.create({
      data: { tenantId, callerId: agent.id, leadId: convertedLeadId, status: 'IN_PROGRESS' },
    });
    const done = await patch(
      finishCall,
      `/api/v1/calls/${call.id}`,
      { status: 'COMPLETED', outcome: 'CONNECTED' },
      agent.cookie,
    );
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(await leadsCalledToday()).toBe(before);
    const progress = await prisma.targetProgress.findMany({ where: { tenantId, targetId: target.body.id } });
    expect(progress.reduce((sum, row) => sum + row.achieved, 0)).toBe(0);
  });

  it('into another agent’s lead: the calls follow the person onto it, though the caller cannot open it', async () => {
    const phone = normalizePhone('050 999 0777')!;
    const { id: stageId } = await prisma.leadStage.findFirstOrThrow({ where: { tenantId } });
    const theirs = await prisma.lead.create({
      data: {
        tenantId,
        reference: `THEIRS-${suffix}`,
        fullName: 'Their lead',
        phone,
        phoneNormalized: phone,
        stageId,
        ownerId: outsider.id,
      },
    });
    const record = await prisma.dataRecord.create({
      data: { tenantId, fullName: 'Known number', phone, batch: 'Known list', ownerId: agent.id },
    });
    expect((await work(record.id, { status: 'INTERESTED' })).status).toBe(200);
    const res = await post(convertRecord, `/api/v1/cold-data/${record.id}/convert`, {}, agent.cookie, {
      id: record.id,
    });
    expect(res.body).toEqual({ leadId: theirs.id, created: false, visible: false });
    expect((await callsOn(record.id)).map((c) => c.leadId)).toEqual([theirs.id]);
    expect(
      await prisma.auditLog.findFirst({
        // The lead also gets an "enquired again" row; ask for this one by its action.
        where: {
          tenantId,
          event: 'RECORD_UPDATED',
          objectType: 'lead',
          recordId: theirs.id,
          metadata: { path: ['action'], equals: 'lead.cold_calls_attached' },
        },
      }),
    ).toMatchObject({ actorUserId: agent.id, metadata: { action: 'lead.cold_calls_attached', calls: 1 } });
  });

  it('deleting a called record keeps its calls: once it is a lead they are the lead’s timeline', async () => {
    const record = await prisma.dataRecord.create({
      data: { tenantId, fullName: 'Short-lived', batch: 'Scratch list', ownerId: agent.id },
    });
    expect((await work(record.id, { status: 'NOT_REACHABLE' })).status).toBe(200);
    const [call] = await callsOn(record.id);
    await prisma.dataRecord.delete({ where: { tenantId, id: record.id } });
    expect(await prisma.activity.findFirst({ where: { tenantId, id: call!.id } })).toMatchObject({
      dataRecordId: null,
    });
  });
});

describe('the Cold Data screen at team scope', () => {
  it('shows a teammate’s number as a lead’s phone reads to the role; the agent dials their own', async () => {
    const screen = async (cookie: string) => {
      cookieJar.value = cookie;
      return ColdDataPage({ searchParams: Promise.resolve({ list: 'Quota list' }) });
    };
    const dialled = (tree: unknown) =>
      elements(tree)
        .filter((el) => el.type === 'a')
        .map((el) => el.props.href);
    const { phone } = await prisma.dataRecord.findFirstOrThrow({ where: { tenantId, id: records[QUOTA]!.id } });
    // The team lead's role lacks leads:VIEW_SENSITIVE_FIELDS.
    const lead = await screen(teamLead.cookie);
    expect(text(lead)).toContain('Cold');
    expect(text(lead)).not.toContain(phone!);
    expect(dialled(lead)).not.toContain(`tel:${phone}`);
    expect(dialled(await screen(agent.cookie))).toContain(`tel:${phone}`);
  });
});

describe('check-in times on the daily board', () => {
  it('follow the viewer’s attendance access: the administrator reads the agent’s, a reports viewer does not', async () => {
    await prisma.hrAttendanceRecord.create({
      data: { tenantId, employeeId: employee.id, workDate: new Date(), checkInAt: new Date() },
    });
    const agentRow = async (cookie: string) => {
      const res = await get(readBoard, '/api/v1/targets/daily', cookie, {});
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body.rows as { userId: string; checkInAt: string | null }[]).find((r) => r.userId === agent.id);
    };
    expect((await agentRow(admin.cookie))?.checkInAt).toBeTruthy();
    const seen = await agentRow(viewer.cookie);
    expect(seen).toBeDefined();
    expect(seen?.checkInAt).toBeNull();
  });
});
