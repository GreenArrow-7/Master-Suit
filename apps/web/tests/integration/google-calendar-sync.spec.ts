import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

/**
 * Audit M8-08: meetings, follow-ups and site visits on the workspace's Google
 * Calendar. The CRM writes go through their real routes on a real database;
 * Google is a fake calendar behind `fetch` (no network), and the queue is
 * drained by hand through the worker's own dispatch.
 *
 * Hoisted: lib/env.ts freezes the environment the moment it is imported.
 */
vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret-must-never-leak';
});
const enqueue = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => null));
vi.mock('@/lib/queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue')>()),
  enqueue,
}));
// For the Integrations page: its session cookie, and the app's user agent when asked.
const browser = vi.hoisted(() => ({ cookie: '', userAgent: 'Mozilla/5.0' }));
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ cookie: browser.cookie, 'user-agent': browser.userAgent, 'x-pathname': '/admin/integrations' }),
  cookies: async () => ({
    get: (name: string) => {
      const match = browser.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? { name, value: match[1] } : undefined;
    },
  }),
}));

import { prisma } from '@/lib/db';
import { decryptCredentials, wrapCredentials } from '@/lib/integrations/connection';
import { env } from '@/lib/env';
import { RETRY } from '@/lib/queue';
import { handleJob, JOBS } from '@/workers/jobs';
import { calendarEventId, googleRedirectUri } from '@/services/integrations/googleCalendar';
import { POST as createFollowUp } from '@/app/api/v1/follow-ups/route';
import { PATCH as editFollowUp } from '@/app/api/v1/follow-ups/[id]/route';
import { POST as createTask } from '@/app/api/v1/tasks/route';
import { PATCH as editTask } from '@/app/api/v1/tasks/[id]/route';
import { POST as bookVisit } from '@/app/api/v1/site-visits/route';
import { DELETE as cancelVisit } from '@/app/api/v1/site-visits/[id]/route';
import { POST as connectGoogle } from '@/app/api/v1/integrations/google/connect/route';
import { GET as googleCallback } from '@/app/api/v1/integrations/google/callback/route';
import { POST as identityPost } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/[action]/route';
import IntegrationsPage from '@/app/(workspace)/[workspaceSlug]/admin/integrations/page';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { del, patch, post } from '../helpers/request';

// ── A fake Google ────────────────────────────────────────────────────────────
type Body = Record<string, any>;
/** Events by `{calendarId}/{eventId}`: each calendar holds its own. */
const calendar = new Map<string, Body>();
const calls: { method: string; url: string; auth: string | null }[] = [];
const tokenRequests: Record<string, string>[] = [];
let googleDown = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = Object.fromEntries(new URLSearchParams(String(init.body)));
      tokenRequests.push(form);
      return json({
        access_token: `fresh-${tokenRequests.length}`,
        expires_in: 3599,
        scope: 'https://www.googleapis.com/auth/calendar.events',
        ...(form.grant_type === 'authorization_code' && { refresh_token: 'refresh-from-code' }),
      });
    }
    const auth = new Headers(init.headers).get('authorization');
    calls.push({ method, url, auth });
    if (googleDown) return json({ error: { message: 'Backend Error' } }, 503);
    const match = /\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([0-9a-v]+))?/.exec(url);
    if (!match) return json({ error: { message: `unexpected ${url}` } }, 400);
    const [cal, id] = [decodeURIComponent(match[1]!), match[2]];
    if (method === 'PUT') {
      if (!calendar.has(`${cal}/${id}`)) return json({ error: { message: 'Not Found' } }, 404);
      calendar.set(`${cal}/${id}`, JSON.parse(String(init.body)));
      return json({ id });
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init.body));
      calendar.set(`${cal}/${body.id}`, body);
      return json({ id: body.id });
    }
    if (method === 'DELETE') {
      if (!calendar.delete(`${cal}/${id}`)) return json({ error: { message: 'Not Found' } }, 404);
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

/** Syncs queued since the last drain — on the calendar's own queue. */
const queued = () =>
  enqueue.mock.calls
    .filter((call) => call[0] === 'calendar' && call[1] === 'calendar-sync')
    .map((call) => call[2] as Record<string, string>);

/** What the worker would do with every sync queued since the last drain. */
async function drain() {
  const jobs = queued();
  enqueue.mockClear();
  for (const data of jobs) await handleJob('calendar', { name: 'calendar-sync', data });
}

const eventOf = (kind: 'followUp' | 'task' | 'visit', id: string, on = 'primary') =>
  calendar.get(`${on}/${calendarEventId(tenantId, kind, id)}`);

const card = () => prisma.integrationConnection.findFirstOrThrow({ where: { tenantId, provider: 'google' } });

/** The maintenance sweep that re-drives syncs left behind, for this workspace only. */
const sweep = () => handleJob('maintenance', { name: 'calendar-sync-retry', data: { tenantIds: [tenantId] } });

const googleCallbackAs = (query: string, cookie?: string) =>
  googleCallback(
    new Request(`http://localhost/api/v1/integrations/google/callback?${query}`, {
      headers: cookie ? { cookie } : {},
    }),
  );

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
    // To reach the callback at all, where another workspace's state is refused.
    ['integrations', 'MANAGE_CONFIGURATION'],
    ['integrations', 'VIEW'],
    // To deactivate a member and hand their work on.
    ['users', 'VIEW'],
    ['users', 'MANAGE_USERS'],
  ]);
  await prisma.integrationConnection.create({
    data: {
      tenantId,
      provider: 'google',
      status: 'CONNECTED',
      credentials: wrapCredentials({ accessToken: 'live-token', refreshToken: 'refresh-1' }),
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
  googleDown = false;
});

it('a meeting follow-up booked, moved and cancelled goes onto, moves on and comes off the calendar', async () => {
  const due = '2026-11-03T06:00:00.000Z';
  const created = await post(
    createFollowUp,
    '/api/v1/follow-ups',
    { leadId, title: 'Payment plan walk-through', dueAt: due, kind: 'MEETING' },
    cookie,
  );
  expect(created.status).toBe(200);
  const id = created.body.id as string;
  expect(queued()).toEqual([{ tenantId, kind: 'followUp', id }]);
  await drain();

  const event = eventOf('followUp', id)!;
  expect(event).toMatchObject({
    status: 'confirmed',
    summary: 'Meeting: Payment plan walk-through — manath Lead 0',
    start: { dateTime: due, timeZone: 'Asia/Dubai' },
    end: { dateTime: '2026-11-03T06:30:00.000Z' },
    attendees: [{ email: `admin@${fixture.a.slug}.test` }],
  });
  // The lead's page, so the meeting opens the record it is about.
  expect(event.description).toContain(`/${fixture.a.slug}/sales/leads/${leadId}`);
  expect(calls.at(-1)?.auth).toBe('Bearer live-token');

  const later = '2026-11-04T09:15:00.000Z';
  expect((await patch(editFollowUp, `/api/v1/follow-ups/${id}`, { dueAt: later }, cookie, { id })).status).toBe(200);
  await drain();
  expect(eventOf('followUp', id)!.start.dateTime).toBe(later);

  expect((await patch(editFollowUp, `/api/v1/follow-ups/${id}`, { status: 'CANCELLED' }, cookie, { id })).status).toBe(
    200,
  );
  await drain();
  expect(eventOf('followUp', id)).toBeUndefined();
});

it('a call follow-up stays off the calendar unless the connection says every follow-up', async () => {
  const created = await post(
    createFollowUp,
    '/api/v1/follow-ups',
    { leadId, title: 'Call back', dueAt: '2026-11-05T07:00:00.000Z' },
    cookie,
  );
  const id = created.body.id as string;
  const before = calls.length;
  await drain();
  expect(calls.length).toBe(before);
  expect(eventOf('followUp', id)).toBeUndefined();

  await prisma.integrationConnection.updateMany({
    where: { tenantId, provider: 'google' },
    data: { metadata: { syncAllFollowUps: true } },
  });
  await handleJob('calendar', { name: 'calendar-sync', data: { tenantId, kind: 'followUp', id } });
  expect(eventOf('followUp', id)?.summary).toBe('Call: Call back — manath Lead 0');
  await prisma.integrationConnection.updateMany({ where: { tenantId, provider: 'google' }, data: { metadata: {} } });
});

it('a meeting task goes on at its due time for its type’s length, and is marked done on completion; a to-do does not', async () => {
  const meeting = await prisma.taskType.create({
    data: { tenantId, key: 'gcal-meeting', name: 'Meeting', category: 'APPOINTMENT', defaultDurationMins: 45 },
  });
  const todo = await prisma.taskType.create({ data: { tenantId, key: 'gcal-todo', name: 'To-do', category: 'TODO' } });

  const created = await post(
    createTask,
    '/api/v1/tasks',
    { typeId: meeting.id, leadId, title: 'Viewing debrief', dueAt: '2026-11-06T10:00:00.000Z' },
    cookie,
  );
  expect(created.status).toBe(200);
  const id = created.body.id as string;
  await drain();
  expect(eventOf('task', id)).toMatchObject({
    summary: 'Viewing debrief — manath Lead 0',
    start: { dateTime: '2026-11-06T10:00:00.000Z' },
    end: { dateTime: '2026-11-06T10:45:00.000Z' },
  });

  await patch(editTask, `/api/v1/tasks/${id}`, { status: 'COMPLETED' }, cookie, { id });
  await drain();
  expect(eventOf('task', id)?.summary).toBe('Done: Viewing debrief — manath Lead 0');

  const chore = await post(
    createTask,
    '/api/v1/tasks',
    { typeId: todo.id, title: 'Renew the trade licence', dueAt: '2026-11-06T11:00:00.000Z' },
    cookie,
  );
  await drain();
  expect(eventOf('task', chore.body.id as string)).toBeUndefined();
});

it('a site visit goes on with its place and length, and cancelling it takes it off', async () => {
  const booked = await post(
    bookVisit,
    '/api/v1/site-visits',
    {
      kind: 'CLIENT_MEETING',
      leadId,
      address: 'Dubai Mall, Fashion Avenue',
      scheduledAt: '2026-11-07T08:00:00.000Z',
      durationMin: 90,
    },
    cookie,
  );
  expect(booked.status).toBe(200);
  const id = booked.body.id as string;
  await drain();
  expect(eventOf('visit', id)).toMatchObject({
    summary: 'Client meeting — manath Lead 0',
    location: 'Dubai Mall, Fashion Avenue',
    start: { dateTime: '2026-11-07T08:00:00.000Z' },
    end: { dateTime: '2026-11-07T09:30:00.000Z' },
  });

  expect((await del(cancelVisit, `/api/v1/site-visits/${id}`, cookie, { id })).status).toBe(200);
  await drain();
  expect(eventOf('visit', id)).toBeUndefined();
});

it('Google being down never fails the write: the job fails for the queue to retry, and the card says why', async () => {
  googleDown = true;
  const created = await post(
    createFollowUp,
    '/api/v1/follow-ups',
    { leadId, title: 'Site walk', dueAt: '2026-11-08T05:00:00.000Z', kind: 'SITE_VISIT' },
    cookie,
  );
  expect(created.status).toBe(200);
  const id = created.body.id as string;
  expect(await prisma.followUpTask.count({ where: { tenantId, id } })).toBe(1);

  const job = { name: 'calendar-sync', data: { tenantId, kind: 'followUp', id } };
  await expect(handleJob('calendar', job)).rejects.toThrow(/503/);
  const failed = await prisma.integrationConnection.findFirstOrThrow({ where: { tenantId, provider: 'google' } });
  expect(failed.status).toBe('CONNECTED');
  expect(failed.errorMessage).toMatch(/^Calendar sync failed: Google Calendar API error: 503 Backend Error/);

  googleDown = false;
  await handleJob('calendar', job);
  expect(eventOf('followUp', id)?.summary).toBe('Site visit: Site walk — manath Lead 0');
  const healed = await prisma.integrationConnection.findFirstOrThrow({ where: { tenantId, provider: 'google' } });
  expect(healed.errorMessage).toBeNull();
});

it('a token past its hour is refreshed with the deployment’s client and kept encrypted', async () => {
  await prisma.integrationConnection.updateMany({
    where: { tenantId, provider: 'google' },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  const created = await post(
    createFollowUp,
    '/api/v1/follow-ups',
    { leadId, title: 'Second viewing', dueAt: '2026-11-09T05:00:00.000Z', kind: 'MEETING' },
    cookie,
  );
  await drain();

  const refresh = tokenRequests.at(-1)!;
  expect(refresh).toMatchObject({
    grant_type: 'refresh_token',
    refresh_token: 'refresh-1',
    client_id: 'test-google-client',
  });
  const fresh = `fresh-${tokenRequests.length}`;
  expect(calls.at(-1)?.auth).toBe(`Bearer ${fresh}`);
  expect(eventOf('followUp', created.body.id as string)).toBeDefined();

  const stored = await prisma.integrationConnection.findFirstOrThrow({ where: { tenantId, provider: 'google' } });
  expect(JSON.stringify(stored.credentials)).not.toContain(fresh);
  expect(decryptCredentials(stored.credentials as Record<string, unknown>)).toEqual({
    accessToken: fresh,
    refreshToken: 'refresh-1',
  });
  expect(stored.expiresAt!.getTime()).toBeGreaterThan(Date.now());
});

it('a workspace without a connected calendar queues nothing', async () => {
  const created = await post(
    createFollowUp,
    '/api/v1/follow-ups',
    { leadId: fixture.b.leadIds[0], title: 'Meeting', dueAt: '2026-11-10T05:00:00.000Z', kind: 'MEETING' },
    fixture.b.cookie,
  );
  expect(created.status).toBe(200);
  expect(queued()).toEqual([]);
});

it('connects through Google’s consent screen: the session’s workspace, a single-use state, the tokens encrypted', async () => {
  const b = fixture.b;
  const admin = await prisma.user.findFirstOrThrow({ where: { tenantId: b.tenantId, id: b.userId } });
  await grantPermissions(b.tenantId, admin.roleId, [['integrations', 'MANAGE_CONFIGURATION']]);
  const returnTo = `/${b.slug}/admin/integrations`;

  const started = await post(connectGoogle, '/api/v1/integrations/google/connect', { returnTo }, b.cookie);
  expect(started.status).toBe(200);
  const consent = new URL(started.body.url as string);
  expect(`${consent.origin}${consent.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(Object.fromEntries(consent.searchParams)).toMatchObject({
    client_id: 'test-google-client',
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events',
    access_type: 'offline',
    prompt: 'consent',
  });
  expect(consent.href).not.toContain('test-google-secret-must-never-leak');
  expect(consent.href).not.toContain(b.tenantId);
  const state = consent.searchParams.get('state')!;

  const callback = (query: string, as = b.cookie) => googleCallbackAs(query, as);

  // Another workspace's session cannot finish this one's flow — and spends the state trying.
  const elsewhere = new URL((await callback(`state=${state}&code=abc`, cookie)).headers.get('location')!);
  expect(elsewhere.searchParams.get('error')).toMatch(/different workspace/);
  // Never the path the other workspace chose: it lands on this session's home.
  expect(elsewhere.pathname).toBe('/');

  const again = await post(connectGoogle, '/api/v1/integrations/google/connect', { returnTo }, b.cookie);
  const handle = new URL(again.body.url as string).searchParams.get('state')!;
  const done = await callback(
    `state=${handle}&code=abc&scope=https://www.googleapis.com/auth/calendar.events&authuser=0`,
  );
  const landed = new URL(done.headers.get('location')!);
  expect(landed.pathname).toBe(returnTo);
  expect(landed.searchParams.get('connected')).toBe('google');
  expect(landed.searchParams.get('error')).toBeNull();
  expect(tokenRequests.at(-1)).toMatchObject({
    grant_type: 'authorization_code',
    code: 'abc',
    redirect_uri: googleRedirectUri(),
  });

  const connection = await prisma.integrationConnection.findFirstOrThrow({
    where: { tenantId: b.tenantId, provider: 'google' },
  });
  expect(connection.status).toBe('CONNECTED');
  expect(connection.scopes).toEqual(['https://www.googleapis.com/auth/calendar.events']);
  expect(JSON.stringify(connection.credentials)).not.toContain('refresh-from-code');
  expect(decryptCredentials(connection.credentials as Record<string, unknown>)).toEqual({
    accessToken: `fresh-${tokenRequests.length}`,
    refreshToken: 'refresh-from-code',
  });

  // The handle is spent: a replay connects nothing.
  const replay = await callback(`state=${handle}&code=abc`);
  expect(new URL(replay.headers.get('location')!).searchParams.get('error')).toMatch(/expired/);
});

// ── Review fixes ─────────────────────────────────────────────────────────────

it('runs on a queue of its own, so a hanging Google never holds up reminder pushes and emails', () => {
  expect(JOBS.calendar['calendar-sync']).toBeTypeOf('function');
  expect(JOBS.notifications['calendar-sync']).toBeUndefined();
  // A vendor outage outlasts an SMTP blip: longer between attempts than notifications.
  expect(RETRY.calendar.backoff.delay).toBeGreaterThan(RETRY.notifications.backoff.delay);
});

it('a sync that runs out of retries is re-driven by the sweep; a later success elsewhere does not clear the card', async () => {
  googleDown = true;
  const first = await post(
    createFollowUp,
    '/api/v1/follow-ups',
    { leadId, title: 'Handover pack', dueAt: '2026-11-11T05:00:00.000Z', kind: 'MEETING' },
    cookie,
  );
  const firstId = first.body.id as string;
  enqueue.mockClear();
  // Its last attempt: the queue gives up on it here.
  await expect(
    handleJob('calendar', { name: 'calendar-sync', data: { tenantId, kind: 'followUp', id: firstId } }),
  ).rejects.toThrow(/503/);

  googleDown = false;
  const second = await post(
    createFollowUp,
    '/api/v1/follow-ups',
    { leadId, title: 'Snagging walk', dueAt: '2026-11-12T05:00:00.000Z', kind: 'MEETING' },
    cookie,
  );
  await drain();
  expect(eventOf('followUp', second.body.id as string)).toBeDefined();
  expect(eventOf('followUp', firstId)).toBeUndefined();
  // The first meeting is still missing, so the card still says so.
  expect((await card()).errorMessage).toMatch(/^Calendar sync failed/);

  await sweep();
  expect(queued()).toEqual([{ tenantId, kind: 'followUp', id: firstId }]);
  await drain();
  expect(eventOf('followUp', firstId)?.summary).toBe('Meeting: Handover pack — manath Lead 0');
  expect((await card()).errorMessage).toBeNull();
  // Nothing left behind: the next sweep queues nothing.
  await sweep();
  expect(queued()).toEqual([]);
});

it('a meeting cancelled while the connection is in error comes off once it is connected again', async () => {
  const created = await post(
    createFollowUp,
    '/api/v1/follow-ups',
    { leadId, title: 'Mortgage adviser', dueAt: '2026-11-13T05:00:00.000Z', kind: 'MEETING' },
    cookie,
  );
  const id = created.body.id as string;
  await drain();
  expect(eventOf('followUp', id)).toBeDefined();

  // A failed Test connection.
  await prisma.integrationConnection.updateMany({
    where: { tenantId, provider: 'google' },
    data: { status: 'ERROR', errorMessage: 'Google Calendar API error: 401' },
  });
  expect((await patch(editFollowUp, `/api/v1/follow-ups/${id}`, { status: 'CANCELLED' }, cookie, { id })).status).toBe(
    200,
  );
  await drain();
  await sweep();
  expect(queued()).toEqual([]);
  expect(eventOf('followUp', id)).toBeDefined();

  await prisma.integrationConnection.updateMany({
    where: { tenantId, provider: 'google' },
    data: { status: 'CONNECTED', errorMessage: null },
  });
  await sweep();
  await drain();
  expect(eventOf('followUp', id)).toBeUndefined();
});

it('a leaver’s meetings follow the hand-over: the new owner is the guest, the leaver is never invited again', async () => {
  const staff = await prisma.role.create({
    data: { tenantId, key: `gcal-staff-${Date.now()}`, name: 'Agent', rank: 50, defaultScope: 'OWN' },
  });
  const agent = await createWorkspaceUser({
    tenantId,
    roleId: staff.id,
    email: `leaver-${Date.now()}@${fixture.a.slug}.test`,
    fullName: 'Leaving Agent',
  });
  const meeting = await prisma.followUpTask.create({
    data: {
      tenantId,
      ownerId: agent.id,
      leadId,
      title: 'Contract signing',
      kind: 'MEETING',
      dueAt: new Date('2026-11-14T05:00:00.000Z'),
    },
  });
  // Site visits are not handed over: they keep the leaver as owner.
  const visit = await prisma.siteVisit.create({
    data: {
      tenantId,
      ownerId: agent.id,
      leadId,
      kind: 'CLIENT_MEETING',
      status: 'APPROVED',
      decidedById: fixture.a.userId,
      decidedAt: new Date(),
      address: 'Marina Walk',
      scheduledAt: new Date('2026-11-15T05:00:00.000Z'),
    },
  });
  for (const [kind, id] of [
    ['followUp', meeting.id],
    ['visit', visit.id],
  ] as const) {
    await handleJob('calendar', { name: 'calendar-sync', data: { tenantId, kind, id } });
  }
  expect(eventOf('followUp', meeting.id)?.attendees).toEqual([{ email: agent.email }]);
  expect(eventOf('visit', visit.id)?.attendees).toEqual([{ email: agent.email }]);

  const deactivated = await post(
    identityPost,
    `/api/v1/workspaces/${fixture.a.slug}/identity/account-active`,
    { userId: agent.id, active: false, handOverTo: fixture.a.userId },
    cookie,
    { workspaceSlug: fixture.a.slug, action: 'account-active' },
  );
  expect(deactivated.status).toBe(200);
  // The response is the counts it always was.
  expect(deactivated.body.handedOver).toEqual({ leads: 0, followUps: 1, tasks: 0 });
  expect(queued()).toEqual(
    expect.arrayContaining([
      { tenantId, kind: 'followUp', id: meeting.id },
      { tenantId, kind: 'visit', id: visit.id },
    ]),
  );
  await drain();
  expect(eventOf('followUp', meeting.id)?.attendees).toEqual([{ email: `admin@${fixture.a.slug}.test` }]);
  expect(eventOf('visit', visit.id)?.attendees).toBeUndefined();

  // A manager moves the leaver's visit a week later: the leaver is still not invited.
  await prisma.siteVisit.updateMany({
    where: { tenantId, id: visit.id },
    data: { scheduledAt: new Date('2026-11-22T05:00:00.000Z') },
  });
  await handleJob('calendar', { name: 'calendar-sync', data: { tenantId, kind: 'visit', id: visit.id } });
  expect(eventOf('visit', visit.id)).toMatchObject({ start: { dateTime: '2026-11-22T05:00:00.000Z' } });
  expect(eventOf('visit', visit.id)?.attendees).toBeUndefined();
});

it('a changed calendar moves an event written to the old one, and a cancel removes it wherever it was written', async () => {
  const book = async (title: string, dueAt: string) => {
    const created = await post(createFollowUp, '/api/v1/follow-ups', { leadId, title, dueAt, kind: 'MEETING' }, cookie);
    await drain();
    return created.body.id as string;
  };
  const moved = await book('Floor plan review', '2026-11-16T05:00:00.000Z');
  const cancelled = await book('Key handover', '2026-11-17T05:00:00.000Z');
  expect(eventOf('followUp', moved)).toBeDefined();

  const shared = 'sales-team@group.calendar.google.com';
  await prisma.integrationConnection.updateMany({
    where: { tenantId, provider: 'google' },
    data: { metadata: { calendarId: shared } },
  });
  try {
    const later = '2026-11-18T07:00:00.000Z';
    await patch(editFollowUp, `/api/v1/follow-ups/${moved}`, { dueAt: later }, cookie, { id: moved });
    await drain();
    // One event, on the new calendar, at the new time: no copy left at the old time.
    expect(eventOf('followUp', moved, shared)?.start.dateTime).toBe(later);
    expect(eventOf('followUp', moved)).toBeUndefined();

    await patch(editFollowUp, `/api/v1/follow-ups/${cancelled}`, { status: 'CANCELLED' }, cookie, { id: cancelled });
    await drain();
    expect(eventOf('followUp', cancelled)).toBeUndefined();
    expect(eventOf('followUp', cancelled, shared)).toBeUndefined();
  } finally {
    await prisma.integrationConnection.updateMany({ where: { tenantId, provider: 'google' }, data: { metadata: {} } });
  }
});

it('signed out — the phone’s own browser, say — the callback spends the state and says to sign in, on this site', async () => {
  // A return path a URL parser would read as another site.
  const started = await post(
    connectGoogle,
    '/api/v1/integrations/google/connect',
    { returnTo: '/\t/evil.example/login' },
    cookie,
  );
  expect(started.status).toBe(200);
  const state = new URL(started.body.url as string).searchParams.get('state')!;
  const before = await card();

  const signedOut = await googleCallbackAs(`state=${state}&code=abc`);
  expect(signedOut.status).toBeGreaterThanOrEqual(300);
  expect(signedOut.status).toBeLessThan(400);
  const landed = new URL(signedOut.headers.get('location')!);
  expect(landed.origin).toBe(new URL(env.APP_URL).origin);
  expect(landed.searchParams.get('error')).toMatch(/sign in/i);

  // Spent: the same link with the session connects nothing.
  const replay = new URL((await googleCallbackAs(`state=${state}&code=abc`, cookie)).headers.get('location')!);
  expect(replay.searchParams.get('error')).toMatch(/expired/);
  expect((await card()).credentials).toEqual(before.credentials);
});

it('inside the iOS or Android app the card says to connect from a browser, where Google’s sign-in works', async () => {
  browser.cookie = cookie;
  const googleCard = async (userAgent: string) => {
    browser.userAgent = userAgent;
    const tree = await IntegrationsPage({
      params: Promise.resolve({ workspaceSlug: fixture.a.slug }),
      searchParams: Promise.resolve({}),
    });
    const board = findProps(tree, 'providers') as { providers: { key: string; oauth?: unknown }[] };
    return board.providers.find((p) => p.key === 'google')!.oauth;
  };
  expect(await googleCard('Mozilla/5.0 (iPhone) AppleWebKit YouhanOneApp/1.1.0')).toEqual({
    configured: true,
    inApp: true,
  });
  expect(await googleCard('Mozilla/5.0 (Linux; Android 14) YouhanOneApp/1.1.0')).toMatchObject({ inApp: true });
  expect(await googleCard('Mozilla/5.0 (Windows NT 10.0) Chrome/130')).toEqual({ configured: true, inApp: false });
});

/** The first element in a rendered tree whose props carry `key`. */
function findProps(node: unknown, key: string, seen = new Set<unknown>()): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object' || seen.has(node)) return undefined;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProps(item, key, seen);
      if (found) return found;
    }
    return undefined;
  }
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return undefined;
  if (key in props) return props;
  return findProps(props.children, key, seen);
}
