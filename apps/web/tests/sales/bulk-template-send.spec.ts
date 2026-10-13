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

/** The test provider: nothing leaves the process, every send is recorded. */
const provider = vi.hoisted(() => ({
  name: 'test',
  sendTemplate: vi.fn(async () => ({ externalMessageId: `wamid.${Math.random()}`, status: 'sent' as const })),
  sendText: vi.fn(),
}));
vi.mock('@/lib/integrations/whatsapp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/integrations/whatsapp')>()),
  getWhatsAppProvider: () => provider,
}));
// Recorded, not queued: each case runs the jobs it means to, through the worker's dispatch.
vi.mock('@/lib/queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queue')>()),
  enqueue: vi.fn(async () => null),
}));

import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { enqueue } from '@/lib/queue';
import { mockOutbox } from '@/lib/mailer';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import { handleJob } from '@/workers/jobs';
import { POST as sendToLeads } from '@/app/api/v1/leads/messages/route';
import { SEND_SPACING_MS } from '@/services/leads/leadMessages';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture, type Grants } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { post } from '../helpers/request';

/**
 * The bulk template send on the lead grid (Lead Eagle audit row M4-38, the
 * owner's default: built, for roles with the communications permission). One
 * job per selected lead, spaced so a workspace sends one message a second,
 * through the same send as the lead page: each a Communication on its lead,
 * audited as the sender. Opted-out leads, leads with nowhere to send and leads
 * outside the sender's scope are skipped and counted; a batch is capped.
 */
let fixture: Fixture;
let tenantId: string;
let admin: string;
let adminId: string;
/** Its own leads, with the inbox's permission to send. */
let agent: string;
let agentId: string;
/** Its own leads, no `communications`. */
let quiet: string;

const TEMPLATE = 'wa:hello:en';
const queued = () =>
  vi.mocked(enqueue).mock.calls.filter(([queue, job]) => queue === 'campaign' && job === 'lead-message');
const payloads = () => queued().map(([, , payload]) => payload as Record<string, unknown>);
const delays = () => queued().map(([, , , opts]) => opts?.delayMs ?? 0);
const runQueued = async () => {
  for (const data of payloads()) await handleJob('campaign', { name: 'lead-message', data });
};
const send = (as: string, body: Record<string, unknown>) => post(sendToLeads, '/api/v1/leads/messages', body, as);

let n = 0;
async function lead(data: Record<string, unknown> = {}, tenant = () => tenantId, stageId = () => fixture.a.stageId) {
  n += 1;
  const phone = `+97150${String(Date.now()).slice(-5)}${String(n).padStart(2, '0')}`;
  return prisma.lead.create({
    data: {
      tenantId: tenant(),
      reference: `BK-${randomBytes(3).toString('hex')}`,
      fullName: `Bulk Lead ${n}`,
      firstName: `Bulk${n}`,
      phone,
      phoneNormalized: phone,
      stageId: stageId(),
      ownerId: agentId,
      ...data,
    },
  });
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  admin = fixture.a.cookie;
  adminId = fixture.a.userId;
  cookieJar.value = admin;
  await prisma.moduleEntitlement.updateMany({ where: { tenantId, module: 'SALES' }, data: { state: 'CANCELED' } });
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  await invalidateEntitlements(tenantId);

  for (const f of [fixture.a, fixture.b]) {
    const roleId = (
      await prisma.user.findFirstOrThrow({ where: { tenantId: f.tenantId, id: f.userId }, select: { roleId: true } })
    ).roleId!;
    await grantPermissions(f.tenantId, roleId, [
      ['communications', 'VIEW'],
      ['communications', 'CREATE'],
    ]);
  }
  const role = async (key: string, grants: Grants) => {
    const suffix = randomBytes(4).toString('hex');
    const row = await prisma.role.create({ data: { tenantId, key: `${key}-${suffix}`, name: key, rank: 80 } });
    await grantPermissions(tenantId, row.id, grants, 'OWN');
    const user = await createWorkspaceUser({
      tenantId,
      roleId: row.id,
      email: `${key}-${suffix}@a.test`,
      fullName: `The ${key}`,
    });
    return { id: user.id, cookie: await createSessionToken(tenantId, user.id) };
  };
  ({ id: agentId, cookie: agent } = await role('agent', [
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
    ['communications', 'VIEW'],
    ['communications', 'CREATE'],
  ]));
  quiet = (
    await role('quiet', [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
    ])
  ).cookie;

  await prisma.integrationConnection.create({
    data: {
      tenantId,
      provider: 'meta',
      status: 'CONNECTED',
      credentials: { accessToken: 'test-token', phoneNumberId: '5550001' },
    },
  });
  await prisma.messageTemplate.create({
    data: {
      tenantId,
      key: TEMPLATE,
      name: 'hello',
      channel: 'WHATSAPP',
      language: 'en',
      body: 'Hello {{1}}, {{2}} here.',
      mergeFields: ['1', '2'],
      approvalState: 'APPROVED',
    },
  });
  for (const id of [tenantId, fixture.b.tenantId]) {
    await prisma.messageTemplate.create({
      data: {
        tenantId: id,
        key: 'email:news',
        name: 'News',
        channel: 'EMAIL',
        subject: 'News for {{1}}',
        body: 'Hi {{1}}',
      },
    });
  }
});

afterAll(async () => {
  await fixture.cleanup();
});

beforeEach(() => {
  vi.mocked(enqueue).mockClear();
  provider.sendTemplate.mockClear();
});

describe('Send template on the lead grid (M4-38)', () => {
  it('queues one send per lead it may message, and counts the opted-out, the unreachable and the out of reach', async () => {
    const [first, second] = [await lead(), await lead()];
    const optedOut = await lead({ whatsappOptOut: true });
    const landline = await lead({ phoneIsWhatsapp: false });
    const noPhone = await lead({ phone: null, phoneNormalized: null });
    // The administrator's: outside an OWN agent's reach, as a missing id is.
    const others = await lead({ ownerId: adminId });

    const res = await send(agent, {
      leadIds: [first.id, second.id, optedOut.id, landline.id, noPhone.id, others.id, fixture.b.leadIds[0]!],
      channel: 'WHATSAPP',
      templateKey: TEMPLATE,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      total: 7,
      queued: 2,
      skipped: { optedOut: 1, noRecipient: 2, notFound: 2 },
    });
    expect(payloads().map((p) => p.leadId)).toEqual([first.id, second.id]);
    expect(payloads()[0]).toMatchObject({
      tenantId,
      actorId: agentId,
      channel: 'WHATSAPP',
      templateKey: TEMPLATE,
      batchId: res.body.batchId,
    });
    // Nothing is sent until a job runs.
    expect(provider.sendTemplate).not.toHaveBeenCalled();

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId, objectType: 'lead-message-batch', recordId: res.body.batchId },
    });
    expect(audit).toMatchObject({ actorUserId: agentId, event: 'RECORD_CREATED' });
    expect(audit.metadata).toMatchObject({ channel: 'WHATSAPP', template: TEMPLATE, queued: 2 });
  });

  it('throttles per workspace: one message a second, a second batch after the first', async () => {
    const leads = [await lead(), await lead(), await lead(), await lead()];
    // A delay is from the moment of its request: bracket each request to compare when they send.
    const startA = Date.now();
    await send(agent, { leadIds: [leads[0]!.id, leads[1]!.id], channel: 'WHATSAPP', templateKey: TEMPLATE });
    const endA = Date.now();
    const [a0, a1] = delays();
    expect(a1! - a0!).toBe(SEND_SPACING_MS);
    vi.mocked(enqueue).mockClear();

    const startB = Date.now();
    await send(agent, { leadIds: [leads[2]!.id, leads[3]!.id], channel: 'WHATSAPP', templateKey: TEMPLATE });
    const endB = Date.now();
    const [b0, b1] = delays();
    expect(b1! - b0!).toBe(SEND_SPACING_MS);
    // The second batch's first goes one step after the first batch's last, not alongside it.
    expect(endB + b0!).toBeGreaterThanOrEqual(startA + a1! + SEND_SPACING_MS);
    expect(startB + b0!).toBeLessThanOrEqual(endA + a1! + SEND_SPACING_MS);
    vi.mocked(enqueue).mockClear();

    // Another workspace waits for none of them.
    const theirs = await prisma.lead.update({
      where: { tenantId: fixture.b.tenantId, id: fixture.b.leadIds[0]! },
      data: { email: 'theirs@client.test' },
    });
    const other = await send(fixture.b.cookie, { leadIds: [theirs.id], channel: 'EMAIL', templateKey: 'email:news' });
    expect(other.status, JSON.stringify(other.body)).toBe(200);
    expect(delays()).toEqual([0]);
  });

  it('each job sends through the lead send: a Communication on its lead, audited as the sender, and only once', async () => {
    const [first, second] = [await lead(), await lead()];
    const res = await send(agent, { leadIds: [first.id, second.id], channel: 'WHATSAPP', templateKey: TEMPLATE });
    await runQueued();

    expect(provider.sendTemplate).toHaveBeenCalledTimes(2);
    expect(provider.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: first.phoneNormalized!.slice(1),
        template: expect.objectContaining({
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: first.firstName },
                { type: 'text', text: 'The agent' },
              ],
            },
          ],
        }),
      }),
    );
    for (const sent of [first, second]) {
      const [message, ...more] = await prisma.communication.findMany({ where: { tenantId, leadId: sent.id } });
      expect(more).toHaveLength(0);
      expect(message).toMatchObject({ channel: 'WHATSAPP', status: 'SENT', createdById: agentId });
      expect(message!.metadata).toMatchObject({ batchId: res.body.batchId });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { tenantId, event: 'MESSAGE_SENT', recordId: sent.id },
      });
      expect(audit).toMatchObject({ actorUserId: agentId, actorType: 'USER' });
      expect(audit.metadata).toMatchObject({ batchId: res.body.batchId });
    }

    // A job run again (a retry) finds its message and sends nothing.
    await runQueued();
    expect(provider.sendTemplate).toHaveBeenCalledTimes(2);
    expect(await prisma.communication.count({ where: { tenantId, leadId: { in: [first.id, second.id] } } })).toBe(2);
  });

  it('a lead that opts out after it was queued is skipped when its turn comes', async () => {
    const late = await lead();
    await send(agent, { leadIds: [late.id], channel: 'WHATSAPP', templateKey: TEMPLATE });
    await prisma.lead.update({ where: { tenantId, id: late.id }, data: { whatsappOptOut: true } });
    await runQueued();
    expect(provider.sendTemplate).not.toHaveBeenCalled();
    expect(await prisma.communication.count({ where: { tenantId, leadId: late.id } })).toBe(0);
  });

  it('sends email templates too, skipping leads with no address or opted out of email', async () => {
    mockOutbox.clear();
    const mailed = await lead({ email: 'bulk.one@client.test' });
    const optedOut = await lead({ email: 'bulk.two@client.test', emailOptOut: true });
    const none = await lead({ email: null });
    const res = await send(agent, {
      leadIds: [mailed.id, optedOut.id, none.id],
      channel: 'EMAIL',
      templateKey: 'email:news',
    });
    expect(res.body).toMatchObject({ queued: 1, skipped: { optedOut: 1, noRecipient: 1, notFound: 0 } });
    await runQueued();
    expect(mockOutbox.lastTo('bulk.one@client.test')).toMatchObject({
      subject: `News for ${mailed.firstName}`,
      body: `Hi ${mailed.firstName}`,
    });
    expect(mockOutbox.lastTo('bulk.two@client.test')).toBeUndefined();
  });

  it('caps a batch, needs the permission to send, and refuses a template it cannot send before queueing', async () => {
    const ids = Array.from({ length: 101 }, () => fixture.a.leadIds[0]!);
    expect((await send(agent, { leadIds: ids, channel: 'WHATSAPP', templateKey: TEMPLATE })).status).toBe(422);
    const one = await lead();
    expect((await send(quiet, { leadIds: [one.id], channel: 'WHATSAPP', templateKey: TEMPLATE })).status).toBe(403);
    expect((await send(agent, { leadIds: [one.id], channel: 'WHATSAPP', templateKey: 'wa:missing:en' })).status).toBe(
      404,
    );
    expect(queued()).toEqual([]);
  });
});
