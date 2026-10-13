import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { wrapCredentials } from '@/lib/integrations/connection';
import { POST as telephonyWebhook } from '@/app/api/v1/webhooks/telephony/[key]/route';
import { PUT as configure } from '@/app/api/v1/integrations/[provider]/route';
import { leadEagleWorkspace } from '../helpers/leadSource';

/**
 * An inbound or missed call from a number no lead or contact holds (audit row
 * M6-11): a lead through the same intake as the portals (source Telephony,
 * detail `<vendor>:<number dialled>`), queued for distribution, and the call
 * on it — unless the telephony connection's "Create leads from unknown
 * callers" is switched off. Twilio-shaped callbacks signed with a test token:
 * no telephony account is involved.
 */
type Ws = Awaited<ReturnType<typeof leadEagleWorkspace>>;
let ws: Ws;
let hrOnly: Ws;
const keys = new Map<string, string>();
const AUTH_TOKEN = 'twilio-token-for-unknown-callers';
const LINE = '+97144000000';
let sequence = 0;

function twilio(key: string, params: Record<string, string>) {
  const body = new URLSearchParams(params).toString();
  const url = `${env.APP_URL.replace(/\/$/, '')}/api/v1/webhooks/telephony/${key}`;
  const sorted = new URLSearchParams(body);
  let payload = url;
  for (const name of [...sorted.keys()].sort()) payload += name + sorted.getAll(name).join('');
  const signature = createHmac('sha1', AUTH_TOKEN).update(payload, 'utf8').digest('base64');
  return telephonyWebhook(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature },
      body,
    }),
    { params: Promise.resolve({ key }) },
  );
}

/** One inbound call from `from`: its first callback, and optionally the one that ends it. */
async function ring(tenantId: string, from: string, end?: 'no-answer' | 'completed') {
  const sid = `CAunknown${Date.now()}${++sequence}`;
  const key = keys.get(tenantId)!;
  const first = await twilio(key, {
    CallSid: sid,
    CallStatus: 'ringing',
    Direction: 'inbound',
    From: from,
    To: LINE,
    SequenceNumber: '0',
  });
  expect(first.status).toBe(200);
  if (end) await twilio(key, { CallSid: sid, CallStatus: end, Direction: 'inbound', From: from, SequenceNumber: '1' });
  return prisma.call.findFirstOrThrow({ where: { tenantId, externalCallId: sid } });
}
const leadsWith = (tenantId: string, phoneNormalized: string) =>
  prisma.lead.findMany({ where: { tenantId, phoneNormalized } });
const setting = (tenantId: string, value: boolean) =>
  prisma.integrationConnection.update({
    where: { tenantId_provider: { tenantId, provider: 'twilio' } },
    data: { metadata: { callerNumber: LINE, createLeadsFromUnknownCallers: value } },
  });

beforeAll(async () => {
  ws = await leadEagleWorkspace('tel-unknown', [
    ['integrations', 'VIEW'],
    ['integrations', 'MANAGE_CONFIGURATION'],
  ]);
  hrOnly = await leadEagleWorkspace('tel-hr', [['integrations', 'VIEW']]);
  await prisma.moduleEntitlement.updateMany({ where: { tenantId: hrOnly.tenantId }, data: { module: 'HRMS' } });
  for (const { tenantId } of [ws, hrOnly]) {
    const connection = await prisma.integrationConnection.create({
      data: {
        tenantId,
        provider: 'twilio',
        status: 'CONNECTED',
        credentials: wrapCredentials({ accountSid: 'ACunknowncallers', authToken: AUTH_TOKEN }),
        metadata: { callerNumber: LINE },
      },
    });
    keys.set(tenantId, connection.webhookKey);
  }
});

afterAll(async () => {
  for (const w of [ws, hrOnly]) await w?.cleanup();
});

describe('a call from a number nobody holds', () => {
  it('makes a Telephony lead, queued for distribution, and the missed call is on it', async () => {
    const call = await ring(ws.tenantId, '+971500003301', 'no-answer');

    const [lead, ...more] = await leadsWith(ws.tenantId, '+971500003301');
    expect(more).toHaveLength(0);
    expect(lead).toMatchObject({
      fullName: 'Unknown caller',
      source: 'TELEPHONY',
      sourceDetail: `twilio:${LINE}`,
      ownerId: null,
      consentStatus: 'IMPLIED',
    });
    expect(call).toMatchObject({ leadId: lead!.id, direction: 'INBOUND', status: 'MISSED', callerId: ws.userId });
    const note = await prisma.activity.findFirstOrThrow({ where: { tenantId: ws.tenantId, leadId: lead!.id } });
    expect(note.notes).toContain('Enquiry via Telephony');
    expect(
      await prisma.auditLog.count({
        where: { tenantId: ws.tenantId, objectType: 'lead', recordId: lead!.id, event: 'RECORD_CREATED' },
      }),
    ).toBe(1);
  });

  it('puts the next call from that number on the same lead, with nothing new written', async () => {
    const [lead] = await leadsWith(ws.tenantId, '+971500003301');
    const call = await ring(ws.tenantId, '0500003301', 'completed');
    expect(call.leadId).toBe(lead!.id);
    expect(await leadsWith(ws.tenantId, '+971500003301')).toHaveLength(1);
    expect(await prisma.activity.count({ where: { tenantId: ws.tenantId, leadId: lead!.id } })).toBe(1);
  });

  it('joins the lead that holds the number as a second one, whose owner takes the call and is told', async () => {
    const owner = await prisma.user.create({
      data: {
        tenantId: ws.tenantId,
        email: `owner@${ws.slug}.test`,
        fullName: 'Lead Owner',
        roleId: (await prisma.user.findFirstOrThrow({ where: { tenantId: ws.tenantId, id: ws.userId } })).roleId,
        status: 'ACTIVE',
      },
    });
    const stage = await prisma.leadStage.findFirstOrThrow({ where: { tenantId: ws.tenantId, isDefault: true } });
    const lead = await prisma.lead.create({
      data: {
        tenantId: ws.tenantId,
        reference: `L-TEL-${Date.now()}`,
        fullName: 'Second Number',
        phone: '+971500003390',
        phoneNormalized: '+971500003390',
        stageId: stage.id,
        ownerId: owner.id,
        phones: { create: { tenantId: ws.tenantId, raw: '+971500003391', normalized: '+971500003391' } },
      },
    });
    const before = await prisma.lead.count({ where: { tenantId: ws.tenantId } });

    const call = await ring(ws.tenantId, '+971500003391');
    expect(call).toMatchObject({ leadId: lead.id, callerId: owner.id });
    expect(await prisma.lead.count({ where: { tenantId: ws.tenantId } })).toBe(before);
    expect(
      await prisma.notification.count({
        where: { tenantId: ws.tenantId, userId: owner.id, recordId: lead.id, kind: 'lead.enquiry' },
      }),
    ).toBe(1);
  });

  it('records the call as before, against the most senior user and no lead, when switched off', async () => {
    await setting(ws.tenantId, false);
    const call = await ring(ws.tenantId, '+971500003302', 'no-answer');
    expect(call).toMatchObject({ leadId: null, callerId: ws.userId, status: 'MISSED' });
    expect(await leadsWith(ws.tenantId, '+971500003302')).toHaveLength(0);
    await setting(ws.tenantId, true);
  });

  it('makes no lead in a workspace without a lead product', async () => {
    const call = await ring(hrOnly.tenantId, '+971500003303', 'no-answer');
    expect(call.leadId).toBeNull();
    expect(await leadsWith(hrOnly.tenantId, '+971500003303')).toHaveLength(0);
  });
});

describe('the "Create leads from unknown callers" setting', () => {
  const put = (settings: Record<string, unknown>) =>
    configure(
      new Request('http://localhost/api/v1/integrations/twilio', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: ws.cookie },
        body: JSON.stringify({ settings, skipVerification: true }),
      }),
      { params: Promise.resolve({ provider: 'twilio' }) },
    );

  it('is saved on the telephony connection from Integrations', async () => {
    const res = await put({ createLeadsFromUnknownCallers: false });
    expect(res.status).toBe(200);
    const row = await prisma.integrationConnection.findUniqueOrThrow({
      where: { tenantId_provider: { tenantId: ws.tenantId, provider: 'twilio' } },
    });
    expect(row.metadata).toMatchObject({ callerNumber: LINE, createLeadsFromUnknownCallers: false });
  });

  it('takes on or off, nothing else', async () => {
    expect((await put({ createLeadsFromUnknownCallers: 'yes' })).status).toBe(422);
  });
});
