import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The Deliveries screen reads its session the way Next serves it.
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
// The real queue, watched: a replay must queue the stored event again.
vi.mock('@/lib/queue', async (importOriginal) => {
  const queue = await importOriginal<typeof import('@/lib/queue')>();
  return { ...queue, enqueue: vi.fn(queue.enqueue) };
});

import { prisma } from '@/lib/db';
import { enqueue } from '@/lib/queue';
import { wrapCredentials } from '@/lib/integrations/connection';
import { handleJob } from '@/workers/jobs';
import { GET as list, POST as replay } from '@/app/api/v1/integrations/[provider]/deliveries/route';
import DeliveriesPage from '@/app/(workspace)/[workspaceSlug]/admin/lead-sources/[provider]/page';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { deliver, leadEagleWorkspace, sign, work } from '../helpers/leadSource';
import { pageText } from '../helpers/render';
import { get, post } from '../helpers/request';
import { createSessionToken } from '../helpers/session';

/**
 * The Deliveries tab of a lead source (audit rows M6-21, M6-22): every stored
 * delivery, newest first, with what became of it — the lead it made or joined,
 * the attempts, the last error, and whether the queue gave up on it — and a
 * Replay button that queues the stored body again, audited.
 */
const SECRET = 'deliveries-signing-secret';
const PATH = '/api/v1/integrations/custom_webhook/deliveries';
const params = { provider: 'custom_webhook' };
let ws: Awaited<ReturnType<typeof leadEagleWorkspace>>;
let other: Awaited<ReturnType<typeof leadEagleWorkspace>>;
let key = '';
let stored = '';
/** Integrations to read, leads at OWN scope: sees the deliveries, opens only its own leads. */
let viewerCookie = '';
/** Leads only. */
let outsiderCookie = '';
const number = `05${String(Date.now()).slice(-8)}`;

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
const event = (externalId: string, minutesAgo: number, extra: Record<string, unknown> = {}) =>
  prisma.webhookEvent.create({
    data: {
      tenantId: ws.tenantId,
      provider: stored,
      externalId,
      eventType: 'LEAD',
      payload: JSON.stringify({ name: externalId }),
      createdAt: at(minutesAgo),
      ...extra,
    },
  });

beforeAll(async () => {
  ws = await leadEagleWorkspace('deliveries', [
    ['integrations', 'VIEW'],
    ['integrations', 'MANAGE_CONFIGURATION'],
    ['leads', 'VIEW'],
  ]);
  other = await leadEagleWorkspace('deliveries-other', [
    ['integrations', 'VIEW'],
    ['integrations', 'MANAGE_CONFIGURATION'],
  ]);
  const connection = await prisma.integrationConnection.create({
    data: {
      tenantId: ws.tenantId,
      provider: 'custom_webhook',
      status: 'CONNECTED',
      credentials: wrapCredentials({ secret: SECRET }),
    },
  });
  key = connection.webhookKey;
  stored = `custom_webhook:${connection.id}`;

  const viewerRole = await prisma.role.create({
    data: { tenantId: ws.tenantId, key: 'viewer', name: 'Viewer', rank: 50, defaultScope: 'OWN' },
  });
  await grantPermissions(ws.tenantId, viewerRole.id, [['integrations', 'VIEW']]);
  await grantPermissions(ws.tenantId, viewerRole.id, [['leads', 'VIEW']], 'OWN');
  const viewer = await createWorkspaceUser({
    tenantId: ws.tenantId,
    roleId: viewerRole.id,
    email: `viewer@${ws.slug}.test`,
    fullName: 'Viewer',
  });
  viewerCookie = await createSessionToken(ws.tenantId, viewer.id);
  const outsiderRole = await prisma.role.create({
    data: { tenantId: ws.tenantId, key: 'outsider', name: 'Outsider', rank: 60, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(ws.tenantId, outsiderRole.id, [['leads', 'VIEW']]);
  const outsider = await createWorkspaceUser({
    tenantId: ws.tenantId,
    roleId: outsiderRole.id,
    email: `outsider@${ws.slug}.test`,
    fullName: 'Outsider',
  });
  outsiderCookie = await createSessionToken(ws.tenantId, outsider.id);

  // Older first: one the queue gave up on, one still retrying, one not yet worked.
  await event('gave-up', 30, { attempts: 5, errorMessage: 'tenant has no default lead stage' });
  await event('retrying', 20, { attempts: 2, errorMessage: 'connection reset' });
  await event('waiting', 10);
  // And the newest: a signed delivery the worker turned into a lead.
  const text = JSON.stringify({ name: 'Maya Saad', phone: number });
  expect((await deliver(key, text, { 'x-signature': sign(SECRET, text) })).status).toBe(200);
  const made = await prisma.webhookEvent.findFirstOrThrow({
    where: { tenantId: ws.tenantId, provider: stored, externalId: { notIn: ['gave-up', 'retrying', 'waiting'] } },
  });
  await handleJob('webhook', {
    name: 'lead-source.enquiry',
    data: { tenantId: ws.tenantId, provider: stored, externalId: made.externalId, source: 'custom_webhook' },
  });
});

afterAll(async () => {
  await ws.cleanup();
  await other.cleanup();
});

describe('the Deliveries tab', () => {
  it('lists every delivery newest first, with its outcome, attempts, last error and the lead it made', async () => {
    const res = await get(list, PATH, ws.cookie, params);
    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    const rows = res.body.deliveries as { status: string; attempts: number; error: string | null; lead: unknown }[];
    expect(rows.map((r) => r.status)).toEqual(['created', 'queued', 'retrying', 'dead_lettered']);
    const lead = await prisma.lead.findFirstOrThrow({
      where: { tenantId: ws.tenantId, phoneNormalized: `+971${number.slice(1)}` },
    });
    expect(rows[0]).toMatchObject({ attempts: 1, error: null, lead: { id: lead.id, name: 'Maya Saad' } });
    expect(rows[2]).toMatchObject({ attempts: 2, error: 'connection reset', lead: null });
    expect(rows[3]).toMatchObject({ attempts: 5, error: 'tenant has no default lead stage', lead: null });
  });

  it('names the lead only to a viewer whose scope reaches it', async () => {
    const res = await get(list, PATH, viewerCookie, params);
    expect(res.status).toBe(200);
    expect(res.body.deliveries[0]).toMatchObject({ status: 'created', lead: null });
    expect(JSON.stringify(res.body)).not.toContain('Maya Saad');
  });

  it('pages twenty-five at a time', async () => {
    await prisma.webhookEvent.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        tenantId: ws.tenantId,
        provider: stored,
        externalId: `old-${i}`,
        eventType: 'LEAD',
        payload: '{}',
        processed: true,
        createdAt: at(60 + i),
      })),
    });
    const first = await get(list, PATH, ws.cookie, params);
    expect(first.body.deliveries).toHaveLength(25);
    expect(first.body.hasMore).toBe(true);
    const second = await get(list, `${PATH}?page=2`, ws.cookie, params);
    expect(second.body.deliveries).toHaveLength(4);
    expect(second.body.deliveries.map((r: { status: string }) => r.status)).toEqual([
      'processed',
      'processed',
      'processed',
      'processed',
    ]);
    expect(second.body.hasMore).toBe(false);
  });

  it('replays a delivery the queue gave up on: queued again, its count reset, and audited', async () => {
    const dead = await prisma.webhookEvent.findFirstOrThrow({
      where: { tenantId: ws.tenantId, externalId: 'gave-up' },
    });
    vi.mocked(enqueue).mockClear();
    const res = await post(replay, PATH, { id: dead.id }, ws.cookie, params);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: dead.id, status: 'queued' });

    expect(await prisma.webhookEvent.findFirstOrThrow({ where: { tenantId: ws.tenantId, id: dead.id } })).toMatchObject(
      {
        processed: false,
        attempts: 0,
        errorMessage: null,
      },
    );
    expect(vi.mocked(enqueue)).toHaveBeenCalledWith(
      'webhook',
      'lead-source.enquiry',
      { tenantId: ws.tenantId, provider: stored, externalId: 'gave-up', source: 'custom_webhook' },
      { fresh: true },
    );
    const trail = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId: ws.tenantId, objectType: 'webhook_event', recordId: dead.id },
    });
    expect(trail).toMatchObject({ event: 'INTEGRATION_MODIFIED', actorUserId: ws.userId });
    expect(trail.metadata).toMatchObject({
      action: 'delivery.replayed',
      provider: 'custom_webhook',
      previous: { attempts: 5, error: 'tenant has no default lead stage' },
    });

    // The replay runs through the worker like the first delivery did.
    await work(ws.tenantId, 'custom_webhook');
    expect(await prisma.webhookEvent.findFirstOrThrow({ where: { tenantId: ws.tenantId, id: dead.id } })).toMatchObject(
      {
        processed: true,
        attempts: 1,
        outcome: 'created',
      },
    );
  });

  it('is for those who manage integrations, in their own workspace only', async () => {
    const dead = await prisma.webhookEvent.findFirstOrThrow({
      where: { tenantId: ws.tenantId, externalId: 'waiting' },
    });
    expect((await get(list, PATH, outsiderCookie, params)).status).toBe(403);
    expect((await post(replay, PATH, { id: dead.id }, outsiderCookie, params)).status).toBe(403);
    // Reading is not replaying.
    expect((await post(replay, PATH, { id: dead.id }, viewerCookie, params)).status).toBe(403);
    // Another workspace: no connection of its own, and this one's delivery is not found.
    expect((await get(list, PATH, other.cookie, params)).status).toBe(404);
    await prisma.integrationConnection.create({
      data: { tenantId: other.tenantId, provider: 'custom_webhook', status: 'CONNECTED' },
    });
    expect((await get(list, PATH, other.cookie, params)).body.deliveries).toEqual([]);
    expect((await post(replay, PATH, { id: dead.id }, other.cookie, params)).status).toBe(404);
    // Not a lead source.
    expect((await get(list, '/api/v1/integrations/twilio/deliveries', ws.cookie, { provider: 'twilio' })).status).toBe(
      404,
    );
  });

  it('is a screen under Admin, with the outcome in words and the lead linked', async () => {
    cookieJar.value = ws.cookie;
    const text = await pageText(
      DeliveriesPage({
        params: Promise.resolve({ workspaceSlug: ws.slug, provider: 'custom_webhook' }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(text).toContain('Custom webhook');
    expect(text).toContain('Deliveries');
    expect(text).toContain('Field mapping');
    expect(text).toContain('Lead created');
    expect(text).toContain('Maya Saad');
    expect(text).toContain(`/${ws.slug}/sales/leads/`);
    expect(text).toContain('Processed');
    expect(text).toContain('Last error');
  });
});
