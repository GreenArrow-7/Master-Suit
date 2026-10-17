import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The vendor check a save runs; a switch must not need it.
const verify = vi.hoisted(() => vi.fn(async () => ({ ok: false as const, detail: 'Twilio did not answer.' })));
vi.mock('@/lib/integrations/verify', () => ({ verifyConnection: verify }));

import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { wrapCredentials } from '@/lib/integrations/connection';
import { POST as telephonyWebhook } from '@/app/api/v1/webhooks/telephony/[key]/route';
import { PUT as configure } from '@/app/api/v1/integrations/[provider]/route';
import { handleJob } from '@/workers/jobs';
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
async function ring(tenantId: string, from: string, end?: 'no-answer' | 'completed', to = LINE) {
  const sid = `CAunknown${Date.now()}${++sequence}`;
  const key = keys.get(tenantId)!;
  const first = await twilio(key, {
    CallSid: sid,
    CallStatus: 'ringing',
    Direction: 'inbound',
    From: from,
    To: to,
    SequenceNumber: '0',
  });
  expect(first.status).toBe(200);
  if (end) await twilio(key, { CallSid: sid, CallStatus: end, Direction: 'inbound', From: from, SequenceNumber: '1' });
  return prisma.call.findFirstOrThrow({ where: { tenantId, externalCallId: sid } });
}
const noteOn = async (leadId: string) =>
  (await prisma.activity.findFirstOrThrow({ where: { tenantId: ws.tenantId, leadId } })).notes;
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
    // Dialled on another of the account's numbers: the detail is the line this connection advertises.
    const call = await ring(ws.tenantId, '+971500003301', 'no-answer', '+97144000099');

    const [lead, ...more] = await leadsWith(ws.tenantId, '+971500003301');
    expect(more).toHaveLength(0);
    expect(lead).toMatchObject({
      fullName: 'Unknown caller',
      source: 'TELEPHONY',
      sourceDetail: `twilio:${LINE}`,
      ownerId: null,
      // A call is not a request for marketing: campaigns pass it by until somebody records consent.
      consentStatus: 'UNKNOWN',
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

  it('names the number dialled when the connection has no line of its own', async () => {
    await prisma.integrationConnection.update({
      where: { tenantId_provider: { tenantId: ws.tenantId, provider: 'twilio' } },
      data: { metadata: {} },
    });
    await ring(ws.tenantId, '+971500003304', 'no-answer', '+97144000099');
    const [lead] = await leadsWith(ws.tenantId, '+971500003304');
    expect(lead?.sourceDetail).toBe('twilio:+97144000099');
    await setting(ws.tenantId, true);
  });

  it('puts a call from a lead’s second number on that lead, like its main one, and writes nothing', async () => {
    const owner = await prisma.user.create({
      data: {
        tenantId: ws.tenantId,
        email: `owner@${ws.slug}.test`,
        fullName: 'Lead Owner',
        // Junior to the admin, who stays the most senior user the unmatched calls go to.
        roleId: (
          await prisma.role.create({
            data: { tenantId: ws.tenantId, key: `owner-${Date.now()}`, name: 'Owner', rank: 40 },
          })
        ).id,
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

    for (let i = 0; i < 2; i++) {
      const call = await ring(ws.tenantId, '+971500003391', 'completed');
      expect(call).toMatchObject({ leadId: lead.id, callerId: owner.id });
    }
    expect(await prisma.lead.count({ where: { tenantId: ws.tenantId } })).toBe(before);
    expect(await prisma.activity.count({ where: { tenantId: ws.tenantId, leadId: lead.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { tenantId: ws.tenantId, recordId: lead.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { tenantId: ws.tenantId, recordId: lead.id } })).toBe(0);
  });

  it('puts a contact’s call on the contact and makes no lead of it', async () => {
    const contact = await prisma.contact.create({
      data: {
        tenantId: ws.tenantId,
        reference: `C-TEL-${Date.now()}`,
        fullName: 'Known Customer',
        phone: '+971500003392',
        phoneNormalized: '+971500003392',
        ownerId: ws.userId,
      },
    });
    const call = await ring(ws.tenantId, '+971500003392', 'no-answer');
    expect(call).toMatchObject({ contactId: contact.id, leadId: null });
    expect(await leadsWith(ws.tenantId, '+971500003392')).toHaveLength(0);
  });

  it('makes no lead of a colleague calling from their own phone', async () => {
    await prisma.user.update({ where: { id: ws.userId, tenantId: ws.tenantId }, data: { phone: '050 000 3393' } });
    const call = await ring(ws.tenantId, '+971500003393', 'no-answer');
    expect(call.leadId).toBeNull();
    expect(await leadsWith(ws.tenantId, '+971500003393')).toHaveLength(0);
  });

  it('makes no lead of a withheld number, and keeps withheld callers apart', async () => {
    // Twilio's stand-ins for a caller with no caller ID, and the word some vendors send instead.
    for (const from of ['+266696687', '+266696687', '+86282452253', '+7378742833', '+2562533', 'anonymous']) {
      const call = await ring(ws.tenantId, from, 'no-answer');
      expect(call).toMatchObject({ leadId: null, contactId: null });
    }
    expect(
      await prisma.lead.count({
        where: {
          tenantId: ws.tenantId,
          phoneNormalized: { in: ['+266696687', '+86282452253', '+7378742833', '+2562533'] },
        },
      }),
    ).toBe(0);
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

describe('a tracking number tagged with its source (M9-06)', () => {
  const TAGGED = '+97144000001';
  const tag = (trackingNumbers: string) =>
    prisma.integrationConnection.update({
      where: { tenantId_provider: { tenantId: ws.tenantId, provider: 'twilio' } },
      data: { metadata: { callerNumber: LINE, trackingNumbers } },
    });
  afterAll(() => setting(ws.tenantId, true));

  it('gives an unknown caller’s lead the source its number is tagged with, and names the line', async () => {
    await tag(`${TAGGED} = Google Ads; +97144000002 = Marina launch`);
    await ring(ws.tenantId, '+971500003311', 'no-answer', '044000001');
    const [lead] = await leadsWith(ws.tenantId, '+971500003311');
    const googleAds = await prisma.leadSource.findFirstOrThrow({ where: { tenantId: ws.tenantId, key: 'google_ads' } });
    expect(lead).toMatchObject({ source: 'TELEPHONY', sourceDetail: `twilio:${TAGGED}`, sourceId: googleAds.id });
    const note = await noteOn(lead!.id);
    expect(note).toContain('Enquiry via Telephony · Google Ads');
  });

  it('keeps a tag no source carries on the lead’s note, the source left as Telephony', async () => {
    await ring(ws.tenantId, '+971500003312', 'no-answer', '+97144000002');
    const [lead] = await leadsWith(ws.tenantId, '+971500003312');
    expect(lead).toMatchObject({ sourceDetail: 'twilio:+97144000002', sourceId: null });
    expect(await noteOn(lead!.id)).toContain('Enquiry via Telephony · Marina launch');
  });

  it('puts a known caller’s call to a tagged number on its lead, its first source kept', async () => {
    const [before] = await leadsWith(ws.tenantId, '+971500003311');
    const call = await ring(ws.tenantId, '+971500003311', 'completed', '+97144000002');
    expect(call.leadId).toBe(before!.id);
    const [after] = await leadsWith(ws.tenantId, '+971500003311');
    expect(after).toMatchObject({ sourceDetail: `twilio:${TAGGED}`, sourceId: before!.sourceId });
  });

  it('leaves an untagged line as before', async () => {
    await ring(ws.tenantId, '+971500003313', 'no-answer', '+97144000009');
    const [lead] = await leadsWith(ws.tenantId, '+971500003313');
    expect(lead).toMatchObject({ sourceDetail: `twilio:${LINE}`, sourceId: null });
  });
});

describe('the agent distribution gives a caller’s lead to', () => {
  it('is told, in the bell and on the phone', async () => {
    const role = await prisma.role.create({
      data: { tenantId: ws.tenantId, key: `agent-${Date.now()}`, name: 'Agent', rank: 50 },
    });
    const agent = await prisma.user.create({
      data: {
        tenantId: ws.tenantId,
        email: `agent@${ws.slug}.test`,
        fullName: 'Distributed Agent',
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
    await prisma.distributionRule.create({
      data: {
        tenantId: ws.tenantId,
        name: 'Callers',
        objectType: 'LEAD',
        method: 'ROUND_ROBIN',
        isActive: true,
        candidatePool: { userIds: [agent.id] },
      },
    });

    await ring(ws.tenantId, '+971500003305', 'no-answer');
    const [lead] = await leadsWith(ws.tenantId, '+971500003305');
    await handleJob('distribution', { name: 'assign-lead', data: { tenantId: ws.tenantId, leadId: lead!.id } });

    expect((await prisma.lead.findFirstOrThrow({ where: { tenantId: ws.tenantId, id: lead!.id } })).ownerId).toBe(
      agent.id,
    );
    const told = await prisma.notification.findFirstOrThrow({
      where: { tenantId: ws.tenantId, userId: agent.id, recordId: lead!.id, kind: 'lead.assigned' },
    });
    expect(told).toMatchObject({ title: 'Lead assigned: Unknown caller', objectType: 'lead', priority: 'HIGH' });
    expect(told.channels).toContain('push');
    // The caller rang and nobody answered before the lead had an owner: the agent is the one to call back (M9-08).
    const missed = await prisma.notification.findFirstOrThrow({
      where: { tenantId: ws.tenantId, userId: agent.id, recordId: lead!.id, kind: 'call.missed' },
    });
    expect(missed).toMatchObject({ title: 'Missed call from Unknown caller', objectType: 'lead', priority: 'HIGH' });
    expect(missed.channels).toContain('push');
  });
});

describe('the "Create leads from unknown callers" setting', () => {
  const put = (settings: Record<string, unknown>, skipVerification = true) =>
    configure(
      new Request('http://localhost/api/v1/integrations/twilio', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: ws.cookie },
        body: JSON.stringify({ settings, skipVerification }),
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

  it('is a switch: flipping it checks nothing with the vendor and leaves the connection as it was', async () => {
    verify.mockClear();
    const res = await put({ createLeadsFromUnknownCallers: true }, false);
    expect(res.status).toBe(200);
    expect(verify).not.toHaveBeenCalled();
    const row = await prisma.integrationConnection.findUniqueOrThrow({
      where: { tenantId_provider: { tenantId: ws.tenantId, provider: 'twilio' } },
    });
    expect(row).toMatchObject({ status: 'CONNECTED', errorMessage: null });
    expect(row.metadata).toMatchObject({ callerNumber: LINE, createLeadsFromUnknownCallers: true });
  });
});
