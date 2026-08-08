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
