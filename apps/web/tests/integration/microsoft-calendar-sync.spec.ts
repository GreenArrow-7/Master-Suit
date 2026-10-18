import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

/**
 * Audit M8-09: meetings, follow-ups and site visits on the workspace's
 * Microsoft 365 (Outlook) calendar, beside Google's (M8-08). The CRM writes go
 * through their real routes on a real database; Microsoft Graph and the token
 * endpoint are a fake behind `fetch` (no network), and the queue is drained by
 * hand through the worker's own dispatch.
 *
 * Hoisted: lib/env.ts freezes the environment the moment it is imported.
 */
vi.hoisted(() => {
  process.env.MICROSOFT_CLIENT_ID = 'test-ms-client';
  process.env.MICROSOFT_CLIENT_SECRET = 'test-ms-secret-must-never-leak';
});
const enqueue = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => null));
vi.mock('@/lib/queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue')>()),
  enqueue,
}));
/** The deployment's app registration, switched off for the "not configured" case. */
const deployment = vi.hoisted(() => ({ configured: true }));
vi.mock('@/lib/integrations/calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/integrations/calendar')>()),
  microsoftOAuthConfigured: () => deployment.configured,
}));

import { prisma } from '@/lib/db';
import { decryptCredentials, wrapCredentials } from '@/lib/integrations/connection';
import { handleJob } from '@/workers/jobs';
import { microsoftRedirectUri } from '@/services/integrations/microsoftCalendar';
import { POST as createFollowUp } from '@/app/api/v1/follow-ups/route';
import { PATCH as editFollowUp } from '@/app/api/v1/follow-ups/[id]/route';
import { POST as createTask } from '@/app/api/v1/tasks/route';
import { POST as bookVisit } from '@/app/api/v1/site-visits/route';
import { DELETE as cancelVisit } from '@/app/api/v1/site-visits/[id]/route';
import { POST as connectCalendar } from '@/app/api/v1/integrations/[provider]/connect/route';
import { GET as calendarCallback } from '@/app/api/v1/integrations/[provider]/callback/route';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { del, patch, post } from '../helpers/request';

// ── A fake Microsoft ─────────────────────────────────────────────────────────
type Body = Record<string, any>;
/** The connected account's calendar, by Graph's own event id. */
const outlook = new Map<string, Body>();
/** Graph's de-duplication of creates: transactionId → the event it made. */
const byTransaction = new Map<string, string>();
const calls: { method: string; url: string; auth: string | null; body?: Body }[] = [];
const tokenRequests: Record<string, string>[] = [];
let graphDown = false;
/** The next create is made, but its answer never arrives (a timeout on our side). */
let loseNextAnswer = false;
let made = 0;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    if (url === 'https://login.microsoftonline.com/common/oauth2/v2.0/token') {
      const form = Object.fromEntries(new URLSearchParams(String(init.body)));
      tokenRequests.push(form);
      // Every answer carries a new refresh token: Microsoft rotates them.
      return json({
        access_token: `ms-fresh-${tokenRequests.length}`,
        refresh_token: `ms-refresh-${tokenRequests.length + 1}`,
        expires_in: 3599,
        scope: 'Calendars.ReadWrite User.Read profile openid email',
      });
    }
    const body = init.body ? (JSON.parse(String(init.body)) as Body) : undefined;
    calls.push({ method, url, auth: new Headers(init.headers).get('authorization'), body });
    if (graphDown) return json({ error: { code: 'ErrorServerBusy', message: 'The server is busy.' } }, 503);
    const match = /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/events(?:\/([^/?]+))?$/.exec(url);
    if (!match) return json({ error: { message: `unexpected ${url}` } }, 400);
    const id = match[1] && decodeURIComponent(match[1]);
    if (method === 'POST') {
      const existing = byTransaction.get(body!.transactionId);
      const eventId = existing ?? `AAMkAGI2-${++made}`;
      if (!existing) {
        byTransaction.set(body!.transactionId, eventId);
        outlook.set(eventId, body!);
      }
      if (loseNextAnswer) {
        loseNextAnswer = false;
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      return json({ ...outlook.get(eventId), id: eventId }, 201);
    }
    if (!id || !outlook.has(id)) return json({ error: { code: 'ErrorItemNotFound', message: 'Not found.' } }, 404);
    if (method === 'PATCH') {
      outlook.set(id, { ...outlook.get(id), ...body });
      return json({ id });
    }
    if (method === 'DELETE') {
      outlook.delete(id);
      return new Response(null, { status: 204 });
    }
    return json({ error: { message: 'unsupported' } }, 405);
  }),
);

// ── The workspace ────────────────────────────────────────────────────────────
let fixture: Fixture;
let tenantId = '';
let cookie = '';
let leadId = '';

const queued = () =>
  enqueue.mock.calls
    .filter((call) => call[0] === 'calendar' && call[1] === 'calendar-sync')
    .map((call) => call[2] as Record<string, string>);

async function drain() {
  const jobs = queued();
  enqueue.mockClear();
  for (const data of jobs) await handleJob('calendar', { name: 'calendar-sync', data });
}

const linkOf = (recordKind: string, recordId: string) =>
  prisma.calendarEventLink.findFirst({ where: { tenantId, provider: 'microsoft', recordKind, recordId } });
/** The record's event in Outlook, through the link we keep. */
const eventOf = async (recordKind: string, recordId: string) => {
  const link = await linkOf(recordKind, recordId);
  return link?.externalId ? outlook.get(link.externalId) : undefined;
};
const card = () => prisma.integrationConnection.findFirstOrThrow({ where: { tenantId, provider: 'microsoft' } });

const connectMicrosoft = (body: Record<string, unknown>, as: string) =>
  post(connectCalendar, '/api/v1/integrations/microsoft/connect', body, as, { provider: 'microsoft' });
const microsoftCallback = (query: string, as?: string) =>
  calendarCallback(
    new Request(`http://localhost/api/v1/integrations/microsoft/callback?${query}`, {
      headers: as ? { cookie: as } : {},
    }),
    { params: Promise.resolve({ provider: 'microsoft' }) },
  );
const landing = (res: Response) => new URL(res.headers.get('location')!);

beforeAll(async () => {
  fixture = await seedTwoTenants();
  ({ tenantId, cookie } = fixture.a);
  leadId = fixture.a.leadIds[0]!;
  const admin = await prisma.user.findFirstOrThrow({ where: { tenantId, id: fixture.a.userId } });
  await grantPermissions(tenantId, admin.roleId, [
    ['visits', 'VIEW'],
    ['visits', 'CREATE'],
    ['visits', 'EDIT'],
    ['visits', 'DELETE'],
    ['integrations', 'MANAGE_CONFIGURATION'],
    ['integrations', 'VIEW'],
  ]);
  await prisma.integrationConnection.create({
    data: {
      tenantId,
      provider: 'microsoft',
      status: 'CONNECTED',
      credentials: wrapCredentials({ accessToken: 'ms-live', refreshToken: 'ms-refresh-1' }),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
});
afterAll(async () => {
  await fixture.cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  enqueue.mockClear();
  graphDown = false;
  loseNextAnswer = false;
  deployment.configured = true;
});

it('a meeting follow-up is created in Outlook, moved with a PATCH and cancelled with a DELETE', async () => {
  const due = '2026-11-03T06:00:00.000Z';
  const created = await post(
    createFollowUp,
    '/api/v1/follow-ups',
    { leadId, title: 'Payment plan walk-through', dueAt: due, kind: 'MEETING' },
    cookie,
  );
  expect(created.status).toBe(200);
  const id = created.body.id as string;
  // Only Microsoft is connected here: one job, naming it.
  expect(queued()).toEqual([{ tenantId, kind: 'followUp', id, provider: 'microsoft' }]);
  await drain();

  const create = calls.at(-1)!;
  expect(create).toMatchObject({
    method: 'POST',
    url: 'https://graph.microsoft.com/v1.0/me/events',
    auth: 'Bearer ms-live',
  });
  expect(create.body).toMatchObject({
    subject: 'Meeting: Payment plan walk-through — manath Lead 0',
    start: { dateTime: '2026-11-03T06:00:00.000', timeZone: 'UTC' },
    end: { dateTime: '2026-11-03T06:30:00.000', timeZone: 'UTC' },
    attendees: [{ emailAddress: { address: `admin@${fixture.a.slug}.test` }, type: 'required' }],
  });
  expect(create.body!.body.content).toContain(`/${fixture.a.slug}/sales/leads/${leadId}`);
  const link = (await linkOf('followUp', id))!;
  expect(link.externalId).toMatch(/^AAMkAGI2-/);
  expect(create.body!.transactionId).toBe(link.transactionId);

  const later = '2026-11-04T09:15:00.000Z';
  expect((await patch(editFollowUp, `/api/v1/follow-ups/${id}`, { dueAt: later }, cookie, { id })).status).toBe(200);
  await drain();
  expect(calls.at(-1)).toMatchObject({
    method: 'PATCH',
    url: `https://graph.microsoft.com/v1.0/me/events/${link.externalId}`,
  });
  expect(calls.at(-1)!.body).not.toHaveProperty('transactionId');
  expect((await eventOf('followUp', id))!.start.dateTime).toBe('2026-11-04T09:15:00.000');

  expect((await patch(editFollowUp, `/api/v1/follow-ups/${id}`, { status: 'CANCELLED' }, cookie, { id })).status).toBe(
    200,
  );
  await drain();
  expect(calls.at(-1)).toMatchObject({
    method: 'DELETE',
    url: `https://graph.microsoft.com/v1.0/me/events/${link.externalId}`,
  });
  expect(outlook.has(link.externalId!)).toBe(false);
  expect(await linkOf('followUp', id)).toBeNull();
  expect((await card()).lastSyncAt).not.toBeNull();
});

it('a create whose answer is lost is retried under the same transactionId: one event, not two, brought up to date', async () => {
  const created = await post(
    createFollowUp,
    '/api/v1/follow-ups',
    { leadId, title: 'Snagging walk', dueAt: '2026-11-05T05:00:00.000Z', kind: 'SITE_VISIT' },
    cookie,
  );
  const id = created.body.id as string;
  const job = { name: 'calendar-sync', data: { tenantId, kind: 'followUp', id, provider: 'microsoft' } };

  loseNextAnswer = true;
  await expect(handleJob('calendar', job)).rejects.toThrow(/timeout/i);
  const pending = (await linkOf('followUp', id))!;
  expect(pending.externalId).toBeNull();
  expect((await card()).errorMessage).toMatch(/^Calendar sync failed/);
  const before = outlook.size;
  // Moved before the retry runs: Graph's answer to the repeated create is the 05:00 event the first one made.
  await patch(editFollowUp, `/api/v1/follow-ups/${id}`, { dueAt: '2026-11-05T10:00:00.000Z' }, cookie, { id });

  // The queue's retry.
  await handleJob('calendar', job);
  const posts = calls.filter((c) => c.method === 'POST' && c.body?.subject?.includes('Snagging walk'));
  expect(posts.map((c) => c.body!.transactionId)).toEqual([pending.transactionId, pending.transactionId]);
  expect(outlook.size).toBe(before);
  expect(await eventOf('followUp', id)).toMatchObject({
    subject: 'Site visit: Snagging walk — manath Lead 0',
    start: { dateTime: '2026-11-05T10:00:00.000' },
  });
  expect((await card()).errorMessage).toBeNull();
});

it('an event deleted in Outlook is created again on the record’s next change, under a new transactionId', async () => {
  const created = await post(
    createFollowUp,
    '/api/v1/follow-ups',
    { leadId, title: 'Mortgage adviser', dueAt: '2026-11-06T05:00:00.000Z', kind: 'MEETING' },
    cookie,
  );
  const id = created.body.id as string;
  await drain();
  const first = (await linkOf('followUp', id))!;
  outlook.delete(first.externalId!);

  await patch(editFollowUp, `/api/v1/follow-ups/${id}`, { dueAt: '2026-11-07T05:00:00.000Z' }, cookie, { id });
  await drain();
  const second = (await linkOf('followUp', id))!;
  expect(second.externalId).not.toBe(first.externalId);
  expect(second.transactionId).not.toBe(first.transactionId);
  expect((await eventOf('followUp', id))!.start.dateTime).toBe('2026-11-07T05:00:00.000');
});

it('appointment tasks and site visits go on too, and a cancelled visit comes off', async () => {
  const meeting = await prisma.taskType.create({
    data: { tenantId, key: 'ms-meeting', name: 'Meeting', category: 'APPOINTMENT', defaultDurationMins: 45 },
  });
  const task = await post(
    createTask,
    '/api/v1/tasks',
    { typeId: meeting.id, leadId, title: 'Viewing debrief', dueAt: '2026-11-08T10:00:00.000Z' },
    cookie,
  );
  expect(task.status).toBe(200);
  const visit = await post(
    bookVisit,
    '/api/v1/site-visits',
    {
      kind: 'CLIENT_MEETING',
      leadId,
      address: 'Dubai Mall, Fashion Avenue',
      scheduledAt: '2026-11-09T08:00:00.000Z',
      durationMin: 90,
    },
    cookie,
  );
  expect(visit.status).toBe(200);
  await drain();
  expect(await eventOf('task', task.body.id as string)).toMatchObject({
    subject: 'Viewing debrief — manath Lead 0',
    end: { dateTime: '2026-11-08T10:45:00.000' },
  });
  const visitId = visit.body.id as string;
  expect(await eventOf('visit', visitId)).toMatchObject({
    subject: 'Client meeting — manath Lead 0',
    location: { displayName: 'Dubai Mall, Fashion Avenue' },
    end: { dateTime: '2026-11-09T09:30:00.000' },
  });

  const externalId = (await linkOf('visit', visitId))!.externalId!;
  expect((await del(cancelVisit, `/api/v1/site-visits/${visitId}`, cookie, { id: visitId })).status).toBe(200);
  await drain();
  expect(outlook.has(externalId)).toBe(false);
});

it('Graph down never fails the write; the card says why; the sweep gets it through', async () => {
  graphDown = true;
  const created = await post(
    createFollowUp,
    '/api/v1/follow-ups',
    { leadId, title: 'Key handover', dueAt: '2026-11-10T05:00:00.000Z', kind: 'MEETING' },
    cookie,
  );
  expect(created.status).toBe(200);
  const id = created.body.id as string;
  await expect(drain()).rejects.toThrow(/503/);
  expect((await card()).errorMessage).toBe('Calendar sync failed: Microsoft Graph error: 503 The server is busy.');

  graphDown = false;
  await handleJob('maintenance', { name: 'calendar-sync-retry', data: { tenantIds: [tenantId] } });
  expect(queued()).toEqual([{ tenantId, kind: 'followUp', id, provider: 'microsoft' }]);
  await drain();
  expect(await eventOf('followUp', id)).toBeDefined();
  expect((await card()).errorMessage).toBeNull();
});

it('a token past its hour is refreshed with the deployment’s client; the new refresh token replaces the old, encrypted', async () => {
  await prisma.integrationConnection.updateMany({
    where: { tenantId, provider: 'microsoft' },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  const created = await post(
    createFollowUp,
    '/api/v1/follow-ups',
    { leadId, title: 'Second viewing', dueAt: '2026-11-11T05:00:00.000Z', kind: 'MEETING' },
    cookie,
  );
  await drain();

  expect(tokenRequests.at(-1)).toMatchObject({
    grant_type: 'refresh_token',
    refresh_token: 'ms-refresh-1',
    client_id: 'test-ms-client',
    scope: 'offline_access Calendars.ReadWrite User.Read',
  });
  const n = tokenRequests.length;
  expect(calls.at(-1)?.auth).toBe(`Bearer ms-fresh-${n}`);
  expect(await eventOf('followUp', created.body.id as string)).toBeDefined();

  const stored = await card();
  expect(JSON.stringify(stored.credentials)).not.toContain(`ms-refresh-${n + 1}`);
  expect(decryptCredentials(stored.credentials as Record<string, unknown>)).toEqual({
    accessToken: `ms-fresh-${n}`,
    refreshToken: `ms-refresh-${n + 1}`,
  });
  expect(stored.expiresAt!.getTime()).toBeGreaterThan(Date.now());
});

it('a workspace with Google and Microsoft both connected queues each meeting for both', async () => {
  await prisma.integrationConnection.create({
    data: { tenantId, provider: 'google', status: 'CONNECTED', credentials: wrapCredentials({ accessToken: 'g' }) },
  });
  try {
    const created = await post(
      createFollowUp,
      '/api/v1/follow-ups',
      { leadId, title: 'Both calendars', dueAt: '2026-11-12T05:00:00.000Z', kind: 'MEETING' },
      cookie,
    );
    const id = created.body.id as string;
    expect(queued()).toEqual(
      expect.arrayContaining([
        { tenantId, kind: 'followUp', id, provider: 'google' },
        { tenantId, kind: 'followUp', id, provider: 'microsoft' },
      ]),
    );
    expect(queued()).toHaveLength(2);
  } finally {
    await prisma.integrationConnection.deleteMany({ where: { tenantId, provider: 'google' } });
  }
});

// ── Connecting ───────────────────────────────────────────────────────────────

it('connects through Microsoft’s consent screen with PKCE: a single-use state, the tokens encrypted', async () => {
  const b = fixture.b;
  const admin = await prisma.user.findFirstOrThrow({ where: { tenantId: b.tenantId, id: b.userId } });
  await grantPermissions(b.tenantId, admin.roleId, [['integrations', 'MANAGE_CONFIGURATION']]);
  const returnTo = `/${b.slug}/admin/integrations`;

  const started = await connectMicrosoft({ returnTo }, b.cookie);
  expect(started.status).toBe(200);
  expect(started.body.redirectUri).toBe(microsoftRedirectUri());
  expect(microsoftRedirectUri()).toMatch(/\/api\/v1\/integrations\/microsoft\/callback$/);
  const consent = new URL(started.body.url as string);
  expect(`${consent.origin}${consent.pathname}`).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  const sentParams = Object.fromEntries(consent.searchParams);
  expect(sentParams).toMatchObject({
    client_id: 'test-ms-client',
    redirect_uri: microsoftRedirectUri(),
    response_type: 'code',
    scope: 'offline_access Calendars.ReadWrite User.Read',
    code_challenge_method: 'S256',
  });
  expect(consent.href).not.toContain('test-ms-secret-must-never-leak');
  expect(consent.href).not.toContain(b.tenantId);

  const done = await microsoftCallback(`code=ms-code&state=${sentParams.state}&session_state=x`, b.cookie);
  const landed = landing(done);
  expect(landed.pathname).toBe(returnTo);
  expect(landed.searchParams.get('connected')).toBe('microsoft');
  expect(landed.searchParams.get('error')).toBeNull();
  const redeem = tokenRequests.at(-1)!;
  expect(redeem).toMatchObject({
    grant_type: 'authorization_code',
    code: 'ms-code',
    redirect_uri: microsoftRedirectUri(),
  });
  // The verifier only the server held answers the challenge the browser carried.
  expect(createHash('sha256').update(redeem.code_verifier!).digest('base64url')).toBe(sentParams.code_challenge);

  const connection = await prisma.integrationConnection.findFirstOrThrow({
    where: { tenantId: b.tenantId, provider: 'microsoft' },
  });
  expect(connection.status).toBe('CONNECTED');
  const refreshToken = `ms-refresh-${tokenRequests.length + 1}`;
  expect(JSON.stringify(connection.credentials)).not.toContain(refreshToken);
  expect(decryptCredentials(connection.credentials as Record<string, unknown>)).toEqual({
    accessToken: `ms-fresh-${tokenRequests.length}`,
    refreshToken,
  });
  const audited = await prisma.auditLog.findFirst({
    where: { tenantId: b.tenantId, recordId: 'microsoft', event: 'INTEGRATION_MODIFIED' },
    orderBy: { occurredAt: 'desc' },
  });
  expect(audited).not.toBeNull();
  expect(JSON.stringify(audited)).not.toContain(refreshToken);

  // Spent: the same redirect again connects nothing.
  const replay = await microsoftCallback(`code=ms-code&state=${sentParams.state}`, b.cookie);
  expect(landing(replay).searchParams.get('error')).toMatch(/expired/);
});

it('without the app registration the card is refused: no consent screen, and a return connects nothing', async () => {
  const state = new URL((await connectMicrosoft({}, cookie)).body.url as string).searchParams.get('state')!;
  deployment.configured = false;
  const refused = await connectMicrosoft({}, cookie);
  expect(refused.status).toBe(409);
  expect(JSON.stringify(refused.body)).toMatch(/MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET/);

  const before = (await card()).credentials;
  const tokensBefore = tokenRequests.length;
  const returned = await microsoftCallback(`code=x&state=${state}`, cookie);
  expect(landing(returned).searchParams.get('error')).toMatch(/not configured/);
  expect(tokenRequests.length).toBe(tokensBefore);
  expect((await card()).credentials).toEqual(before);
});

it('a member who cannot manage integrations can neither start nor finish a connection', async () => {
  const staff = await prisma.role.create({
    data: { tenantId, key: `ms-agent-${Date.now()}`, name: 'Agent', rank: 50, defaultScope: 'OWN' },
  });
  const agent = await createWorkspaceUser({
    tenantId,
    roleId: staff.id,
    email: `agent-${Date.now()}@${fixture.a.slug}.test`,
    fullName: 'Field Agent',
  });
  const agentCookie = await createSessionToken(tenantId, agent.id);
  expect((await connectMicrosoft({}, agentCookie)).status).toBe(403);

  // An administrator's flow, finished in the agent's browser: refused, and spent.
  const state = new URL((await connectMicrosoft({}, cookie)).body.url as string).searchParams.get('state')!;
  const tokensBefore = tokenRequests.length;
  const asAgent = await microsoftCallback(`code=x&state=${state}`, agentCookie);
  expect(landing(asAgent).searchParams.get('error')).toMatch(/cannot manage integrations/);
  expect(tokenRequests.length).toBe(tokensBefore);
  const replay = await microsoftCallback(`code=x&state=${state}`, cookie);
  expect(landing(replay).searchParams.get('error')).toMatch(/expired/);
});

it('a calendar provider the platform does not have is not a connect or callback route', async () => {
  const res = await post(connectCalendar, '/api/v1/integrations/twilio/connect', {}, cookie, { provider: 'twilio' });
  expect(res.status).toBe(422);
  const back = await calendarCallback(new Request('http://localhost/api/v1/integrations/twilio/callback?state=x'), {
    params: Promise.resolve({ provider: 'twilio' }),
  });
  expect(back.status).toBe(404);
});
