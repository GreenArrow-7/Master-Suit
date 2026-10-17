import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { wrapCredentials } from '@/lib/integrations/connection';
import { callbackSecrets } from '@/lib/integrations/telephony';
import { POST as telephonyWebhook } from '@/app/api/v1/webhooks/telephony/[key]/route';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * The call lifecycle, driven through the real webhook route with vendor-shaped,
 * vendor-signed payloads.
 *
 * No live telephony account has placed a call through this application, and none
 * can be arranged from a test suite. This is the closest available substitute:
 * the actual handler, the actual signature verification, the actual database,
 * and bodies in the exact shape and vocabulary Twilio and Exotel document — so
 * the first real call exercises code that has already survived the sequence,
 * the duplicates and the out-of-order delivery that real vendors produce.
 *
 * What it does not prove: that the vendor accepts our *outbound* request. That
 * needs an account, and the integrations screen's "Test connection" is the tool
 * for it.
 */
let fixture: Fixture;
let webhookKey: string;
let exotelKey: string;
let callId: string;

const AUTH_TOKEN = 'twilio-auth-token-for-flow-test';
const EXTERNAL_ID = 'CAflowtest0000000000000000000001';

function twilioRequest(key: string, params: Record<string, string>) {
  const body = new URLSearchParams(params).toString();
  const url = `${env.APP_URL.replace(/\/$/, '')}/api/v1/webhooks/telephony/${key}`;

  const sorted = new URLSearchParams(body);
  let payload = url;
  for (const name of [...sorted.keys()].sort()) payload += name + sorted.getAll(name).join('');
  const signature = createHmac('sha1', AUTH_TOKEN).update(payload, 'utf8').digest('base64');

  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature },
    body,
  });
}

const deliver = (key: string, req: Request) => telephonyWebhook(req, { params: Promise.resolve({ key }) });

const currentCall = () => prisma.call.findFirstOrThrow({ where: { id: callId, tenantId: fixture.a.tenantId } });

beforeAll(async () => {
  fixture = await seedTwoTenants();

  const twilio = await prisma.integrationConnection.create({
    data: {
      tenantId: fixture.a.tenantId,
      provider: 'twilio',
      status: 'CONNECTED',
      credentials: wrapCredentials({ accountSid: 'ACflowtest', authToken: AUTH_TOKEN }),
      metadata: { callerNumber: '+971500000000' },
    },
  });
  webhookKey = twilio.webhookKey;

  const exotel = await prisma.integrationConnection.create({
    data: {
      tenantId: fixture.a.tenantId,
      provider: 'exotel',
      status: 'CONNECTED',
      credentials: wrapCredentials({ accountSid: 'sid', apiKey: 'k', apiToken: 't', subdomain: 'api.exotel.com' }),
      metadata: { callerNumber: '+911111111111' },
    },
  });
  exotelKey = exotel.webhookKey;

  const call = await prisma.call.create({
    data: {
      tenantId: fixture.a.tenantId,
      callerId: fixture.a.userId,
      status: 'SCHEDULED',
      direction: 'OUTBOUND',
      recipientNumber: '+971509999999',
      providerName: 'twilio',
      externalCallId: EXTERNAL_ID,
    },
  });
  callId = call.id;
});

afterAll(async () => {
  await prisma.webhookEvent.deleteMany({ where: { tenantId: fixture.a.tenantId } });
  await prisma.integrationConnection.deleteMany({
    where: { tenantId: { in: [fixture.a.tenantId, fixture.b.tenantId] } },
  });
  await fixture.cleanup();
});

describe('a call progresses through its vendor callbacks', () => {
  it('refuses an unsigned delivery before it reads the body', async () => {
    const url = `${env.APP_URL}/api/v1/webhooks/telephony/${webhookKey}`;
    const res = await deliver(
      webhookKey,
      new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `CallSid=${EXTERNAL_ID}&CallStatus=completed`,
      }),
    );
    expect(res.status).toBe(401);
    expect((await currentCall()).status).toBe('SCHEDULED');
  });

  it('refuses a signed delivery to an unknown connection key', async () => {
    const stranger = randomUUID();
    const res = await deliver(
      stranger,
      twilioRequest(stranger, { CallSid: EXTERNAL_ID, CallStatus: 'completed', SequenceNumber: '9' }),
    );
    expect(res.status).toBe(401);
  });

  it('moves to RINGING, then IN_PROGRESS with an answered time', async () => {
    const ringing = await deliver(
      webhookKey,
      twilioRequest(webhookKey, { CallSid: EXTERNAL_ID, CallStatus: 'ringing', SequenceNumber: '1' }),
    );
    expect(ringing.status).toBe(200);
    expect((await currentCall()).status).toBe('RINGING');

    const answered = await deliver(
      webhookKey,
      twilioRequest(webhookKey, {
        CallSid: EXTERNAL_ID,
        CallStatus: 'in-progress',
        SequenceNumber: '2',
        Timestamp: 'Sat, 08 Aug 2026 10:00:00 +0000',
      }),
    );
    expect(answered.status).toBe(200);

    const call = await currentCall();
    expect(call.status).toBe('IN_PROGRESS');
    expect(call.answeredAt?.toISOString()).toBe('2026-08-08T10:00:00.000Z');
  });

  it('deduplicates a redelivery of the same event', async () => {
    const first = await deliver(
      webhookKey,
      twilioRequest(webhookKey, {
        CallSid: EXTERNAL_ID,
        CallStatus: 'completed',
        CallDuration: '95',
        SequenceNumber: '3',
      }),
    );
    expect(await first.json()).toMatchObject({ ok: true });

    const replay = await deliver(
      webhookKey,
      twilioRequest(webhookKey, {
        CallSid: EXTERNAL_ID,
        CallStatus: 'completed',
        CallDuration: '95',
        SequenceNumber: '3',
      }),
    );
    expect(await replay.json()).toMatchObject({ ok: true, skipped: true });

    const call = await currentCall();
    expect(call.status).toBe('COMPLETED');
    expect(call.durationSecs).toBe(95);
  });

  it('counts a vendor-answered call with no disposition as connected (PROP-05)', async () => {
    // Answered (in-progress) then completed above, and nobody recorded an outcome.
    expect((await currentCall()).outcome).toBe('CONNECTED');
  });

  it('does not let a late early-state callback reopen a finished call', async () => {
    // Vendors deliver out of order often enough that this is routine, not an
    // anomaly. A "ringing" arriving after "completed" must not undo the outcome.
    const late = await deliver(
      webhookKey,
      twilioRequest(webhookKey, { CallSid: EXTERNAL_ID, CallStatus: 'ringing', SequenceNumber: '4' }),
    );
    expect(late.status).toBe(200);
    expect((await currentCall()).status).toBe('COMPLETED');
  });

  it('discards a recording the client never consented to', async () => {
    const res = await deliver(
      webhookKey,
      twilioRequest(webhookKey, {
        CallSid: EXTERNAL_ID,
        RecordingSid: 'REnoconsent',
        RecordingStatus: 'completed',
        RecordingDuration: '95',
        RecordingUrl: 'https://api.twilio.com/rec/REnoconsent',
      }),
    );
    expect(res.status).toBe(200);
    expect(await prisma.recording.findFirst({ where: { callId, tenantId: fixture.a.tenantId } })).toBeNull();
  });

  it('stores a consented recording as vendor-held until the ingest job runs', async () => {
    await prisma.recordingConsent.create({
      data: { tenantId: fixture.a.tenantId, callId, consentGiven: true, method: 'VERBAL', givenAt: new Date() },
    });

    const res = await deliver(
      webhookKey,
      twilioRequest(webhookKey, {
        CallSid: EXTERNAL_ID,
        RecordingSid: 'REconsented',
        RecordingStatus: 'completed',
        RecordingDuration: '95',
        RecordingUrl: 'https://api.twilio.com/rec/REconsented',
      }),
    );
    expect(res.status).toBe(200);

    const recording = await prisma.recording.findFirstOrThrow({ where: { callId, tenantId: fixture.a.tenantId } });
    // `provider` is the marker that the bytes are still on Twilio's servers. The
    // download route refuses this state, which is what stops a vendor URL ever
    // reaching a browser.
    expect(recording.storageBucket).toBe('provider');
    expect(recording.storageKey).toBe('https://api.twilio.com/rec/REconsented.mp3');
  });

  it('ignores a callback for a call belonging to a different connection', async () => {
    // The Exotel connection is on the same tenant but the call names twilio as
    // its provider, so the lookup must miss rather than cross-match on the id.
    const { urlToken } = callbackSecrets(exotelKey);
    const url = `${env.APP_URL.replace(/\/$/, '')}/api/v1/webhooks/telephony/${exotelKey}?token=${urlToken}`;
    const res = await deliver(
      exotelKey,
      new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ CallSid: EXTERNAL_ID, Status: 'completed', ConversationDuration: 12 }),
      }),
    );
    expect(await res.json()).toMatchObject({ ok: true, ignored: true });
  });

  it("keeps the vendor's talk time apart from the leg, and a talk makes it connected without an answered callback (PROP-05)", async () => {
    const exotel = async (sid: string, body: Record<string, unknown>) => {
      const { urlToken } = callbackSecrets(exotelKey);
      const url = `${env.APP_URL.replace(/\/$/, '')}/api/v1/webhooks/telephony/${exotelKey}?token=${urlToken}`;
      const res = await deliver(
        exotelKey,
        new Request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ CallSid: sid, ...body }),
        }),
      );
      expect(res.status).toBe(200);
      return prisma.call.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, externalCallId: sid } });
    };
    for (const sid of ['EXtalked', 'EXsilent', 'EXivr']) {
      await prisma.call.create({
        data: {
          tenantId: fixture.a.tenantId,
          callerId: fixture.a.userId,
          status: 'RINGING',
          recipientNumber: '+971509999998',
          providerName: 'exotel',
          externalCallId: sid,
        },
      });
    }
    const talked = await exotel('EXtalked', { Status: 'completed', DialCallDuration: 95, ConversationDuration: 80 });
    expect(talked).toMatchObject({ status: 'COMPLETED', durationSecs: 95, talkSecs: 80, outcome: 'CONNECTED' });
    // Rang through, nobody spoke: a call, not a connected one.
    const silent = await exotel('EXsilent', { Status: 'completed', DialCallDuration: 30, ConversationDuration: 0 });
    expect(silent).toMatchObject({ status: 'COMPLETED', talkSecs: 0, outcome: null });
    // Answered by the vendor (an IVR, a ringing agent) but nobody talked: the talk decides.
    await exotel('EXivr', { Status: 'in-progress' });
    const ivr = await exotel('EXivr', { Status: 'completed', DialCallDuration: 40, ConversationDuration: 0 });
    expect(ivr.answeredAt).not.toBeNull();
    expect(ivr).toMatchObject({ status: 'COMPLETED', outcome: null });
  });

  it("never overwrites the agent's own disposition with the vendor's", async () => {
    const call = await prisma.call.create({
      data: {
        tenantId: fixture.a.tenantId,
        callerId: fixture.a.userId,
        status: 'RINGING',
        outcome: 'WRONG_NUMBER',
        providerName: 'twilio',
        externalCallId: 'CAdisposed',
      },
    });
    await deliver(webhookKey, twilioRequest(webhookKey, { CallSid: 'CAdisposed', CallStatus: 'in-progress' }));
    await deliver(webhookKey, twilioRequest(webhookKey, { CallSid: 'CAdisposed', CallStatus: 'completed' }));
    expect(await prisma.call.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, id: call.id } })).toMatchObject({
      status: 'COMPLETED',
      outcome: 'WRONG_NUMBER',
    });
  });

  it('refuses an Exotel callback that arrives without its URL token', async () => {
    const url = `${env.APP_URL.replace(/\/$/, '')}/api/v1/webhooks/telephony/${exotelKey}`;
    const res = await deliver(
      exotelKey,
      new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ CallSid: 'EX1', Status: 'completed' }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe('inbound calls', () => {
  const INBOUND_ID = 'CAinboundtest000000000000000001';

  it('creates an INBOUND call matched to the lead whose number is calling, owned by its owner', async () => {
    const leadId = fixture.a.leadIds[1];
    await prisma.lead.update({
      where: { tenantId: fixture.a.tenantId, id: leadId },
      data: { phone: '+971 50 777 8899', phoneNormalized: '+971507778899', ownerId: fixture.a.userId },
    });
    const res = await deliver(
      webhookKey,
      twilioRequest(webhookKey, {
        CallSid: INBOUND_ID,
        CallStatus: 'ringing',
        Direction: 'inbound',
        From: '+971507778899',
        To: '+971500000000',
        SequenceNumber: '1',
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });

    const call = await prisma.call.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, externalCallId: INBOUND_ID, providerName: 'twilio' },
    });
    expect(call.direction).toBe('INBOUND');
    expect(call.leadId).toBe(leadId);
    expect(call.callerId).toBe(fixture.a.userId);
    expect(call.callerNumber).toBe('+971507778899');
    expect(call.status).toBe('RINGING');

    // The next callback finds the row it just created and moves it on.
    await deliver(
      webhookKey,
      twilioRequest(webhookKey, {
        CallSid: INBOUND_ID,
        CallStatus: 'completed',
        Direction: 'inbound',
        From: '+971507778899',
        SequenceNumber: '2',
        CallDuration: '45',
      }),
    );
    const done = await prisma.call.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, id: call.id } });
    expect(done.status).toBe('COMPLETED');
    expect(done.durationSecs).toBe(45);
  });

  it('still records an inbound call from an unknown number, and makes the caller a lead (M6-11)', async () => {
    const res = await deliver(
      webhookKey,
      twilioRequest(webhookKey, {
        CallSid: `${INBOUND_ID}x`,
        CallStatus: 'ringing',
        Direction: 'inbound',
        From: '+971500001234',
        SequenceNumber: '1',
      }),
    );
    expect(await res.json()).toMatchObject({ ok: true });
    const call = await prisma.call.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, externalCallId: `${INBOUND_ID}x` },
    });
    expect(call.direction).toBe('INBOUND');
    // The connection has not switched it off: tests/sales/telephony-unknown-caller.spec.ts.
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, id: call.leadId! } });
    expect(lead).toMatchObject({ phoneNormalized: '+971500001234', source: 'TELEPHONY' });
  });

  const missed = (tenantId: string, recordId: string) =>
    prisma.notification.findMany({ where: { tenantId, recordId, kind: 'call.missed' } });

  it("tells a known caller's lead owner of the missed call, HIGH, in the bell and on the phone (M9-08)", async () => {
    const leadId = fixture.a.leadIds[2]!;
    await prisma.lead.update({
      where: { tenantId: fixture.a.tenantId, id: leadId },
      data: { phone: '+971507770001', phoneNormalized: '+971507770001', ownerId: fixture.a.userId },
    });
    const sid = `${INBOUND_ID}m`;
    const ring = (status: string, seq: string) =>
      deliver(
        webhookKey,
        twilioRequest(webhookKey, {
          CallSid: sid,
          CallStatus: status,
          Direction: 'inbound',
          From: '+971507770001',
          To: '+971500000000',
          SequenceNumber: seq,
        }),
      );
    await ring('ringing', '1');
    expect(await missed(fixture.a.tenantId, leadId)).toHaveLength(0);
    await ring('no-answer', '2');
    const [told, ...more] = await missed(fixture.a.tenantId, leadId);
    expect(more).toHaveLength(0);
    expect(told).toMatchObject({
      userId: fixture.a.userId,
      // The lead by name, never its number.
      title: 'Missed call from manath Lead 2',
      objectType: 'lead',
      priority: 'HIGH',
    });
    expect(told!.channels).toContain('push');
    // A late or repeated callback is not a second missed call.
    await ring('busy', '3');
    expect(await missed(fixture.a.tenantId, leadId)).toHaveLength(1);
  });

  it('tells the person an unknown caller’s missed call is recorded against, until distribution names an owner (M9-08)', async () => {
    const sid = `${INBOUND_ID}u`;
    for (const [status, seq] of [
      ['ringing', '1'],
      ['no-answer', '2'],
    ]) {
      await deliver(
        webhookKey,
        twilioRequest(webhookKey, {
          CallSid: sid,
          CallStatus: status!,
          Direction: 'inbound',
          From: '+971500004321',
          SequenceNumber: seq!,
        }),
      );
    }
    const call = await prisma.call.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, externalCallId: sid } });
    expect(call.leadId).not.toBeNull();
    const [told] = await missed(fixture.a.tenantId, call.leadId!);
    expect(told).toMatchObject({ userId: call.callerId, title: 'Missed call from Unknown caller', priority: 'HIGH' });
  });

  it('does not create a call for an outbound callback it cannot find', async () => {
    const res = await deliver(
      webhookKey,
      twilioRequest(webhookKey, {
        CallSid: `${INBOUND_ID}y`,
        CallStatus: 'ringing',
        Direction: 'outbound-api',
        From: '+971500000000',
        SequenceNumber: '1',
      }),
    );
    expect(await res.json()).toMatchObject({ ok: true, ignored: true });
  });
});
