// The screens read the session from the request.
const jar = vi.hoisted(() => ({ cookie: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: jar.cookie, 'x-pathname': '/' }),
  cookies: async () => ({
    get: (name: string) => {
      const match = jar.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? { name, value: match[1] } : undefined;
    },
  }),
}));

import { randomBytes, randomUUID } from 'node:crypto';
import type { ReactElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { resolveCtx } from '@/lib/auth/session';
import { leadTimeline } from '@/services/leads/timeline';
import { runReport } from '@/services/leadership/reports';
import { GET as reportApi } from '@/app/api/v1/reports/route';
import { POST as logCall } from '@/app/api/v1/leads/[id]/call-log/route';
import CallsPage from '@/app/(workspace)/[workspaceSlug]/sales/calls/page';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { leadEagleWorkspace } from '../helpers/leadSource';
import { post } from '../helpers/request';
import { strings } from '../helpers/render';

/**
 * Telephony in Lead Eagle (audit rows M9-02, M9-03, M9-05, M9-07): a vendor's
 * calls on the lead's timeline with the way to their recording, the Calls list
 * narrowed to one lead or to the recorded calls, the post-call log writing onto
 * the vendor's call, and a per-agent call report.
 */
const ctxFrom = (cookie: string) => resolveCtx(new Request('http://internal/', { headers: { cookie } }), 'vitest');
const tag = () => randomBytes(3).toString('hex');

let ws: Awaited<ReturnType<typeof leadEagleWorkspace>>;
let tenantId: string;
let agentA: string;
let agentB: string;
let leadId: string;
let otherLeadId: string;
const ids: Record<string, string> = {};

const elements = (node: unknown): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  return [el, ...elements(el.props.children)];
};
async function callsListed(searchParams: Record<string, string>) {
  jar.cookie = ws.cookie;
  const tree = elements(await CallsPage({ searchParams: Promise.resolve(searchParams) }));
  const grid = tree.find((el) => el.type === ConfigurableGrid);
  return { tree, rows: ((grid?.props.rows ?? []) as { id: string }[]).map((row) => row.id) };
}

async function agent(name: string) {
  const role = await prisma.role.create({ data: { tenantId, key: `agent-${tag()}`, name: 'Agent', rank: 50 } });
  const user = await createWorkspaceUser({ tenantId, roleId: role.id, email: `${tag()}@calls.test`, fullName: name });
  return user.id;
}
const call = (data: Omit<Prisma.CallUncheckedCreateInput, 'tenantId'>) =>
  prisma.call.create({ data: { tenantId, providerName: 'twilio', externalCallId: `CA${tag()}`, ...data } });

beforeAll(async () => {
  ws = await leadEagleWorkspace('calls', [
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
    ['leads', 'VIEW_SENSITIVE_FIELDS'],
    ['calls', 'VIEW'],
    ['calls', 'EDIT'],
    ['reports', 'VIEW'],
    ['reports', 'EXPORT'],
  ]);
  tenantId = ws.tenantId;
  await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: 'Asia/Dubai' } });
  agentA = await agent('Agent Alpha');
  agentB = await agent('Agent Bravo');
  const stage = await prisma.leadStage.findFirstOrThrow({ where: { tenantId, isDefault: true } });
  const lead = (fullName: string) =>
    prisma.lead.create({
      data: { tenantId, reference: `L-${tag()}`, fullName, stageId: stage.id, ownerId: agentA },
    });
  leadId = (await lead('Timeline Lead')).id;
  otherLeadId = (await lead('Other Lead')).id;

  // On the lead: an answered inbound call with its recording in our bucket, a
  // missed outbound one, and one whose recording is still only at the vendor.
  ids.recorded = (
    await call({
      leadId,
      callerId: agentA,
      direction: 'INBOUND',
      status: 'COMPLETED',
      outcome: 'CONNECTED',
      durationSecs: 125,
      talkSecs: 110,
      recording: {
        create: { tenantId, storageKey: `recordings/${tenantId}/x.mp3`, storageBucket: null, mimeType: 'audio/mpeg' },
      },
      consent: { create: { tenantId, consentGiven: true } },
    })
  ).id;
  ids.missed = (await call({ leadId, callerId: agentA, status: 'MISSED', outcome: 'NO_ANSWER' })).id;
  ids.pending = (
    await call({
      leadId,
      callerId: agentA,
      status: 'COMPLETED',
      durationSecs: 30,
      recording: { create: { tenantId, storageKey: 'https://api.twilio.com/rec/RE1.mp3', storageBucket: 'provider' } },
    })
  ).id;
  ids.other = (await call({ leadId: otherLeadId, callerId: agentB, status: 'COMPLETED', durationSecs: 40 })).id;
});

afterAll(async () => {
  await ws?.cleanup();
});

describe("a lead's timeline lists the provider's calls (M9-03)", () => {
  it('with direction, outcome and duration, and the way to a recording once it is ours to play', async () => {
    const page = await leadTimeline(await ctxFrom(ws.cookie), leadId);
    const entry = (id: string) => page.entries.find((e) => e.key === `call:${id}`);
    expect(entry(ids.recorded!)).toMatchObject({
      title: 'Incoming call',
      detail: 'Connected · 2 min',
      by: 'Agent Alpha',
      link: { href: `/calls/${ids.recorded}`, label: 'Play recording' },
    });
    expect(entry(ids.missed!)).toMatchObject({
      title: 'Outgoing call',
      detail: 'No answer',
      link: { href: `/calls/${ids.missed}`, label: 'Open call' },
    });
    // Still on the vendor's servers: nothing to play yet.
    expect(entry(ids.pending!)?.link).toEqual({ href: `/calls/${ids.pending}`, label: 'Open call' });
    expect(entry(ids.other!)).toBeUndefined();
  });
});

describe('the Calls list (M9-03, M9-07)', () => {
  it("narrows to one lead's calls, names it, and keeps it on every tab", async () => {
    const { tree, rows } = await callsListed({ lead: leadId });
    expect(rows.sort()).toEqual([ids.recorded, ids.missed, ids.pending].sort());
    const hint = tree.find((el) => el.props['data-lead-filter'] !== undefined);
    expect(strings(hint).join(' ')).toContain('Timeline Lead');
    const tabs = tree.filter((el) => el.props.role === 'tab').map((el) => String(el.props.href));
    expect(tabs.length).toBeGreaterThan(1);
    for (const href of tabs) expect(href).toContain(`lead=${leadId}`);
  });

  it('lists the calls with a recording to play under Recorded', async () => {
    const { rows } = await callsListed({ tab: 'recorded' });
    expect(rows).toEqual([ids.recorded]);
  });

  it('ignores a lead id that is not one', async () => {
    const { rows } = await callsListed({ lead: 'not-an-id' });
    expect(rows).toHaveLength(4);
  });

  it('leaves out a recording whose consent was withdrawn, which the media route refuses to play', async () => {
    const withdrawn = await call({
      leadId,
      callerId: ws.userId,
      status: 'COMPLETED',
      recording: {
        create: { tenantId, storageKey: `recordings/${tenantId}/w.mp3`, storageBucket: null, mimeType: 'audio/mpeg' },
      },
      consent: { create: { tenantId, consentGiven: true, withdrawnAt: new Date() } },
    });
    expect((await callsListed({ tab: 'recorded' })).rows).toEqual([ids.recorded]);
    const page = await leadTimeline(await ctxFrom(ws.cookie), leadId);
    expect(page.entries.find((e) => e.key === `call:${withdrawn.id}`)?.link?.label).toBe('Open call');
  });
});

describe('the post-call log on a provider call (M9-02)', () => {
  const url = (id: string) => `/api/v1/leads/${id}/call-log`;

  it('writes the outcome onto the call and books the follow-up, logging no second call', async () => {
    const placed = await call({ leadId, callerId: agentA, status: 'COMPLETED', durationSecs: 70 });
    const before = await prisma.activity.count({ where: { tenantId, leadId } });
    const body = {
      callId: placed.id,
      outcome: 'Call back later',
      notes: 'Wants the payment plan',
      followUpAt: '2027-01-11T09:30',
      requestKey: randomUUID(),
    };
    const res = await post(logCall, url(leadId), body, ws.cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await prisma.call.findFirstOrThrow({ where: { tenantId, id: placed.id } })).toMatchObject({
      outcome: 'CALLBACK_REQUESTED',
      notes: 'Wants the payment plan',
      durationSecs: 70,
    });
    expect(await prisma.activity.count({ where: { tenantId, leadId } })).toBe(before);
    const followUp = await prisma.followUpTask.findFirstOrThrow({ where: { tenantId, leadId } });
    // 09:30 in Dubai, and on the call's page as booked from it.
    expect(followUp.dueAt.toISOString()).toBe('2027-01-11T05:30:00.000Z');
    expect(followUp.callId).toBe(placed.id);
    expect(
      await prisma.auditLog.count({
        where: { tenantId, objectType: 'call', recordId: placed.id, event: 'RECORD_UPDATED' },
      }),
    ).toBe(1);

    // The same send again is the same log.
    expect((await post(logCall, url(leadId), body, ws.cookie)).status).toBe(200);
    expect(await prisma.followUpTask.count({ where: { tenantId, leadId } })).toBe(1);
  });

  it('keeps the notes taken during the call, the dialog’s note after them', async () => {
    const placed = await call({ leadId, callerId: ws.userId, status: 'COMPLETED', notes: 'Budget 2M, spouse decides' });
    const res = await post(
      logCall,
      url(leadId),
      { callId: placed.id, outcome: 'Interested', notes: 'Call Tuesday' },
      ws.cookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await prisma.call.findFirstOrThrow({ where: { tenantId, id: placed.id } })).notes).toBe(
      'Budget 2M, spouse decides\nCall Tuesday',
    );
  });

  it('refuses a role without calls:EDIT, even on its own call, writing nothing', async () => {
    const role = await prisma.role.create({ data: { tenantId, key: `rep-${tag()}`, name: 'Rep', rank: 60 } });
    await grantPermissions(tenantId, role.id, [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
    ]);
    const rep = await createWorkspaceUser({ tenantId, roleId: role.id, email: `${tag()}@calls.test`, fullName: 'Rep' });
    const own = await call({ leadId, callerId: rep.id, direction: 'INBOUND', status: 'MISSED', outcome: 'NO_ANSWER' });
    const res = await post(
      logCall,
      url(leadId),
      { callId: own.id, outcome: 'Interested' },
      await createSessionToken(tenantId, rep.id),
    );
    expect(res.status).toBe(404);
    expect((await prisma.call.findFirstOrThrow({ where: { tenantId, id: own.id } })).outcome).toBe('NO_ANSWER');
  });

  it("refuses a call that is not this lead's, writing nothing", async () => {
    const res = await post(logCall, url(leadId), { callId: ids.other, outcome: 'Connected' }, ws.cookie);
    expect(res.status).toBe(404);
    expect((await prisma.call.findFirstOrThrow({ where: { tenantId, id: ids.other! } })).outcome).toBeNull();
  });
});

describe('the call performance report (M9-05)', () => {
  const range = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 60_000) };

  beforeAll(async () => {
    // Agent Bravo: one connected call, one logged connected call, and one from last month.
    await call({ callerId: agentB, status: 'COMPLETED', outcome: 'INTERESTED', durationSecs: 200 });
    await call({ callerId: agentB, status: 'SCHEDULED' });
    await call({
      callerId: agentB,
      status: 'COMPLETED',
      outcome: 'CONNECTED',
      durationSecs: 999,
      createdAt: new Date(Date.now() - 40 * 86_400_000),
    });
    const type = await prisma.activityType.upsert({
      where: { tenantId_key: { tenantId, key: 'call_out' } },
      update: {},
      create: { tenantId, key: 'call_out', name: 'Outbound call' },
    });
    await prisma.activity.create({
      data: { tenantId, typeId: type.id, ownerId: agentB, outcome: 'Interested', durationSecs: 60 },
    });
  });

  it('counts each agent’s calls, connected calls, time on the phone and talk time in the period', async () => {
    const report = await runReport(await ctxFrom(ws.cookie), 'call-performance', range);
    expect(report.columns.map((c) => c.key)).toEqual([
      'agent',
      'calls',
      'connected',
      'rate',
      'total',
      'average',
      'talk',
    ]);
    const row = (agent: string) => report.rows.find((r) => r.agent === agent);
    // Alpha: answered (125 s, 110 s talking), missed, and completed unanswered (30 s); the M9-02 call (70 s).
    expect(row('Agent Alpha')).toEqual({
      agent: 'Agent Alpha',
      calls: 4,
      connected: 2,
      rate: '50%',
      total: '0:03:45',
      average: '0:01:38',
      talk: '0:01:50',
    });
    // Bravo: 40 s and 200 s placed, 60 s logged; nothing from last month, nothing only scheduled.
    expect(row('Agent Bravo')).toEqual({
      agent: 'Agent Bravo',
      calls: 3,
      connected: 2,
      rate: '67%',
      total: '0:05:00',
      average: '0:02:10',
      talk: null,
    });
  });

  it('downloads as CSV for a role with EXPORT', async () => {
    const q = new URLSearchParams({
      report: 'call-performance',
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      format: 'csv',
    });
    const res = await reportApi(
      new Request(`http://localhost/api/v1/reports?${q}`, { headers: { cookie: ws.cookie } }),
      {
        params: Promise.resolve({}),
      },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Agent Alpha');
    expect(text).toContain('Agent Bravo');
  });

  it('shows an agent only their own line', async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { tenantId, users: { some: { id: agentA } } } });
    await grantPermissions(
      tenantId,
      role.id,
      [
        ['reports', 'VIEW'],
        ['calls', 'VIEW'],
      ],
      'OWN',
    );
    const report = await runReport(
      await ctxFrom(await createSessionToken(tenantId, agentA)),
      'call-performance',
      range,
    );
    expect(report.rows.map((r) => r.agent)).toEqual(['Agent Alpha']);
  });
});
