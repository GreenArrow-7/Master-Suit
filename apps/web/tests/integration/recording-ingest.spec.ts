import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * A provider's recording, from its callback to playback (audit row M9-07): the
 * signed Twilio callback leaves the vendor's URL on the Recording, the ingest
 * job fetches it into our own storage, and the media route plays it. Object
 * storage is an in-memory map and the vendor's media server a stubbed fetch;
 * the host allow-list and the public-address check run for real, against a
 * stubbed resolver.
 */
vi.mock('@/lib/storage', () => {
  const objects = new Map<string, Buffer>();
  return {
    putObject: async (key: string, body: Buffer) => {
      objects.set(key, body);
      return key;
    },
    getObject: async (key: string) => {
      const body = objects.get(key);
      if (!body) throw new Error(`mock storage: no object at ${key}`);
      return body;
    },
    deleteObject: async (key: string) => void objects.delete(key),
    moveObject: async (_from: string, to: string) => to,
  };
});
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '54.172.60.1', family: 4 }] }));

import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { wrapCredentials } from '@/lib/integrations/connection';
import { POST as telephonyWebhook } from '@/app/api/v1/webhooks/telephony/[key]/route';
import { GET as media } from '@/app/api/v1/calls/[id]/recording/media/route';
import { handleJob } from '@/workers/jobs';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

const AUTH_TOKEN = 'twilio-auth-token-for-ingest-test';
const SID = 'CAingesttest00000000000000000001';
const AUDIO = Buffer.from('ID3-fake-mp3-bytes-for-the-ingest-test');

let fixture: Fixture;
let tenantId: string;
let connectionId: string;
let webhookKey: string;
let callId: string;
const vendor = vi.fn(async () => new Response(new Uint8Array(AUDIO), { headers: { 'content-type': 'audio/mpeg' } }));

function twilio(params: Record<string, string>) {
  const body = new URLSearchParams(params).toString();
  const url = `${env.APP_URL.replace(/\/$/, '')}/api/v1/webhooks/telephony/${webhookKey}`;
  let payload = url;
  for (const name of [...new URLSearchParams(body).keys()].sort())
    payload += name + new URLSearchParams(body).get(name);
  const signature = createHmac('sha1', AUTH_TOKEN).update(payload, 'utf8').digest('base64');
  return telephonyWebhook(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature },
      body,
    }),
    { params: Promise.resolve({ key: webhookKey }) },
  );
}
const recording = () => prisma.recording.findFirstOrThrow({ where: { tenantId, callId } });
const ingest = (url: string) =>
  handleJob('media', { name: 'recording.ingest', data: { tenantId, callId, connectionId, url } });

beforeAll(async () => {
  vi.stubGlobal('fetch', vendor);
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  const connection = await prisma.integrationConnection.create({
    data: {
      tenantId,
      provider: 'twilio',
      status: 'CONNECTED',
      credentials: wrapCredentials({ accountSid: 'ACingest', authToken: AUTH_TOKEN }),
      metadata: { callerNumber: '+971500000000' },
    },
  });
  connectionId = connection.id;
  webhookKey = connection.webhookKey;
  const call = await prisma.call.create({
    data: {
      tenantId,
      leadId: fixture.a.leadIds[0],
      callerId: fixture.a.userId,
      status: 'COMPLETED',
      providerName: 'twilio',
      externalCallId: SID,
      consent: { create: { tenantId, consentGiven: true, method: 'VERBAL', givenAt: new Date() } },
    },
  });
  callId = call.id;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await fixture?.cleanup();
});

describe("a provider's recording reaches our storage and plays (M9-07)", () => {
  const vendorUrl = 'https://api.twilio.com/2010-04-01/Accounts/ACingest/Recordings/REingest.mp3';

  it('is held at the vendor until the ingest job runs, and does not play yet', async () => {
    const res = await twilio({
      CallSid: SID,
      RecordingSid: 'REingest',
      RecordingStatus: 'completed',
      RecordingDuration: '61',
      RecordingUrl: vendorUrl.replace(/\.mp3$/, ''),
    });
    expect(res.status).toBe(200);
    expect(await recording()).toMatchObject({ storageBucket: 'provider', storageKey: vendorUrl, durationSecs: 61 });
    const early = await media(
      new Request(`http://localhost/api/v1/calls/${callId}/recording/media`, { headers: { cookie: fixture.a.cookie } }),
      { params: Promise.resolve({ id: callId }) },
    );
    expect(early.status).toBe(404);
  });

  it('refuses a URL on a host the vendor does not serve media from, fetching nothing', async () => {
    await expect(ingest('https://media.example.com/REingest.mp3')).rejects.toThrow(/allow-list/);
    expect(vendor).not.toHaveBeenCalled();
    expect((await recording()).storageBucket).toBe('provider');
  });

  it("fetches the media with the vendor's credentials into our own storage", async () => {
    expect(await ingest(vendorUrl)).toEqual({ ingested: true });
    expect(vendor).toHaveBeenCalledTimes(1);
    const [url, init] = vendor.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(vendorUrl);
    // A redirect would walk past the host check: refused, not followed.
    expect(init.redirect).toBe('error');
    expect(
      (init.headers as Record<string, string>).Authorization ?? (init.headers as Record<string, string>).authorization,
    ).toBe(`Basic ${Buffer.from(`ACingest:${AUTH_TOKEN}`).toString('base64')}`);
    expect(await recording()).toMatchObject({
      storageBucket: null,
      storageKey: `recordings/${tenantId}/${callId}.mp3`,
      mimeType: 'audio/mpeg',
      sizeBytes: AUDIO.byteLength,
    });
  });

  it('plays from the call through the media route, and a second run fetches nothing', async () => {
    const res = await media(
      new Request(`http://localhost/api/v1/calls/${callId}/recording/media`, { headers: { cookie: fixture.a.cookie } }),
      { params: Promise.resolve({ id: callId }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(Buffer.from(await res.arrayBuffer()).equals(AUDIO)).toBe(true);

    expect(await ingest(vendorUrl)).toEqual({ ingested: false, reason: 'already ingested' });
    expect(vendor).toHaveBeenCalledTimes(1);
  });
});
