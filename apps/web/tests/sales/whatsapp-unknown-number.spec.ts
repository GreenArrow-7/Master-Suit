import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Facebook's side of a reconnect: the state this server minted, and the Page it hands back.
const oauthState = vi.hoisted(() => ({
  value: null as null | { tenantId: string; actorId: string; returnTo: string },
}));
vi.mock('@/services/meta/oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/meta/oauth')>()),
  metaOAuthConfigured: () => true,
  consumeMetaOAuthState: async () => oauthState.value,
  completeMetaOAuth: async () => ({
    accessToken: 'page-token',
    expiresAt: null,
    pageId: 'page-1',
    pageName: 'Agency Page',
    instagramId: null,
    instagramHandle: null,
    scopes: ['pages_show_list'],
    businessName: null,
  }),
}));

import { prisma } from '@/lib/db';
import { wrapCredentials } from '@/lib/integrations/connection';
import type { NormalizedMetaEvent } from '@/lib/integrations/meta/events';
import { GET as board } from '@/app/api/v1/integrations/route';
import { PUT as configure } from '@/app/api/v1/integrations/[provider]/route';
import { GET as metaCallback } from '@/app/api/v1/integrations/meta/callback/route';
import { applyMetaEvent } from '@/services/meta/applyEvent';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import { leadEagleWorkspace } from '../helpers/leadSource';
import { get } from '../helpers/request';

/**
 * A WhatsApp message from a number no lead holds (audit row M6-10, owner's
 * default): a lead through the same intake as the portals, the message its
 * note, when the WhatsApp connection's "Create leads from new numbers" is on.
 * It is on unless switched off in a Lead Eagle workspace; elsewhere a new
 * number still opens a conversation only, as before, unless switched on.
 */
type Ws = Awaited<ReturnType<typeof leadEagleWorkspace>>;
let ws: Ws;
let sales: Ws;
let hrOnly: Ws;
const connections = new Map<string, string>();
let sequence = 0;

const ADMIN = [
  ['integrations', 'VIEW'],
  ['integrations', 'MANAGE_CONFIGURATION'],
] as const;

/** The WhatsApp Business connection, as Integrations stores it. */
const connectWhatsApp = async (tenantId: string, metadata: Record<string, unknown> = {}) => {
  const row = await prisma.integrationConnection.create({
    data: {
      tenantId,
      provider: 'meta',
      status: 'CONNECTED',
      credentials: wrapCredentials({ accessToken: 'token', appSecret: 'app-secret', webhookVerifyToken: 'verify' }),
      metadata,
    },
  });
  connections.set(tenantId, row.id);
};
const setting = (tenantId: string, value: boolean) =>
  prisma.integrationConnection.update({
    where: { tenantId_provider: { tenantId, provider: 'meta' } },
    data: { metadata: { createLeadsFromNewNumbers: value } },
  });

/** A message from `from` (a WhatsApp id: the number in full, no `+`), through the worker's own function. */
const receive = (tenantId: string, from: string, text: string, displayName?: string) => {
  const id = `wamid.${Date.now()}.${++sequence}`;
  const event: NormalizedMetaEvent = {
    kind: 'MESSAGE_RECEIVED',
    externalId: id,
    messageId: id,
    occurredAt: new Date(),
    threadId: from,
    displayName,
    text,
    assetId: 'phone-number-id',
  };
  return applyMetaEvent({ tenantId, connectionId: connections.get(tenantId)!, event });
};
const leadsWith = (tenantId: string, phoneNormalized: string) =>
  prisma.lead.findMany({ where: { tenantId, phoneNormalized } });

beforeAll(async () => {
  ws = await leadEagleWorkspace('wa-new', ADMIN);
  sales = await leadEagleWorkspace('wa-sales', ADMIN);
  await prisma.moduleEntitlement.updateMany({ where: { tenantId: sales.tenantId }, data: { module: 'SALES' } });
  hrOnly = await leadEagleWorkspace('wa-hr', ADMIN);
  await prisma.moduleEntitlement.updateMany({ where: { tenantId: hrOnly.tenantId }, data: { module: 'HRMS' } });
  for (const { tenantId } of [ws, sales, hrOnly]) await connectWhatsApp(tenantId);
});

afterAll(async () => {
  for (const w of [ws, sales, hrOnly]) await w?.cleanup();
});

describe('a WhatsApp message from a new number', () => {
  it('makes a lead in a Lead Eagle workspace, the message its note, and the conversation is on it', async () => {
    await receive(ws.tenantId, '971500002201', 'Hi, I saw your 2BR in JVC. Still available?', 'Layla Hassan');

    const [lead, ...more] = await leadsWith(ws.tenantId, '+971500002201');
    expect(more).toHaveLength(0);
    expect(lead).toMatchObject({
      fullName: 'Layla Hassan',
      source: 'CHAT',
      sourceDetail: 'whatsapp',
      consentStatus: 'UNKNOWN',
    });
    const note = await prisma.activity.findFirstOrThrow({ where: { tenantId: ws.tenantId, leadId: lead!.id } });
    expect(note.notes).toContain('Enquiry via WhatsApp');
    expect(note.notes).toContain('Hi, I saw your 2BR in JVC. Still available?');
    expect(
      await prisma.auditLog.count({
        where: { tenantId: ws.tenantId, objectType: 'lead', recordId: lead!.id, event: 'RECORD_CREATED' },
      }),
    ).toBe(1);
    const thread = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: ws.tenantId, channel: 'WHATSAPP', externalId: '971500002201' },
      include: { communications: true },
    });
    expect(thread.leadId).toBe(lead!.id);
    expect(thread.communications.map((m) => m.leadId)).toEqual([lead!.id]);
  });

  it('joins the lead it made on the next message, with no second lead or note', async () => {
    await receive(ws.tenantId, '971500002201', 'Can I view it on Saturday?', 'Layla Hassan');

    const [lead, ...more] = await leadsWith(ws.tenantId, '+971500002201');
    expect(more).toHaveLength(0);
    expect(await prisma.activity.count({ where: { tenantId: ws.tenantId, leadId: lead!.id } })).toBe(1);
    expect(await prisma.communication.count({ where: { tenantId: ws.tenantId, leadId: lead!.id } })).toBe(2);
  });

  it('reads a number from abroad as dialled from abroad, and names a lead with no profile name', async () => {
    await receive(ws.tenantId, '447700900123', 'Hello from London');
    const [lead] = await leadsWith(ws.tenantId, '+447700900123');
    expect(lead).toMatchObject({ fullName: 'WhatsApp contact', phoneNormalized: '+447700900123' });
  });

  it('attaches to the lead that already holds the number, as before', async () => {
    const stage = await prisma.leadStage.findFirstOrThrow({ where: { tenantId: ws.tenantId, isDefault: true } });
    const known = await prisma.lead.create({
      data: {
        tenantId: ws.tenantId,
        reference: `L-WA-${Date.now()}`,
        fullName: 'Known Client',
        phone: '+971500002250',
        phoneNormalized: '+971500002250',
        stageId: stage.id,
      },
    });
    const before = await prisma.lead.count({ where: { tenantId: ws.tenantId } });
    await receive(ws.tenantId, '971500002250', 'Any news?');
    expect(await prisma.lead.count({ where: { tenantId: ws.tenantId } })).toBe(before);
    expect(await prisma.activity.count({ where: { tenantId: ws.tenantId, leadId: known.id } })).toBe(0);
    const thread = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: ws.tenantId, externalId: '971500002250' },
      include: { communications: true },
    });
    expect(thread.leadId).toBe(known.id);
    expect(thread.communications.map((m) => m.leadId)).toEqual([known.id]);
  });

  it('makes no lead of a number a contact holds', async () => {
    await prisma.contact.create({
      data: {
        tenantId: ws.tenantId,
        reference: `C-WA-${Date.now()}`,
        fullName: 'Known Customer',
        phone: '+971500002260',
        phoneNormalized: '+971500002260',
      },
    });
    await receive(ws.tenantId, '971500002260', 'Hello again');
    expect(await leadsWith(ws.tenantId, '+971500002260')).toHaveLength(0);
    const thread = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: ws.tenantId, externalId: '971500002260' },
    });
    expect(thread.leadId).toBeNull();
  });

  it('makes no lead of a colleague writing from their own phone', async () => {
    await prisma.user.update({ where: { id: ws.userId, tenantId: ws.tenantId }, data: { phone: '+971 50 000 2270' } });
    await receive(ws.tenantId, '971500002270', 'Running late');
    expect(await leadsWith(ws.tenantId, '+971500002270')).toHaveLength(0);
  });

  it('still keeps the message when the lead cannot be made', async () => {
    await prisma.leadStage.updateMany({ where: { tenantId: ws.tenantId }, data: { isDefault: false } });
    try {
      await receive(ws.tenantId, '971500002280', 'Is anyone there?');
    } finally {
      await prisma.leadStage.updateMany({ where: { tenantId: ws.tenantId }, data: { isDefault: true } });
    }
    expect(await leadsWith(ws.tenantId, '+971500002280')).toHaveLength(0);
    const thread = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: ws.tenantId, externalId: '971500002280' },
      include: { communications: true },
    });
    expect(thread.leadId).toBeNull();
    expect(thread.communications).toHaveLength(1);
  });

  it('opens a conversation only when the connection says not to make leads', async () => {
    await setting(ws.tenantId, false);
    await receive(ws.tenantId, '971500002299', 'Wrong number?');
    expect(await leadsWith(ws.tenantId, '+971500002299')).toHaveLength(0);
    const thread = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: ws.tenantId, externalId: '971500002299' },
    });
    expect(thread.leadId).toBeNull();
    await setting(ws.tenantId, true);
  });

  it('leaves a Sales workspace as it was until the setting is switched on', async () => {
    await receive(sales.tenantId, '971500002301', 'Hello');
    expect(await leadsWith(sales.tenantId, '+971500002301')).toHaveLength(0);

    await setting(sales.tenantId, true);
    await receive(sales.tenantId, '971500002302', 'Hello again');
    expect(await leadsWith(sales.tenantId, '+971500002302')).toHaveLength(1);
  });

  it('never makes a lead in a workspace without a lead product, whatever the setting says', async () => {
    await setting(hrOnly.tenantId, true);
    await receive(hrOnly.tenantId, '971500002401', 'Hello');
    expect(await leadsWith(hrOnly.tenantId, '+971500002401')).toHaveLength(0);
  });
});

describe('the "Create leads from new numbers" setting', () => {
  const put = (settings: Record<string, unknown>) =>
    configure(
      new Request('http://localhost/api/v1/integrations/meta', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: ws.cookie },
        body: JSON.stringify({ settings, skipVerification: true }),
      }),
      { params: Promise.resolve({ provider: 'meta' }) },
    );

  it('is a switch on the WhatsApp Business connection, saved from Integrations', async () => {
    const listed = await get(board, '/api/v1/integrations', ws.cookie);
    const card = listed.body.providers.find((p: { key: string }) => p.key === 'meta');
    expect(card.settingFields).toContainEqual(
      expect.objectContaining({
        key: 'createLeadsFromNewNumbers',
        label: 'Create leads from new numbers',
        toggle: true,
      }),
    );

    const res = await put({ createLeadsFromNewNumbers: false });
    expect(res.status).toBe(200);
    const row = await prisma.integrationConnection.findUniqueOrThrow({
      where: { tenantId_provider: { tenantId: ws.tenantId, provider: 'meta' } },
    });
    expect((row.metadata as Record<string, unknown>).createLeadsFromNewNumbers).toBe(false);
  });

  it('takes on or off, nothing else', async () => {
    expect((await put({ createLeadsFromNewNumbers: 'no' })).status).toBe(422);
  });

  it('survives reconnecting Facebook', async () => {
    // Saved off by the test above.
    oauthState.value = { tenantId: ws.tenantId, actorId: ws.userId, returnTo: '/' };
    const res = await metaCallback(
      new Request('http://localhost/api/v1/integrations/meta/callback?state=s&code=c', {
        headers: { cookie: ws.cookie },
      }),
    );
    expect(res.headers.get('location')).toContain('page=');
    const row = await prisma.integrationConnection.findUniqueOrThrow({
      where: { tenantId_provider: { tenantId: ws.tenantId, provider: 'meta' } },
    });
    expect(row.metadata).toMatchObject({ pageId: 'page-1', createLeadsFromNewNumbers: false });
  });

  it('is listed as it acts: its default where unsaved, and not at all without a lead product', async () => {
    const card = async (w: Ws) =>
      (await get(board, '/api/v1/integrations', w.cookie)).body.providers.find(
        (p: { key: string }) => p.key === 'meta',
      );
    const fresh = await leadEagleWorkspace('wa-list', ADMIN);
    try {
      await connectWhatsApp(fresh.tenantId);
      expect((await card(fresh)).settings.createLeadsFromNewNumbers).toBe(true);
      await prisma.moduleEntitlement.updateMany({ where: { tenantId: fresh.tenantId }, data: { module: 'SALES' } });
      await invalidateEntitlements(fresh.tenantId);
      expect((await card(fresh)).settings.createLeadsFromNewNumbers).toBe(false);
      await prisma.moduleEntitlement.updateMany({ where: { tenantId: fresh.tenantId }, data: { module: 'HRMS' } });
      await invalidateEntitlements(fresh.tenantId);
      const hr = await card(fresh);
      expect(hr.settingFields.map((f: { key: string }) => f.key)).not.toContain('createLeadsFromNewNumbers');
      expect(hr.settings).not.toHaveProperty('createLeadsFromNewNumbers');
    } finally {
      await fresh.cleanup();
    }
  });
});
